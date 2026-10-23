import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { Icon } from './Icon';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons row at the bottom. */
  footer?: ReactNode;
}

const CLOSE_DISTANCE = 90;

/**
 * Bottom sheet on phones (slides up, swipe down to close), centred dialog on
 * larger screens. Rendered in a portal so no ancestor (e.g. the blurred
 * sticky header) can trap its fixed positioning.
 */
export function Sheet({ title, onClose, children, footer }: Props) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
    };
  }, []);

  const onTouchStart = (e: TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (startY.current === null) return;
    setDragY(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const onTouchEnd = () => {
    startY.current = null;
    if (dragY > CLOSE_DISTANCE) onClose();
    else setDragY(0);
  };

  return createPortal(
    <div className={`sheet-backdrop ${mobile ? 'is-sheet' : 'is-dialog'}`} onClick={onClose}>
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
      >
        <div
          className="sheet-head"
          onTouchStart={mobile ? onTouchStart : undefined}
          onTouchMove={mobile ? onTouchMove : undefined}
          onTouchEnd={mobile ? onTouchEnd : undefined}
        >
          {mobile && <span className="sheet-grabber" aria-hidden="true" />}
          <div className="sheet-title">
            <strong>{title}</strong>
            <button className="icon-btn" onClick={onClose} aria-label="Đóng">
              <Icon name="close" />
            </button>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
