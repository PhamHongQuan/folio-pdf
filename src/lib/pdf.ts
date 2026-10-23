import {
  degrees,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  type PDFPage,
} from 'pdf-lib';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Attachment, PageItem, SourceDoc } from './types';

GlobalWorkerOptions.workerSrc = workerUrl;

const PDFJS_OPTIONS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  isEvalSupported: false,
};

export class PdfLoadError extends Error {}

export function normalizeRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** pdf.js transfers the buffer it receives to its worker, so always hand it a copy. */
export function openForViewing(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ ...PDFJS_OPTIONS, data: bytes.slice() }).promise;
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  // The header may be preceded by junk bytes; the spec allows it within the first 1024 bytes.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

async function readAttachments(view: PDFDocumentProxy): Promise<Attachment[]> {
  try {
    const raw = (await view.getAttachments()) as Record<
      string,
      { filename: string; content: Uint8Array }
    > | null;
    if (!raw) return [];
    return Object.values(raw).map((a) => ({ filename: a.filename, content: a.content }));
  } catch {
    return [];
  }
}

export async function loadSource(file: File, id: string, index: number): Promise<SourceDoc> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfHeader(bytes)) {
    throw new PdfLoadError(`"${file.name}" không phải file PDF hợp lệ.`);
  }

  let lib: PDFDocument;
  try {
    lib = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof Error && /encrypt/i.test(err.message)) {
      throw new PdfLoadError(
        `"${file.name}" được bảo vệ/mã hóa bằng mật khẩu. Hãy mở khóa file trước khi chỉnh sửa.`,
      );
    }
    throw new PdfLoadError(`Không đọc được "${file.name}": file có thể bị hỏng.`);
  }

  let view: PDFDocumentProxy;
  try {
    view = await openForViewing(bytes);
  } catch {
    throw new PdfLoadError(`Không hiển thị được "${file.name}": file có thể bị hỏng.`);
  }

  const pageCount = lib.getPageCount();
  if (pageCount !== view.numPages) {
    await view.destroy();
    throw new PdfLoadError(
      `"${file.name}" có cấu trúc trang không nhất quán (${pageCount} / ${view.numPages}). ` +
        'Để tránh sai lệch dữ liệu, file này không được xử lý.',
    );
  }
  if (pageCount === 0) {
    await view.destroy();
    throw new PdfLoadError(`"${file.name}" không có trang nào.`);
  }

  return {
    id,
    index,
    name: file.name,
    size: file.size,
    bytes,
    sha256: await sha256Hex(bytes),
    pageCount,
    lib,
    view,
    attachments: await readAttachments(view),
  };
}

/** The earliest-uploaded file still used in the output; its metadata is carried over. */
export function primarySource(pages: PageItem[], sources: Map<string, SourceDoc>): SourceDoc {
  const used = new Set(pages.map((p) => p.docId));
  return [...sources.values()].filter((s) => used.has(s.id)).sort((a, b) => a.index - b.index)[0];
}

/**
 * Builds the output PDF. Pages are copied object-for-object from the source
 * files (content streams, fonts, images, annotations are not re-encoded or
 * re-rendered), so the page content is identical to the original.
 */
