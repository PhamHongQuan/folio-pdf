import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { getTextItems, META_KEYS, normalizeRotation, primarySource, readMetadata, sha256Hex } from './pdf';
import type { PageItem, SourceDoc } from './types';

// Characters that are not allowed in XML 1.0 are replaced with U+FFFD and flagged.
const INVALID_XML_CHARS = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;

function escape(value: string, onInvalid: () => void): string {
  return value
    .replace(INVALID_XML_CHARS, () => {
      onInvalid();
      return '�';
    })
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const num = (n: number) => String(Math.round(n * 100) / 100);

interface Positioned {
  item: TextItem;
  x: number;
  y: number;
  size: number;
}

/** Groups text items into visual lines (top to bottom, left to right). */
function buildLines(items: TextItem[]): { y: number; text: string }[] {
  const positioned: Positioned[] = items
    .filter((it) => it.str.length > 0)
    .map((item) => ({
      item,
      x: item.transform[4],
      y: item.transform[5],
      size: Math.hypot(item.transform[2], item.transform[3]) || item.height || 1,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Positioned[][] = [];
  for (const p of positioned) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - p.y) <= Math.max(1, line[0].size * 0.4)) line.push(p);
    else lines.push([p]);
  }

  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd: number | null = null;
    for (const p of line) {
      const gap = prevEnd === null ? 0 : p.x - prevEnd;
      // Separate runs that are visibly apart (or overlapping); kerning splits stay joined.
      if (prevEnd !== null && Math.abs(gap) > p.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(p.item.str)) {
        text += ' ';
      }
      text += p.item.str;
      prevEnd = p.x + p.item.width;
    }
    return { y: line[0].y, text };
  });
}

async function blobToBase64(bytes: Uint8Array): Promise<string> {
  const url: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes], { type: 'application/pdf' }));
  });
  return url.slice(url.indexOf(',') + 1);
}

export interface XmlOptions {
  /** Embed the generated PDF (base64) so the XML carries a lossless copy. */
  embedPdf: Uint8Array | null;
  includeItems: boolean;
}

export async function buildXml(
  pages: PageItem[],
  sources: Map<string, SourceDoc>,
  options: XmlOptions,
): Promise<string> {
  let invalidCharsFound = 0;
  const esc = (value: string) => escape(value, () => invalidCharsFound++);
  const usedSources = [...new Set(pages.map((p) => p.docId))]
    .map((id) => sources.get(id)!)
    .sort((a, b) => a.index - b.index);
  const first = primarySource(pages, sources).lib;
  const out: string[] = [];

  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<PdfDocument generator="Folio" version="1.0" exportedAt="${new Date().toISOString()}" pageCount="${pages.length}">`,
  );

  out.push('  <Metadata>');
  const meta = readMetadata(first);
  for (const key of META_KEYS) {
    const value = meta[key];
    const tag = key === 'ModDate' ? 'ModificationDate' : key;
    if (value) out.push(`    <${tag}>${esc(value)}</${tag}>`);
  }
  out.push('  </Metadata>');

  out.push('  <Sources>');
  for (const s of usedSources) {
    out.push(
      `    <Source id="${s.index}" fileName="${esc(s.name)}" sizeBytes="${s.size}" pageCount="${s.pageCount}" sha256="${s.sha256}"/>`,
    );
  }
  out.push('  </Sources>');

  out.push('  <Pages>');
  for (let i = 0; i < pages.length; i++) {
    const item = pages[i];
    const src = sources.get(item.docId)!;
    const page = await src.view.getPage(item.pageIndex + 1);
    const [x1, y1, x2, y2] = page.view;
    const items = await getTextItems(page);

    out.push(
      `    <Page number="${i + 1}" sourceId="${src.index}" sourcePage="${item.pageIndex + 1}" ` +
        `width="${num(x2 - x1)}" height="${num(y2 - y1)}" rotation="${normalizeRotation(page.rotate + item.rotation)}" ` +
        `hasText="${items.some((t) => t.str.trim()) ? 'true' : 'false'}">`,
    );

    out.push('      <Lines>');
    for (const line of buildLines(items)) {
      out.push(`        <Line y="${num(line.y)}">${esc(line.text)}</Line>`);
    }
    out.push('      </Lines>');

    if (options.includeItems) {
      out.push('      <TextItems>');
      for (const t of items) {
        if (!t.str) continue;
        const size = Math.hypot(t.transform[2], t.transform[3]);
        out.push(
          `        <Item x="${num(t.transform[4])}" y="${num(t.transform[5])}" width="${num(t.width)}" ` +
            `height="${num(t.height)}" fontSize="${num(size)}">${esc(t.str)}</Item>`,
        );
      }
      out.push('      </TextItems>');
    }
    out.push('    </Page>');
  }
  out.push('  </Pages>');

  if (options.embedPdf) {
    const pdf = options.embedPdf;
    out.push(
      `  <EmbeddedPdf encoding="base64" mimeType="application/pdf" sizeBytes="${pdf.length}" sha256="${await sha256Hex(pdf)}">`,
    );
    out.push(await blobToBase64(pdf));
    out.push('  </EmbeddedPdf>');
  }

  if (invalidCharsFound > 0) {
    out.push(
      `  <Warning code="INVALID_XML_CHARS" count="${invalidCharsFound}">Một số ký tự điều khiển không hợp lệ trong XML đã được thay bằng U+FFFD.</Warning>`,
    );
  }
  out.push('</PdfDocument>');
  return out.join('\n') + '\n';
}
