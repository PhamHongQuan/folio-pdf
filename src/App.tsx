import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Icon } from './components/Icon';
import { PageCard, PageThumb, sourceColor } from './components/PageCard';
import { PreviewModal } from './components/PreviewModal';
import { SaveDialog, type SaveFormat } from './components/SaveDialog';
import { Sheet } from './components/Sheet';
import { downloadFile, formatBytes, safeFileName } from './lib/download';
import { buildPdf, loadSource, normalizeRotation, PdfLoadError, verifyOutput, type VerifyResult } from './lib/pdf';
import type { PageItem, SourceDoc } from './lib/types';
import { lockTouchScroll, SmartTouchSensor, type SmartTouchOptions } from './lib/sensors';
import { useTheme } from './lib/theme';
import { buildAps } from './lib/aps';

// ---------------------------------------------------------------------------
// Undo/redo history for the page layout
// ---------------------------------------------------------------------------

interface History {
  past: PageItem[][];
  present: PageItem[];
  future: PageItem[][];
}

type HistoryAction =
  | { type: 'commit'; pages: PageItem[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' };

const HISTORY_LIMIT = 200;

function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case 'commit':
      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: action.pages,
        future: [],
      };
    case 'undo':
      if (!state.past.length) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    case 'redo':
      if (!state.future.length) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
    case 'clear':
      return { past: [], present: [], future: [] };
  }
}

interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
  action?: { label: string; run: () => void };
}

const pagesOf = (src: SourceDoc): PageItem[] =>
  Array.from({ length: src.pageCount }, (_, i) => ({
    key: `${src.id}:${i}`,
    docId: src.id,
    pageIndex: i,
    rotation: 0,
  }));

