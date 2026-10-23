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
    setState('loading');

    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled) return;
      const angle = normalizeRotation(page.rotate + rotation);
      const base = page.getViewport({ scale: 1, rotation: angle });
      const scale = Math.min(maxWidth / base.width, maxHeight / base.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  }, [visible, doc, pageIndex, rotation, maxWidth, maxHeight]);

  return (
    <div className="page-canvas" style={{ width: maxWidth, height: maxHeight }}>
      <div ref={hostRef} className="page-canvas-host" />
      {state === 'loading' && <div className="page-canvas-status spinner" aria-label="Đang tải" />}
      {state === 'error' && <div className="page-canvas-status error">Không hiển thị được</div>}
    </div>
  );
}
