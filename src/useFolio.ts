import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  KeyboardSensor,
  MouseSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { SaveFormat } from './components/SaveDialog';
import { downloadFile, formatBytes, safeFileName } from './lib/download';
import { buildPdf, loadSource, normalizeRotation, PdfLoadError, verifyOutput, type VerifyResult } from './lib/pdf';
import type { PageItem, SourceDoc } from './lib/types';
import { lockTouchScroll, SmartTouchSensor, type SmartTouchOptions } from './lib/sensors';
import { useBackHandler } from './lib/useBackHandler';
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

export interface Toast {
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

/**
 * All of Folio's document state and actions. Both UIs (classic and ui-kit)
 * render from this one controller, so switching UI keeps the open document.
 */
export function useFolio() {
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

  const openFilePicker = useCallback(() => fileInput.current?.click(), []);

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

  const clearSelection = useCallback(() => setSelected(new Set()), []);

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
    [pages, selected, commit, endDrag],
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

  const exportPdf = useCallback(
    async (name: string) => {
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
    },
    [buildVerified, pages.length, toast],
  );

  const exportXml = useCallback(
    async (name: string) => {
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
    },
    [buildVerified, pages.length, toast],
  );

  const saveFile = useCallback(
    (format: SaveFormat, name: string) => {
      setSaveAs(null);
      setOutputName(name); // remembered for the next download
      void (format === 'pdf' ? exportPdf(name) : exportXml(name));
    },
    [exportPdf, exportXml],
  );

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
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

  const hasDocs = sources.length > 0;

  // Back button on the main screen: drop the selection first, then ask before
  // closing instead of leaving the page (overlays register their own handlers on top).
  useBackHandler(hasDocs, () => {
    if (selected.size) setSelected(new Set());
    else setConfirmClose(true);
  });

  // Reload / closing the tab (desktop, Android) — iOS ignores this, the back guard covers it there.
  useEffect(() => {
    if (!hasDocs) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasDocs]);

  return {
    // document
    sources,
    sourceMap,
    pages,
    hasDocs,
    multiFile: sources.length > 1,
    deletedCount: totalOriginalPages - pages.length,
    attachments: sources.flatMap((s) => s.attachments.map((a) => ({ ...a, source: s }))),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    loading,
    busy,
    verify,
    outputName,
    // selection
    selected,
    selectPage,
    clearSelection,
    // overlays
    preview,
    setPreview,
    confirmClose,
    setConfirmClose,
    saveAs,
    setSaveAs,
    dragOver,
    setDragOver,
    toasts,
    dismissToast,
    // actions
    fileInput,
    openFilePicker,
    addFiles,
    closeDocument,
    deleteKeys,
    rotateKeys,
    moveSelectedTo,
    restoreOriginal,
    undo,
    redo,
    saveFile,
    // drag & drop
    sensors,
    activeKey,
    dragGroup,
    onDragStart,
    onDragEnd,
    endDrag,
  };
}

export type Folio = ReturnType<typeof useFolio>;
