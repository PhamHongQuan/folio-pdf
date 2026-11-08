import { closestCenter, DndContext, DragOverlay } from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import type { Folio } from '../useFolio';
import { Icon } from './Icon';
import { PageCard, PageThumb } from './PageCard';

/**
 * The sortable page grid. Shared by both UIs: the markup is the same, each UI's
 * stylesheet styles the classes (.grid, .card, …) in its own look.
 */
export function PageGrid({ f }: { f: Folio }) {
  const { pages, sourceMap, multiFile, selected, activeKey, dragGroup } = f;
  const activeItem = activeKey ? pages.find((p) => p.key === activeKey) : undefined;

  return (
    <DndContext
      sensors={f.sensors}
      collisionDetection={closestCenter}
      onDragStart={f.onDragStart}
      onDragEnd={f.onDragEnd}
      onDragCancel={f.endDrag}
    >
      <SortableContext items={pages.map((p) => p.key)} strategy={rectSortingStrategy}>
        <ul className="grid">
          {pages.map((p, i) => (
            <PageCard
              key={p.key}
              item={p}
              position={i + 1}
              source={sourceMap.get(p.docId)!}
              multiFile={multiFile}
              selected={selected.has(p.key)}
              movingWithGroup={!!dragGroup && dragGroup.has(p.key) && p.key !== activeKey}
              onSelect={f.selectPage}
              onRotate={(key) => f.rotateKeys(new Set([key]), 90)}
              onDelete={(key) => f.deleteKeys(new Set([key]))}
              onPreview={(key) => f.setPreview(pages.findIndex((x) => x.key === key))}
            />
          ))}
          <li className="add-tile">
            <button onClick={f.openFilePicker} disabled={f.loading}>
              <Icon name="plus" size={24} />
              Thêm PDF
            </button>
          </li>
        </ul>
      </SortableContext>
      <DragOverlay>
        {activeItem && (
          <div className="drag-preview">
            <PageThumb item={activeItem} source={sourceMap.get(activeItem.docId)!} />
            {dragGroup && <span className="drag-count">{dragGroup.size} trang</span>}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
