/**
 * Export to the Aspose "APS" XML layout format (root <Aps>), matching the
 * structure Aspose's PDF→XML converter produces:
 *
 *   <Aps><Group><Page Width Height PaperTray>
 *     <Canvas><Canvas><Clip>page box</Clip> … content … </Canvas></Canvas>
 *   </Page>…</Group><Resources><Resource Id>base64</Resource>…</Resources></Aps>
 *
 * Coordinates are in points with a top-left origin. Images are referenced by
 * id and stored once in <Resources>. JPEG images are embedded with their
 * original bytes (never re-compressed); other images are stored as lossless PNG.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFObject,
} from 'pdf-lib';
import { OPS, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { openForViewing } from './pdf';
import { encodePng } from './png';

type Matrix = [number, number, number, number, number, number];
type Point = [number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Row-vector convention (as in PDF): applying `m1` then `m2`. Single-precision like Aspose. */
function mul(m1: Matrix, m2: Matrix): Matrix {
  const f = Math.fround;
  return [
    f(m1[0] * m2[0] + m1[1] * m2[2]),
    f(m1[0] * m2[1] + m1[1] * m2[3]),
    f(m1[2] * m2[0] + m1[3] * m2[2]),
    f(m1[2] * m2[1] + m1[3] * m2[3]),
    f(m1[4] * m2[0] + m1[5] * m2[2] + m2[4]),
    f(m1[4] * m2[1] + m1[5] * m2[3] + m2[5]),
  ];
}

function apply(m: Matrix, x: number, y: number): Point {
  return [Math.fround(x * m[0] + y * m[2] + m[4]), Math.fround(x * m[1] + y * m[3] + m[5])];
}

/** Shortest decimal that round-trips as a 32-bit float (how .NET prints `float`). */
function num(value: number): string {
  if (Object.is(value, -0)) return '-0';
  if (!Number.isFinite(value)) return '0';
  const target = Math.fround(value);
  for (let p = 1; p <= 9; p++) {
    const s = target.toPrecision(p);
    if (Math.fround(Number(s)) === target) return String(Number(s));
  }
  return String(target);
}

function matrixAttr(m: Matrix): string {
  // Aspose writes an unrotated matrix as "a 0 -0 d e f".
  const c = m[1] === 0 && m[2] === 0 ? -0 : m[2];
  return [m[0], m[1], c, m[3], m[4], m[5]].map(num).join(' ');
}

const esc = (s: string) =>
  s
    // Characters not allowed in XML 1.0 are dropped from text content.
    .replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const hexColor = (r: number, g: number, b: number) =>
  '#FF' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('');

// ---------------------------------------------------------------------------
// XML writer (tabs + CRLF, like the Aspose output)
// ---------------------------------------------------------------------------

class Writer {
  private lines: string[] = [];
  private depth = 0;

  private attrs(a: Record<string, string>) {
    return Object.entries(a)
      .map(([k, v]) => ` ${k}="${v}"`)
      .join('');
  }
  open(tag: string, a: Record<string, string> = {}) {
    this.lines.push(`${'\t'.repeat(this.depth++)}<${tag}${this.attrs(a)}>`);
  }
  close(tag: string) {
    this.lines.push(`${'\t'.repeat(--this.depth)}</${tag}>`);
  }
  leaf(tag: string, a: Record<string, string> = {}) {
    this.lines.push(`${'\t'.repeat(this.depth)}<${tag}${this.attrs(a)} />`);
  }
  text(tag: string, a: Record<string, string>, content: string) {
    this.lines.push(`${'\t'.repeat(this.depth)}<${tag}${this.attrs(a)}>${content}</${tag}>`);
  }
  toString() {
    return this.lines.join('\r\n');
  }
}

// ---------------------------------------------------------------------------
// Original JPEG bytes: list the image XObjects a page draws, in drawing order
// ---------------------------------------------------------------------------

