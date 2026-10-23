import type { MouseEvent, PointerEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PageItem, SourceDoc } from '../lib/types';
import { Icon } from './Icon';
import { PageCanvas } from './PageCanvas';

export const THUMB_W = 150;
export const THUMB_H = 200;

const SOURCE_COLORS = ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2'];
export const sourceColor = (src: SourceDoc) => SOURCE_COLORS[(src.index - 1) % SOURCE_COLORS.length];

interface ThumbProps {
  item: PageItem;
  source: SourceDoc;
}

/** The page image with its file colour marker; shared by the grid card and the drag preview. */
export function PageThumb({ item, source }: ThumbProps) {
  return (
    <div className="thumb">
      <PageCanvas
        doc={source.view}
        pageIndex={item.pageIndex}
        rotation={item.rotation}
        maxWidth={THUMB_W}
        maxHeight={THUMB_H}
        lazy
      />
    </div>
  );
}

interface Props {
  item: PageItem;
  position: number;
  source: SourceDoc;
  multiFile: boolean;
  selected: boolean;
  /** Another selected page is being dragged together with this one. */
  movingWithGroup: boolean;
  onSelect: (key: string, range: boolean) => void;
  onRotate: (key: string) => void;
  onDelete: (key: string) => void;
  onPreview: (key: string) => void;
}

const stop = (e: PointerEvent | MouseEvent) => e.stopPropagation();

export function PageCard({
  item,
  position,
  source,
  multiFile,
  selected,
  movingWithGroup,
  onSelect,
  onRotate,
  onDelete,
  onPreview,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
  });

  const classes = ['card'];
  if (selected) classes.push('selected');
  if (isDragging || movingWithGroup) classes.push('placeholder');

  return (
    <li
      ref={setNodeRef}
      className={classes.join(' ')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`Trang ${position}${selected ? ', đã chọn' : ''}`}
      onClick={(e) => onSelect(item.key, e.shiftKey)}
      onDoubleClick={() => onPreview(item.key)}
    >
      <div className="card-frame">
        <PageThumb item={item} source={source} />

        <span className="card-check" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>

        {item.rotation !== 0 && <span className="card-badge">{item.rotation}°</span>}

        <div className="card-tools" onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
          <button onClick={() => onPreview(item.key)} title="Xem lớn" aria-label="Xem lớn">
            <Icon name="zoom" size={16} />
          </button>
          <button onClick={() => onRotate(item.key)} title="Xoay 90°" aria-label="Xoay 90°">
            <Icon name="rotateRight" size={16} />
          </button>
          <button className="danger" onClick={() => onDelete(item.key)} title="Xóa trang" aria-label="Xóa trang">
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>

      <div className="card-label">
        {multiFile && <span className="dot" style={{ background: sourceColor(source) }} />}
        <span className="card-number">{position}</span>
        <span className="card-origin" title={`${source.name} — trang gốc ${item.pageIndex + 1}`}>
          gốc {item.pageIndex + 1}
        </span>
      </div>
    </li>
  );
}