function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="28" height="28">
          <rect width="32" height="32" rx="8" fill="currentColor" />
          <rect x="9" y="7" width="13" height="17" rx="2" fill="#fff" opacity=".55" />
          <rect x="12" y="10" width="13" height="17" rx="2" fill="#fff" />
        </svg>
      </span>
      <span className="logo-text">Folio</span>
    </div>
  );
}

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const label = theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
  return (
    <button className="icon-btn theme-toggle" onClick={toggle} title={label} aria-label={label}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

export default function App() {
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: [], future: [] });
  const pages = history.present;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'xml'>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [outputName, setOutputName] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [saveAs, setSaveAs] = useState<SaveFormat | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);

  const sourceMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const totalOriginalPages = useMemo(() => sources.reduce((n, s) => n + s.pageCount, 0), [sources]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (kind: Toast['kind'], text: string, action?: Toast['action']) => {
      const id = ++idCounter.current;
      setToasts((t) => [...t.slice(-3), { id, kind, text, action }]);
      setTimeout(() => dismissToast(id), kind === 'error' || action ? 8000 : 3500);
    },
    [dismissToast],
  );

  // Any layout change makes older "Hoàn tác" toast buttons ambiguous, so drop them.
  const changed = useCallback(() => {
    setVerify(null);
    setToasts((t) => t.filter((x) => !x.action));
  }, []);

  const commit = useCallback(
    (next: PageItem[]) => {
      dispatch({ type: 'commit', pages: next });
      changed();
    },
    [changed],
  );

  const undo = useCallback(() => {
    dispatch({ type: 'undo' });
    changed();
  }, [changed]);

  const redo = useCallback(() => {
    dispatch({ type: 'redo' });
    changed();
  }, [changed]);

  // Drop selections that no longer exist (after delete / undo).
  useEffect(() => {
    setSelected((sel) => {
      const keys = new Set(pages.map((p) => p.key));
      const next = new Set([...sel].filter((k) => keys.has(k)));
      return next.size === sel.size ? sel : next;
    });
    setPreview((p) => (p !== null && p >= pages.length ? (pages.length ? pages.length - 1 : null) : p));
  }, [pages]);

  // -------------------------------------------------------------------------
  // Loading files
  // -------------------------------------------------------------------------

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (!files.length) {
        toast('error', 'Vui lòng chọn file PDF.');
        return;
      }
      setLoading(true);
      const loaded: SourceDoc[] = [];
      let index = sources.length;
      for (const file of files) {
        try {
          const id = `d${++idCounter.current}`;
          loaded.push(await loadSource(file, id, index + 1));
          index++;
        } catch (err) {
          if (!(err instanceof PdfLoadError)) console.error('PDF load failed', err);
          toast('error', err instanceof PdfLoadError ? err.message : `Lỗi khi đọc "${file.name}".`);
        }
      }
      setLoading(false);
      if (!loaded.length) return;

      setSources((prev) => [...prev, ...loaded]);
      commit([...pages, ...loaded.flatMap(pagesOf)]);
      if (!outputName) setOutputName(`${loaded[0].name.replace(/\.pdf$/i, '')}_edited`);
      if (sources.length) {
        toast('success', `Đã thêm ${loaded.reduce((n, s) => n + s.pageCount, 0)} trang.`);
      }
    },
    [sources.length, pages, outputName, commit, toast],
  );

  const closeDocument = useCallback(() => {
    setConfirmClose(false);
    sources.forEach((s) => void s.view.destroy());
    setSources([]);
    dispatch({ type: 'clear' });
    setSelected(new Set());
    setVerify(null);
    setOutputName('');
    setPreview(null);
  }, [sources]);

  // -------------------------------------------------------------------------
  // Page operations
  // -------------------------------------------------------------------------

  const deleteKeys = useCallback(
    (keys: Set<string>) => {
      if (!keys.size) return;
      const next = pages.filter((p) => !keys.has(p.key));
      if (!next.length) {
        toast('error', 'Tài liệu phải còn ít nhất 1 trang.');
        return;
      }
      commit(next);
      toast('info', `Đã xóa ${keys.size} trang`, { label: 'Hoàn tác', run: undo });
    },
    [pages, commit, toast, undo],
  );

  const rotateKeys = useCallback(
    (keys: Set<string>, delta: number) => {
      if (!keys.size) return;
      commit(
        pages.map((p) => (keys.has(p.key) ? { ...p, rotation: normalizeRotation(p.rotation + delta) } : p)),
      );
    },
    [pages, commit],
  );

  /** Moves the selected pages (keeping their relative order) so the first lands at `position` (0-based). */
  const moveSelectedTo = useCallback(
    (position: number) => {
      const picked = pages.filter((p) => selected.has(p.key));
      if (!picked.length) return;
      const rest = pages.filter((p) => !selected.has(p.key));
      const at = Math.max(0, Math.min(position, rest.length));
      commit([...rest.slice(0, at), ...picked, ...rest.slice(at)]);
    },
    [pages, selected, commit],
  );

  const lastDragEnd = useRef(0);

  const selectPage = useCallback(
    (key: string, range: boolean) => {
      // The pointer-up at the end of a drag also produces a click; ignore it.
      if (Date.now() - lastDragEnd.current < 200) return;
      setSelected((sel) => {
        const next = new Set(sel);
        if (range && lastClicked) {
          const a = pages.findIndex((p) => p.key === lastClicked);
          const b = pages.findIndex((p) => p.key === key);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) next.add(pages[i].key);
            return next;
          }
        }
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setLastClicked(key);
    },
    [pages, lastClicked],
  );

  const restoreOriginal = useCallback(() => {
    commit(sources.flatMap(pagesOf));
    toast('info', 'Đã khôi phục tài liệu ban đầu', { label: 'Hoàn tác', run: undo });
  }, [sources, commit, toast, undo]);

  // -------------------------------------------------------------------------
  // Drag & drop reordering (a selected group moves together)
  // -------------------------------------------------------------------------

  const sensors = useSensors(
    // Mouse: drag after a small movement. Touch: the ⠿ handle drags at once, anywhere else
    // needs a long-press, so ordinary swipes keep scrolling the page.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(SmartTouchSensor, {
      activationConstraint: { delay: 250, tolerance: 6 },
      handleConstraint: { distance: 4 },
    } as SmartTouchOptions),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const unlockScroll = useRef<(() => void) | null>(null);
  const endDrag = useCallback(() => {
    setActiveKey(null);
    lastDragEnd.current = Date.now();
    unlockScroll.current?.();
    unlockScroll.current = null;
  }, []);
  useEffect(() => () => unlockScroll.current?.(), []);

  const dragGroup = activeKey && selected.has(activeKey) && selected.size > 1 ? selected : null;

  const onDragStart = useCallback(({ active, activatorEvent }: DragStartEvent) => {
    setActiveKey(String(active.id));
    if (typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent) {
      unlockScroll.current = lockTouchScroll();
      navigator.vibrate?.(15);
    }
  }, []);

  const onDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      endDrag();
      if (!over || active.id === over.id) return;
      const from = pages.findIndex((p) => p.key === active.id);
      const to = pages.findIndex((p) => p.key === over.id);
      if (from < 0 || to < 0) return;

      if (!selected.has(String(active.id)) || selected.size < 2) {
        commit(arrayMove(pages, from, to));
        return;
      }
      if (selected.has(String(over.id))) return;
      const picked = pages.filter((p) => selected.has(p.key));
      const rest = pages.filter((p) => !selected.has(p.key));
      const overIdx = rest.findIndex((p) => p.key === over.id);
      const at = from < to ? overIdx + 1 : overIdx;
      commit([...rest.slice(0, at), ...picked, ...rest.slice(at)]);
    },
    [pages, selected, commit],
  );

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  // Reuse the verified file while the layout is unchanged, so the PDF and the
  // PDF embedded in the XML are byte-identical (same SHA-256).
  const lastBuilt = useRef<{ pages: PageItem[]; bytes: Uint8Array } | null>(null);

  const buildVerified = useCallback(async (): Promise<Uint8Array | null> => {
    if (lastBuilt.current?.pages === pages) return lastBuilt.current.bytes;
    const bytes = await buildPdf(pages, sourceMap);
    const result = await verifyOutput(bytes, pages, sourceMap);
    setVerify(result);
    if (!result.ok) {
      toast('error', 'Kiểm tra toàn vẹn thất bại — file không được tải xuống.');
      return null;
    }
    lastBuilt.current = { pages, bytes };
    return bytes;
  }, [pages, sourceMap, toast]);

  const exportPdf = useCallback(async (name: string) => {
    setBusy('pdf');
    try {
      const bytes = await buildVerified();
      if (!bytes) return;
      downloadFile(bytes, `${safeFileName(name)}.pdf`, 'application/pdf');
      toast('success', `Đã tải PDF · ${pages.length} trang · ${formatBytes(bytes.length)}`);
    } catch (err) {
      console.error('PDF export failed', err);
      toast('error', 'Không xuất được PDF. Vui lòng thử lại hoặc kiểm tra file gốc.');
    } finally {
      setBusy(null);
    }
  }, [buildVerified, pages.length, toast]);

  const exportXml = useCallback(async (name: string) => {
    setBusy('xml');
    try {
      const bytes = await buildVerified();
      if (!bytes) return;
      // Aspose APS layout XML, built from the verified output PDF.
      const xml = await buildAps(bytes);
      downloadFile(xml, `${safeFileName(name)}.xml`, 'application/xml;charset=utf-8');
      toast('success', `Đã tải XML · ${pages.length} trang`);
    } catch (err) {
      console.error('XML export failed', err);
      toast('error', 'Không xuất được XML. Vui lòng thử lại hoặc kiểm tra file gốc.');
    } finally {
      setBusy(null);
    }
  }, [buildVerified, pages.length, toast]);

  const saveFile = useCallback(
    (format: SaveFormat, name: string) => {
      setSaveAs(null);
      setOutputName(name); // remembered for the next download
      void (format === 'pdf' ? exportPdf(name) : exportXml(name));
    },
    [exportPdf, exportXml],
  );

  // -------------------------------------------------------------------------
  // Keyboard shortcuts & menus
  // -------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (preview !== null || confirmClose || saveAs || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && key === 'a' && pages.length) {
        e.preventDefault();
        setSelected(new Set(pages.map((p) => p.key)));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
        e.preventDefault();
        deleteKeys(selected);
      } else if (e.key === 'Escape') {
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, confirmClose, saveAs, pages, selected, deleteKeys, undo, redo]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const hasDocs = sources.length > 0;
  const multiFile = sources.length > 1;
  const deletedCount = totalOriginalPages - pages.length;
  const attachments = sources.flatMap((s) => s.attachments.map((a) => ({ ...a, source: s })));
  const activeItem = activeKey ? pages.find((p) => p.key === activeKey) : undefined;

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <header className="header">
        <Logo />
        {hasDocs ? (
          <>
            <div className="doc-name" title={sources.map((s) => s.name).join('\n')}>
              <span className="doc-title">{sources[0].name}</span>
              {multiFile && <span className="muted">+{sources.length - 1} file</span>}
            </div>
            <div className="header-actions">
              {verify?.ok && (
                <span className="verified" title={`Nội dung từng trang khớp bản gốc.\nSHA-256: ${verify.sha256}`}>
                  <Icon name="check" size={14} /> Đã xác minh {verify.pagesChecked}/{verify.pagesChecked} trang
                </span>
              )}
              <button className="btn xml-btn" onClick={() => setSaveAs('xml')} disabled={!!busy}>
                {busy === 'xml' ? <span className="spinner" /> : <Icon name="download" size={16} />}
                Tải XML
              </button>
              <button className="btn primary" onClick={() => setSaveAs('pdf')} disabled={!!busy}>
                {busy === 'pdf' ? <span className="spinner" /> : <Icon name="download" size={16} />}
                Tải PDF
              </button>
            </div>
          </>
        ) : null}
        <ThemeToggle />
      </header>

      {!hasDocs ? (
        <main className="landing">
          <h1>Sắp xếp trang PDF trong vài giây</h1>
          <p className="lead">Xóa trang thừa, đổi thứ tự, xoay trang rồi tải về PDF hoặc XML.</p>

          <button
            className={`dropzone${dragOver ? ' active' : ''}`}
            onClick={() => fileInput.current?.click()}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner large" />
                <span className="muted">Đang mở file…</span>
              </>
            ) : (
              <>
                <span className="dropzone-icon">
                  <Icon name="upload" size={28} />
                </span>
                <span className="dropzone-title">Chọn file PDF</span>
                <span className="muted">hoặc kéo thả vào đây · có thể chọn nhiều file</span>
              </>
            )}
          </button>

          <ol className="steps">
            <li>
              <span className="step-no">1</span>
              <div>
                <strong>Tải file lên</strong>
                <span>Một hoặc nhiều file PDF</span>
              </div>
            </li>
            <li>
              <span className="step-no">2</span>
              <div>
                <strong>Sắp xếp</strong>
                <span>Kéo thả để đổi vị trí, xóa trang thừa</span>
              </div>
            </li>
            <li>
              <span className="step-no">3</span>
              <div>
                <strong>Tải về</strong>
                <span>Định dạng PDF hoặc XML</span>
              </div>
            </li>
          </ol>

        </main>
      ) : (
        <main className="workspace">
          <div className="toolbar">
            <div className="toolbar-group">
              <button className="btn ghost" onClick={() => fileInput.current?.click()} disabled={loading}>
                {loading ? <span className="spinner" /> : <Icon name="plus" size={16} />} Thêm PDF
              </button>
              <span className="divider" />
              <button className="icon-btn" onClick={undo} disabled={!history.past.length} title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác">
                <Icon name="undo" />
              </button>
              <button className="icon-btn" onClick={redo} disabled={!history.future.length} title="Làm lại (Ctrl+Y)" aria-label="Làm lại">
                <Icon name="redo" />
              </button>
              <span className="divider" />
              <button className="btn ghost" onClick={restoreOriginal} disabled={!history.past.length} title="Khôi phục gốc">
                <Icon name="reset" size={16} /> <span className="label-optional">Khôi phục gốc</span>
              </button>
            </div>

            <div className="toolbar-group">
              <span className="page-count">
                {pages.length} trang
                {deletedCount > 0 && <span className="muted"> · đã xóa {deletedCount}</span>}
              </span>
              <button className="btn ghost" onClick={() => setConfirmClose(true)} title="Đóng tài liệu">
                <Icon name="close" size={16} /> <span className="label-optional">Đóng</span>
              </button>
            </div>
          </div>

          {(multiFile || attachments.length > 0) && (
            <div className="files">
              {multiFile &&
                sources.map((s) => (
                  <span key={s.id} className="file-chip" title={`${s.name}\n${formatBytes(s.size)} · SHA-256: ${s.sha256}`}>
                    <span className="dot" style={{ background: sourceColor(s) }} />
                    {s.name}
                    <span className="muted">{s.pageCount} tr</span>
                  </span>
                ))}
              {attachments.map((a, i) => (
                <button
                  key={i}
                  className="file-chip attachment"
                  onClick={() => downloadFile(a.content, a.filename, 'application/octet-stream')}
                  title={`Tệp đính kèm gốc trong "${a.source.name}" — tải nguyên bản`}
                >
                  <Icon name="paperclip" size={14} /> {a.filename}
                  <Icon name="download" size={14} />
                </button>
              ))}
            </div>
          )}

          <p className="hint hint-mouse">
            <Icon name="move" size={14} /> Kéo thả trang để đổi vị trí
            <span className="sep">·</span> Bấm để chọn, Shift để chọn nhiều
            <span className="sep">·</span> Nhấp đúp để xem lớn
          </p>
          <p className="hint hint-touch">Giữ ⠿ hoặc nhấn giữ trang để kéo đổi vị trí · Chạm để chọn</p>

          {verify && !verify.ok && (
            <section className="alert" role="alert">
              <Icon name="alert" />
              <div>
                <strong>Kiểm tra toàn vẹn thất bại — file không được tải xuống</strong>
                <ul>
                  {verify.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={endDrag}
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
                    onSelect={selectPage}
                    onRotate={(key) => rotateKeys(new Set([key]), 90)}
                    onDelete={(key) => deleteKeys(new Set([key]))}
                    onPreview={(key) => setPreview(pages.findIndex((x) => x.key === key))}
                  />
                ))}
                <li className="add-tile">
                  <button onClick={() => fileInput.current?.click()} disabled={loading}>
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
        </main>
      )}

      {selected.size > 0 && (
        <div className="selection-bar" role="toolbar" aria-label="Thao tác với trang đã chọn">
          <div className="selection-head">
            <span className="selection-count">{selected.size} trang đã chọn</span>
            <button className="close" onClick={() => setSelected(new Set())} aria-label="Bỏ chọn" title="Bỏ chọn (Esc)">
              <Icon name="close" size={16} />
              <span className="close-label">Bỏ chọn</span>
            </button>
          </div>
          <div className="selection-actions">
            <button onClick={() => rotateKeys(selected, 90)}>
              <Icon name="rotateRight" size={18} /> <span>Xoay</span>
            </button>
            <button onClick={() => moveSelectedTo(0)}>
              <Icon name="toTop" size={18} /> <span>Lên đầu</span>
            </button>
            <button onClick={() => moveSelectedTo(Infinity)}>
              <Icon name="toBottom" size={18} /> <span>Xuống cuối</span>
            </button>
            <button className="danger" onClick={() => deleteKeys(selected)}>
              <Icon name="trash" size={18} /> <span>Xóa</span>
            </button>
          </div>
        </div>
      )}

      {saveAs && (
        <SaveDialog
          format={saveAs}
          initialName={outputName}
          onCancel={() => setSaveAs(null)}
          onSave={(name) => saveFile(saveAs, name)}
        />
      )}

      {confirmClose && (
        <Sheet
          title="Đóng tài liệu?"
          onClose={() => setConfirmClose(false)}
          footer={
            <>
              <button className="btn block" onClick={() => setConfirmClose(false)}>
                Hủy
              </button>
              <button className="btn danger-solid block" onClick={closeDocument}>
                Đóng tài liệu
              </button>
            </>
          }
        >
          <p className="sheet-text">
            Các thay đổi chưa tải xuống sẽ bị mất. File gốc trên máy của bạn không bị ảnh hưởng.
          </p>
        </Sheet>
      )}

      {preview !== null && pages[preview] && (
        <PreviewModal
          pages={pages}
          index={preview}
          sources={sourceMap}
          onNavigate={setPreview}
          onClose={() => setPreview(null)}
        />
      )}

      {dragOver && hasDocs && (
        <div className="drop-overlay">
          <Icon name="upload" size={36} />
          Thả để thêm file PDF
        </div>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