interface DrawnImage {
  width: number;
  height: number;
  /** Original JPEG file bytes when the image can be embedded as-is. */
  jpeg: Uint8Array | null;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function lookup(doc: PDFDocument, obj: PDFObject | undefined): PDFObject | undefined {
  return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
}

function streamBytes(stream: PDFObject | undefined): Uint8Array {
  if (!(stream instanceof PDFRawStream)) return new Uint8Array();
  try {
    return decodePDFRawStream(stream).decode();
  } catch {
    return new Uint8Array();
  }
}

/** JPEG data is embeddable verbatim only when nothing in the PDF alters how it is displayed. */
function plainJpeg(doc: PDFDocument, stream: PDFRawStream): Uint8Array | null {
  const dict = stream.dict;
  const filter = lookup(doc, dict.get(PDFName.of('Filter')));
  const filters = filter instanceof PDFArray ? filter.asArray().map((f) => lookup(doc, f)) : [filter];
  if (filters.length !== 1 || filters[0]?.toString() !== '/DCTDecode') return null;
  for (const key of ['SMask', 'Mask', 'Decode', 'ImageMask']) if (dict.get(PDFName.of(key))) return null;
  const cs = lookup(doc, dict.get(PDFName.of('ColorSpace')));
  if (cs && !['/DeviceRGB', '/DeviceGray'].includes(cs.toString())) {
    // ICCBased RGB/Gray is fine; anything else (CMYK, Indexed, Separation…) is decoded instead.
    const n = cs instanceof PDFArray && lookup(doc, cs.get(0))?.toString() === '/ICCBased'
      ? lookup(doc, (lookup(doc, cs.get(1)) as PDFRawStream | undefined)?.dict.get(PDFName.of('N')))
      : undefined;
    if (!(n instanceof PDFNumber) || ![1, 3].includes(n.asNumber())) return null;
  }
  return stream.getContents();
}

function scanContent(
  doc: PDFDocument,
  content: Uint8Array,
  resources: PDFDict | undefined,
  out: DrawnImage[],
  depth: number,
) {
  const xobjects = resources?.lookup(PDFName.of('XObject'));
  let lastName: string | null = null;
  let i = 0;
  const n = content.length;

  while (i < n) {
    const c = content[i];
    if (WS.has(c)) {
      i++;
    } else if (c === 0x25) {
      while (i < n && content[i] !== 0x0a && content[i] !== 0x0d) i++;
    } else if (c === 0x28) {
      // literal string with nesting and escapes
      let level = 0;
      for (; i < n; i++) {
        if (content[i] === 0x5c) i++;
        else if (content[i] === 0x28) level++;
        else if (content[i] === 0x29 && --level === 0) {
          i++;
          break;
        }
      }
    } else if (c === 0x3c && content[i + 1] !== 0x3c) {
      while (i < n && content[i] !== 0x3e) i++;
      i++;
    } else if (c === 0x2f) {
      let j = i + 1;
      while (j < n && !WS.has(content[j]) && !DELIM.has(content[j])) j++;
      lastName = new TextDecoder('latin1')
        .decode(content.subarray(i + 1, j))
        .replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      i = j;
    } else if (DELIM.has(c)) {
      i++;
    } else {
      let j = i;
      while (j < n && !WS.has(content[j]) && !DELIM.has(content[j])) j++;
      const token = new TextDecoder('latin1').decode(content.subarray(i, j));
      i = j;
      if (token === 'BI') {
        // Inline image: skip to "EI" (these are not XObjects).
        while (i < n && !(WS.has(content[i - 1]) && content[i] === 0x49 && content[i + 1] === 0x44)) i++;
        i += 2;
        while (i < n && !(WS.has(content[i - 1]) && content[i] === 0x45 && content[i + 1] === 0x49 && (i + 2 >= n || WS.has(content[i + 2])))) i++;
        i += 2;
      } else if (token === 'Do' && lastName && xobjects instanceof PDFDict) {
        const xobj = lookup(doc, xobjects.get(PDFName.of(lastName)));
        if (xobj instanceof PDFRawStream) {
          const subtype = xobj.dict.get(PDFName.of('Subtype'))?.toString();
          if (subtype === '/Image') {
            const w = lookup(doc, xobj.dict.get(PDFName.of('Width')));
            const h = lookup(doc, xobj.dict.get(PDFName.of('Height')));
            out.push({
              width: w instanceof PDFNumber ? w.asNumber() : 0,
              height: h instanceof PDFNumber ? h.asNumber() : 0,
              jpeg: plainJpeg(doc, xobj),
            });
          } else if (subtype === '/Form' && depth < 12) {
            const formRes = lookup(doc, xobj.dict.get(PDFName.of('Resources')));
            scanContent(doc, streamBytes(xobj), formRes instanceof PDFDict ? formRes : resources, out, depth + 1);
          }
        }
      }
    }
  }
}

function drawnImages(doc: PDFDocument, pageIndex: number): DrawnImage[] {
  const node = doc.getPage(pageIndex).node;
  const contents = node.Contents();
  const streams =
    contents instanceof PDFArray ? contents.asArray().map((r) => lookup(doc, r)) : contents ? [contents] : [];
  const parts = streams.map(streamBytes);
  const joined = new Uint8Array(parts.reduce((s, p) => s + p.length + 1, 0));
  let o = 0;
  for (const p of parts) {
    joined.set(p, o);
    o += p.length;
    joined[o++] = 0x0a;
  }
  const out: DrawnImage[] = [];
  scanContent(doc, joined, node.Resources(), out, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Decoded images (non-JPEG) → lossless PNG
// ---------------------------------------------------------------------------

interface PdfjsImage {
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  data?: Uint8Array | Uint8ClampedArray;
  kind?: number;
}

function getObject(page: PDFPageProxy, id: string): Promise<PdfjsImage | null> {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 10_000);
    store.get(id, (data: PdfjsImage) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/** Fallback for the rare case pdf.js hands over an ImageBitmap instead of raw pixels. */
async function bitmapToPng(bitmap: ImageBitmap): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return encodePng(bitmap.width, bitmap.height, data, 'rgba');
}

/** Decoded image → lossless PNG with exactly the decoded pixel values. */
async function imageToPng(img: PdfjsImage): Promise<Uint8Array> {
  if (!img.data) return img.bitmap ? bitmapToPng(img.bitmap) : encodePng(1, 1, new Uint8Array(4), 'rgba');
  const color = img.kind === 3 ? 'rgba' : img.kind === 2 ? 'rgb' : 'gray1';
  return encodePng(img.width, img.height, img.data, color);
}

/** Stencil mask (1 bit): painted pixels take the current fill colour, the rest are transparent. */
async function maskToPng(img: PdfjsImage, fill: [number, number, number]): Promise<Uint8Array> {
  if (!img.data) return img.bitmap ? bitmapToPng(img.bitmap) : encodePng(1, 1, new Uint8Array(4), 'rgba');
  const rgba = new Uint8Array(img.width * img.height * 4);
  const rowBytes = (img.width + 7) >> 3;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const bit = (img.data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      const d = (y * img.width + x) * 4;
      rgba[d] = fill[0];
      rgba[d + 1] = fill[1];
      rgba[d + 2] = fill[2];
      rgba[d + 3] = bit ? 0 : 255;
    }
  }
  return encodePng(img.width, img.height, rgba, 'rgba');
}

async function toBase64(bytes: Uint8Array): Promise<string> {
  const url: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes]));
  });
  return url.slice(url.indexOf(',') + 1);
}