export async function buildPdf(
  pages: PageItem[],
  sources: Map<string, SourceDoc>,
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('Không còn trang nào để xuất.');

  const out = await PDFDocument.create({ updateMetadata: false });
  const first = primarySource(pages, sources).lib;
  const title = first.getTitle();
  const author = first.getAuthor();
  const subject = first.getSubject();
  const keywords = first.getKeywords();
  const creator = first.getCreator();
  const producer = first.getProducer();
  const created = first.getCreationDate();
  if (title) out.setTitle(title);
  if (author) out.setAuthor(author);
  if (subject) out.setSubject(subject);
  if (keywords) out.setKeywords([keywords]);
  if (creator) out.setCreator(creator);
  if (producer) out.setProducer(producer);
  if (created) out.setCreationDate(created);
  out.setModificationDate(new Date());

  // Copy all pages of a source in one call so shared resources (fonts, images) are not duplicated.
  const wanted = new Map<string, number[]>();
  for (const p of pages) {
    const list = wanted.get(p.docId) ?? [];
    list.push(p.pageIndex);
    wanted.set(p.docId, list);
  }
  const copied = new Map<string, PDFPage>();
  for (const [docId, indices] of wanted) {
    const result = await out.copyPages(sources.get(docId)!.lib, indices);
    indices.forEach((idx, i) => copied.set(`${docId}:${idx}`, result[i]));
  }

  for (const p of pages) {
    const page = copied.get(`${p.docId}:${p.pageIndex}`)!;
    if (p.rotation) {
      page.setRotation(degrees(normalizeRotation(page.getRotation().angle + p.rotation)));
    }
    out.addPage(page);
  }

  return out.save({ useObjectStreams: false });
}

// ---------------------------------------------------------------------------
// Integrity verification
// ---------------------------------------------------------------------------

function contentStreams(doc: PDFDocument, pageIndex: number): Uint8Array[] {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return [];
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return streams.map((s) => (s instanceof PDFRawStream ? s.getContents() : new Uint8Array()));
}

function sameBytes(a: Uint8Array[], b: Uint8Array[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) if (a[i][j] !== b[i][j]) return false;
  }
  return true;
}

export async function getTextItems(page: PDFPageProxy): Promise<TextItem[]> {
  const content = await page.getTextContent();
  return content.items.filter((it): it is TextItem => 'str' in it);
}

function textSignature(items: TextItem[]): string {
  return items
    .map((it) => `${it.str}|${it.transform.map((n) => n.toFixed(2)).join(',')}`)
    .join('\n');
}

export interface VerifyResult {
  ok: boolean;
  pagesChecked: number;
  problems: string[];
  sha256: string;
}

/**
 * Re-opens the generated PDF and checks, page by page, that the raw content
 * streams are byte-identical to the source and that the extracted text
 * (characters and positions) and page size match exactly.
 */
export async function verifyOutput(
  output: Uint8Array,
  pages: PageItem[],
  sources: Map<string, SourceDoc>,
): Promise<VerifyResult> {
  const problems: string[] = [];
  const outLib = await PDFDocument.load(output, { updateMetadata: false });
  const outView = await openForViewing(output);
  try {
    if (outLib.getPageCount() !== pages.length || outView.numPages !== pages.length) {
      problems.push(`Số trang không khớp: cần ${pages.length}, file xuất có ${outView.numPages}.`);
    } else {
      for (let i = 0; i < pages.length; i++) {
        const item = pages[i];
        const src = sources.get(item.docId)!;
        const label = `Trang ${i + 1} (file ${src.index}, trang gốc ${item.pageIndex + 1})`;

        if (!sameBytes(contentStreams(src.lib, item.pageIndex), contentStreams(outLib, i))) {
          problems.push(`${label}: nội dung trang khác bản gốc.`);
          continue;
        }

        const [srcPage, outPage] = await Promise.all([
          src.view.getPage(item.pageIndex + 1),
          outView.getPage(i + 1),
        ]);
        if (srcPage.view.join(',') !== outPage.view.join(',')) {
          problems.push(`${label}: kích thước trang khác bản gốc.`);
        }
        const expectedRotation = normalizeRotation(srcPage.rotate + item.rotation);
        if (outPage.rotate !== expectedRotation) {
          problems.push(`${label}: góc xoay không đúng.`);
        }
        const [srcText, outText] = await Promise.all([getTextItems(srcPage), getTextItems(outPage)]);
        if (textSignature(srcText) !== textSignature(outText)) {
          problems.push(`${label}: văn bản trích xuất khác bản gốc.`);
        }
      }
    }
  } finally {
    await outView.destroy();
  }
  return {
    ok: problems.length === 0,
    pagesChecked: pages.length,
    problems,
    sha256: await sha256Hex(output),
  };
}
