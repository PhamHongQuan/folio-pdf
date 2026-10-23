import { useEffect, useState } from 'react';
import type { PageItem, SourceDoc } from '../lib/types';
import { Icon } from './Icon';
import { PageCanvas } from './PageCanvas';

interface Props {
  pages: PageItem[];
  index: number;
  sources: Map<string, SourceDoc>;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

export function PreviewModal({ pages, index, sources, onNavigate, onClose }: Props) {
  const item = pages[index];
  const source = sources.get(item.docId)!;
  const { w, h } = useViewport();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < pages.length - 1) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, pages.length, onClose, onNavigate]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <strong>
              Trang {index + 1}/{pages.length}
            </strong>
            <span className="muted">
              {' '}
              · {source.name} · trang gốc {item.pageIndex + 1}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          <button
            className="nav-btn"
            onClick={() => onNavigate(index - 1)}
            disabled={index === 0}
            aria-label="Trang trước"
          >
            <Icon name="left" size={28} />
          </button>
          <PageCanvas
            key={item.key}
            doc={source.view}
            pageIndex={item.pageIndex}
            rotation={item.rotation}
            maxWidth={Math.max(200, Math.min(1000, w - 160))}
            maxHeight={Math.max(200, h - 140)}
          />
          <button
            className="nav-btn"
            onClick={() => onNavigate(index + 1)}
            disabled={index === pages.length - 1}
            aria-label="Trang sau"
          >
            <Icon name="right" size={28} />
          </button>
        </div>
      </div>
    </div>
  );
}