// ---------------------------------------------------------------------------
// Resources (deduplicated by content, numbered in order of first use)
// ---------------------------------------------------------------------------

class ResourceTable {
  private ids = new Map<string, number>();
  readonly items: { id: number; base64: string }[] = [];

  async add(bytes: Uint8Array): Promise<number> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    const known = this.ids.get(key);
    if (known) return known;
    const id = this.items.length + 1;
    this.ids.set(key, id);
    this.items.push({ id, base64: await toBase64(bytes) });
    return id;
  }
}

// ---------------------------------------------------------------------------
// Page conversion
// ---------------------------------------------------------------------------

interface Figure {
  closed: boolean;
  segments: Point[][]; // 2 points = line, 4 points = cubic Bézier
}

interface State {
  ctm: Matrix;
  fill: [number, number, number];
  stroke: [number, number, number];
  lineWidth: number;
  /** Canvases opened (for clipping) since this state was saved. */
  opened: number;
}

interface Link {
  url: string;
  box: [number, number, number, number];
}

function bbox(points: Point[]): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const overlaps = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function writeFigures(w: Writer, figures: Figure[], lineColor: string) {
  for (const fig of figures) {
    w.open('PathFigure', { IsClosed: fig.closed ? 'True' : 'False' });
    for (const seg of fig.segments) {
      const tag = seg.length === 2 ? 'PolyLine' : 'PolyBezier';
      w.open(tag, { LineColor: lineColor });
      for (const [x, y] of seg) w.leaf('Point', { X: num(x), Y: num(y) });
      w.close(tag);
    }
    w.close('PathFigure');
  }
}

