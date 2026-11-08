import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { normalizeRotation } from '../lib/pdf';

interface Props {
  doc: PDFDocumentProxy;
  pageIndex: number;
  /** Extra rotation on top of the page's own /Rotate. */
  rotation: number;
  maxWidth: number;
  maxHeight: number;
  /** Render only when scrolled into view. */
  lazy?: boolean;
}

/**
 * Thumbnails already drawn, per document. Switching UI remounts every card;
 * copying from here is far cheaper than another pdf.js render. Entries go
 * away with the document (WeakMap) and each document keeps a bounded number.
 */
const thumbCache = new WeakMap<PDFDocumentProxy, Map<string, HTMLCanvasElement>>();
const THUMBS_PER_DOC = 150;

function cachedThumb(doc: PDFDocumentProxy, key: string): HTMLCanvasElement | null {
  const src = thumbCache.get(doc)?.get(key);
  if (!src) return null;
  // A copy, since the same page can be on screen twice (card + drag preview).
  const copy = document.createElement('canvas');
  copy.width = src.width;
  copy.height = src.height;
  copy.style.width = src.style.width;
  copy.style.height = src.style.height;
  copy.getContext('2d')?.drawImage(src, 0, 0);
  return copy;
}

function storeThumb(doc: PDFDocumentProxy, key: string, canvas: HTMLCanvasElement) {
  let map = thumbCache.get(doc);
  if (!map) thumbCache.set(doc, (map = new Map()));
  map.delete(key);
  map.set(key, canvas);
  if (map.size > THUMBS_PER_DOC) map.delete(map.keys().next().value!);
}

/** Renders a PDF page to a canvas (display only — never touches the PDF data). */
export function PageCanvas({ doc, pageIndex, rotation, maxWidth, maxHeight, lazy = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    if (visible || !hostRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cacheKey = `${pageIndex}:${rotation}:${maxWidth}x${maxHeight}@${dpr}`;

    // Only thumbnails (lazy) are cached; the large preview is rendered fresh.
    const hit = lazy ? cachedThumb(doc, cacheKey) : null;
    if (hit && hostRef.current) {
      hostRef.current.replaceChildren(hit);
      setState('done');
      return;
    }
    setState('loading');

    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled) return;
      const angle = normalizeRotation(page.rotate + rotation);
      const base = page.getViewport({ scale: 1, rotation: angle });
      const scale = Math.min(maxWidth / base.width, maxHeight / base.height);
      const viewport = page.getViewport({ scale: scale * dpr, rotation: angle });

      // A fresh canvas per render avoids pdf.js "same canvas" errors when re-rendering quickly.
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');

      task = page.render({ canvasContext: ctx, viewport });
      await task.promise;
      if (lazy) storeThumb(doc, cacheKey, canvas);
      if (cancelled || !hostRef.current) return;
      hostRef.current.replaceChildren(canvas);
      setState('done');
    })().catch((err: unknown) => {
      if (cancelled || (err instanceof Error && err.name === 'RenderingCancelledException')) return;
      setState('error');
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, pageIndex, rotation, maxWidth, maxHeight, lazy]);

  return (
    <div className="page-canvas" style={{ width: maxWidth, height: maxHeight }}>
      <div ref={hostRef} className="page-canvas-host" />
      {state === 'loading' && <div className="page-canvas-status spinner" aria-label="Đang tải" />}
      {state === 'error' && <div className="page-canvas-status error">Không hiển thị được</div>}
    </div>
  );
}