async function convertPage(
  w: Writer,
  page: PDFPageProxy,
  lib: PDFDocument,
  pageIndex: number,
  resources: ResourceTable,
) {
  const viewport = page.getViewport({ scale: 1 });
  const W = viewport.width;
  const H = viewport.height;
  const dev = viewport.transform as Matrix; // PDF user space → top-left page space

  const links: Link[] = (await page.getAnnotations())
    .filter((a) => a.subtype === 'Link' && typeof a.url === 'string')
    .map((a) => {
      const [x1, y1, x2, y2] = a.rect as number[];
      return { url: a.url as string, box: bbox([apply(dev, x1, y1), apply(dev, x2, y2)]) };
    });

  const originals = drawnImages(lib, pageIndex);
  const ops = await page.getOperatorList();
  // Paints of XObject images, in order — matched 1:1 with `originals` when consistent.
  const paints: [number, number][] = [];
  ops.fnArray.forEach((fn, k) => {
    const args = ops.argsArray[k];
    if (fn === OPS.paintImageXObject) paints.push([args[1], args[2]]);
    else if (fn === OPS.paintImageMaskXObject) paints.push([args[0].width, args[0].height]);
    else if (fn === OPS.paintImageXObjectRepeat) for (let p = 0; p < args[3].length; p += 2) paints.push([0, 0]);
  });
  const aligned =
    paints.length === originals.length &&
    paints.every(([pw, ph], k) => (pw === 0 && ph === 0) || (pw === originals[k].width && ph === originals[k].height));
  let paintIndex = 0;

  w.open('Page', { Width: num(W), Height: num(H), PaperTray: '0' });
  w.open('Canvas');
  w.open('Canvas');
  // Page clip, in the same point order Aspose uses.
  w.open('Clip');
  w.open('Path', { FillMode: 'Winding' });
  writeFigures(
    w,
    [{ closed: true, segments: [[[0, H], [0, 0]], [[0, 0], [W, 0]], [[W, 0], [W, H]], [[W, H], [0, H]]] }],
    '#FF000000',
  );
  w.close('Path');
  w.close('Clip');

  const stack: State[] = [];
  let st: State = { ctm: IDENTITY, fill: [0, 0, 0], stroke: [0, 0, 0], lineWidth: 1, opened: 0 };
  let figures: Figure[] = [];
  let pendingClip: 'Winding' | 'EvenOdd' | null = null;
  const toDevice = (x: number, y: number) => apply(mul(st.ctm, dev), x, y);

  const writeImage = async (ctm: Matrix, iw: number, ih: number, bytes: Uint8Array) => {
    const id = await resources.add(bytes);
    // Pixel grid (top-down rows) → unit square → page. Scaled by the single-precision
    // reciprocal of the pixel size, which reproduces Aspose's numbers exactly.
    const f = Math.fround;
    const sx = f(1 / iw);
    const sy = f(1 / ih);
    const pixelToUser: Matrix = [
      f(ctm[0] * sx),
      f(ctm[1] * sx),
      f(-ctm[2] * sy),
      f(-ctm[3] * sy),
      f(ctm[2] + ctm[4]),
      f(ctm[3] + ctm[5]),
    ];
    const m = mul(pixelToUser, dev);
    const corners = [apply(m, 0, 0), apply(m, iw, 0), apply(m, 0, ih), apply(m, iw, ih)];
    const box = bbox(corners);
    w.open('Canvas', { RenderTransform: matrixAttr(m) });
    w.open('Image', { ResourceId: String(id) });
    w.leaf('Origin', { X: '0', Y: '0' });
    w.leaf('Size', { Width: num(iw), Height: num(ih) });
    for (const link of links.filter((l) => overlaps(l.box, box))) {
      w.open('Hyperlink', { JumpType: 'NoJump', Target: esc(link.url) });
      w.leaf('ActiveRect', { X: '0', Y: '0', Width: '0', Height: '0' });
      w.close('Hyperlink');
    }
    w.close('Image');
    w.close('Canvas');
  };

  const paintPath = (fillMode: 'Winding' | 'EvenOdd' | null, stroke: boolean) => {
    if (figures.length) {
      const attrs: Record<string, string> = { FillMode: fillMode ?? 'Winding' };
      if (fillMode) attrs.Fill = hexColor(...st.fill);
      if (stroke) attrs.StrokeThickness = num(st.lineWidth * Math.hypot(st.ctm[0], st.ctm[1]));
      w.open('Path', attrs);
      writeFigures(w, figures, stroke ? hexColor(...st.stroke) : '#00000000');
      w.close('Path');
    }
    if (pendingClip && figures.length) {
      w.open('Canvas');
      w.open('Clip');
      w.open('Path', { FillMode: pendingClip });
      writeFigures(w, figures, '#FF000000');
      w.close('Path');
      w.close('Clip');
      st.opened++;
    }
    pendingClip = null;
    figures = [];
  };

  const save = () => {
    stack.push(st);
    st = { ...st, opened: 0 };
  };
  const restore = () => {
    for (let k = 0; k < st.opened; k++) w.close('Canvas');
    st = stack.pop() ?? st;
  };

  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k];
    const args = ops.argsArray[k];
    switch (fn) {
      case OPS.save:
        save();
        break;
      case OPS.restore:
        restore();
        break;
      case OPS.transform:
        st.ctm = mul(args as Matrix, st.ctm);
        break;
      case OPS.setLineWidth:
        st.lineWidth = args[0];
        break;
      case OPS.setFillRGBColor:
        st.fill = [args[0], args[1], args[2]];
        break;
      case OPS.setStrokeRGBColor:
        st.stroke = [args[0], args[1], args[2]];
        break;
      case OPS.constructPath: {
        const [pathOps, coords] = args as [number[], number[]];
        let j = 0;
        let cur: Point = [0, 0];
        let fig: Figure | null = figures[figures.length - 1] ?? null;
        for (const op of pathOps) {
          if (op === OPS.rectangle) {
            const [x, y, rw, rh] = coords.slice(j, (j += 4));
            const p = [toDevice(x, y), toDevice(x + rw, y), toDevice(x + rw, y + rh), toDevice(x, y + rh)];
            figures.push({ closed: true, segments: [[p[0], p[1]], [p[1], p[2]], [p[2], p[3]], [p[3], p[0]]] });
            fig = null;
            cur = [x, y];
          } else if (op === OPS.moveTo) {
            cur = [coords[j++], coords[j++]];
            fig = { closed: false, segments: [] };
            figures.push(fig);
          } else if (op === OPS.lineTo) {
            const next: Point = [coords[j++], coords[j++]];
            if (!fig) figures.push((fig = { closed: false, segments: [] }));
            fig.segments.push([toDevice(...cur), toDevice(...next)]);
            cur = next;
          } else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
            let c1: Point, c2: Point, end: Point;
            if (op === OPS.curveTo) {
              c1 = [coords[j], coords[j + 1]];
              c2 = [coords[j + 2], coords[j + 3]];
              end = [coords[j + 4], coords[j + 5]];
              j += 6;
            } else if (op === OPS.curveTo2) {
              c1 = cur;
              c2 = [coords[j], coords[j + 1]];
              end = [coords[j + 2], coords[j + 3]];
              j += 4;
            } else {
              c1 = [coords[j], coords[j + 1]];
              end = [coords[j + 2], coords[j + 3]];
              c2 = end;
              j += 4;
            }
            if (!fig) figures.push((fig = { closed: false, segments: [] }));
            fig.segments.push([toDevice(...cur), toDevice(...c1), toDevice(...c2), toDevice(...end)]);
            cur = end;
          } else if (op === OPS.closePath && fig) {
            fig.closed = true;
          }
        }
        break;
      }
      case OPS.clip:
        pendingClip = 'Winding';
        break;
      case OPS.eoClip:
        pendingClip = 'EvenOdd';
        break;
      case OPS.endPath:
        paintPath(null, false);
        break;
      case OPS.fill:
        paintPath('Winding', false);
        break;
      case OPS.eoFill:
        paintPath('EvenOdd', false);
        break;
      case OPS.stroke:
      case OPS.closeStroke:
        paintPath(null, true);
        break;
      case OPS.fillStroke:
      case OPS.closeFillStroke:
        paintPath('Winding', true);
        break;
      case OPS.eoFillStroke:
      case OPS.closeEOFillStroke:
        paintPath('EvenOdd', true);
        break;
      case OPS.paintFormXObjectBegin:
        save();
        if (args[0]) st.ctm = mul(args[0] as Matrix, st.ctm);
        break;
      case OPS.paintFormXObjectEnd:
        restore();
        break;
      case OPS.paintImageXObject: {
        const original = aligned ? originals[paintIndex] : undefined;
        paintIndex++;
        const img = await getObject(page, args[0]);
        if (!img) break;
        const bytes = original?.jpeg ?? (await imageToPng(img));
        await writeImage(st.ctm, img.width, img.height, bytes);
        break;
      }
      case OPS.paintImageXObjectRepeat: {
        const [id, sx, sy, positions] = args as [string, number, number, number[]];
        const img = await getObject(page, id);
        for (let p = 0; p < positions.length; p += 2) {
          const original = aligned ? originals[paintIndex] : undefined;
          paintIndex++;
          if (!img) continue;
          const bytes = original?.jpeg ?? (await imageToPng(img));
          await writeImage(mul([sx, 0, 0, sy, positions[p], positions[p + 1]], st.ctm), img.width, img.height, bytes);
        }
        break;
      }
      case OPS.paintInlineImageXObject: {
        const img = args[0] as PdfjsImage;
        await writeImage(st.ctm, img.width, img.height, await imageToPng(img));
        break;
      }
      case OPS.paintImageMaskXObject: {
        paintIndex++;
        const img = args[0] as PdfjsImage;
        await writeImage(st.ctm, img.width, img.height, await maskToPng(img, st.fill));
        break;
      }
    }
  }
  while (stack.length) restore();
  for (let k = 0; k < st.opened; k++) w.close('Canvas');

  // Text (as extracted by pdf.js: exact characters and positions).
  const text = await page.getTextContent();
  for (const item of text.items as TextItem[]) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [a, b, c, d, e, f] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 1;
    const m = mul(mul([1, 0, 0, -1, 0, 0], [a / size, b / size, c / size, d / size, e, f]), dev);
    w.open('Canvas', { RenderTransform: matrixAttr(m) });
    w.leaf('Glyphs', {
      OriginX: '0',
      OriginY: '0',
      FontRenderingEmSize: num(size),
      FontFamily: esc(text.styles[item.fontName]?.fontFamily ?? ''),
      Fill: '#FF000000',
      UnicodeString: esc(item.str),
    });
    w.close('Canvas');
  }

  w.close('Canvas');
  w.close('Canvas');
  w.close('Page');
}

/** Converts a PDF (the verified output file) to Aspose APS XML. */
export async function buildAps(pdf: Uint8Array, onProgress?: (page: number, total: number) => void): Promise<string> {
  const lib = await PDFDocument.load(pdf, { updateMetadata: false });
  const view: PDFDocumentProxy = await openForViewing(pdf, { rawImages: true });
  const resources = new ResourceTable();
  const w = new Writer();
  try {
    w.open('Aps');
    w.open('Group');
    for (let i = 0; i < view.numPages; i++) {
      onProgress?.(i + 1, view.numPages);
      const page = await view.getPage(i + 1);
      await convertPage(w, page, lib, i, resources);
      page.cleanup();
    }
    w.close('Group');
    w.open('Resources');
    for (const r of resources.items) w.text('Resource', { Id: String(r.id) }, r.base64);
    w.close('Resources');
    w.close('Aps');
  } finally {
    await view.destroy();
  }
  // UTF-8 with BOM, CRLF line endings — same as the Aspose output.
  return '﻿<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n' + w.toString();
}
