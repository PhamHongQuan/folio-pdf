import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  cn,
  Dialog,
  Field,
  IconButton,
  Input,
  Kbd,
  Separator,
  Sheet,
  Spinner,
  Toaster,
  ToggleGroup,
  Tooltip,
  toast as kitToast,
} from '@nphuonha/ui-kit';
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  MoonIcon,
  PaperclipIcon,
  PlusIcon,
  SealCheckIcon,
  SparkleIcon,
  SunIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { ViewProps } from '../ClassicView';
import { PageCanvas } from '../components/PageCanvas';
import { PageGrid } from '../components/PageGrid';
import { sourceColor } from '../components/PageCard';
import type { SaveFormat } from '../components/SaveDialog';
import { downloadFile, formatBytes, safeFileName } from '../lib/download';
import { useBackHandler } from '../lib/useBackHandler';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { useStylesheet } from '../lib/uiMode';
import type { Folio, Toast } from '../useFolio';
import kitCss from './kit.css?inline';

type IconType = ComponentType<{ size?: number; className?: string }>;

function KitLogo() {
  return (
    <div className="flex shrink-0 items-center gap-2.5 text-primary">
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="currentColor" />
        <rect x="9" y="7" width="13" height="17" rx="2" fill="#fff" opacity=".55" />
        <rect x="12" y="10" width="13" height="17" rx="2" fill="#fff" />
      </svg>
      <span className="text-lg font-semibold tracking-[-0.02em] text-foreground">Folio</span>
    </div>
  );
}

function UiSwitch({ ui, setUi }: Pick<ViewProps, 'ui' | 'setUi'>) {
  return (
    <ToggleGroup
      aria-label="Chọn giao diện"
      items={[
        { value: 'classic', label: 'Cổ điển' },
        { value: 'kit', label: 'Mới', icon: SparkleIcon },
      ]}
      value={[ui]}
      onValueChange={(v) => {
        if (v[0] === 'classic' || v[0] === 'kit') setUi(v[0]);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function KitHeader({ f, theme, toggleTheme, ui, setUi }: ViewProps) {
  const { sources, hasDocs, multiFile, verify, busy } = f;
  const themeLabel = theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
        <KitLogo />

        {/* Phones: the file name gets its own row under the logo / switch row. */}
        <div
          className={cn('flex min-w-0 flex-1 items-center gap-2 sm:pl-2', hasDocs && 'max-sm:order-last max-sm:basis-full')}
          title={sources.map((s) => s.name).join('\n')}
        >
          {hasDocs && (
            <>
              <Separator orientation="vertical" className="hidden h-6 sm:block" />
              <span className="truncate text-sm font-medium sm:text-[15px]">{sources[0].name}</span>
              {multiFile && (
                <Badge variant="neutral" className="shrink-0">
                  +{sources.length - 1} file
                </Badge>
              )}
            </>
          )}
        </div>

        {hasDocs && (
          <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
            {verify?.ok && (
              <Tooltip content={`Nội dung từng trang khớp bản gốc · SHA-256: ${verify.sha256.slice(0, 16)}…`}>
                <Badge variant="success" className="hidden cursor-help items-center gap-1 lg:inline-flex">
                  <SealCheckIcon size={14} /> Đã xác minh {verify.pagesChecked}/{verify.pagesChecked} trang
                </Badge>
              </Tooltip>
            )}
            <Button
              variant="secondary"
              className="flex-1 sm:flex-none"
              startIcon={DownloadSimpleIcon}
              loading={busy === 'xml'}
              disabled={!!busy}
              onClick={() => f.setSaveAs('xml')}
            >
              Tải XML
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              startIcon={DownloadSimpleIcon}
              loading={busy === 'pdf'}
              disabled={!!busy}
              onClick={() => f.setSaveAs('pdf')}
            >
              Tải PDF
            </Button>
          </div>
        )}

        <UiSwitch ui={ui} setUi={setUi} />
        <Tooltip content={themeLabel}>
          <IconButton aria-label={themeLabel} variant="ghost" onClick={toggleTheme}>
            {theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

const STEPS = [
  ['Tải file lên', 'Một hoặc nhiều file PDF'],
  ['Sắp xếp', 'Kéo thả để đổi vị trí, xóa trang thừa'],
  ['Tải về', 'Định dạng PDF hoặc XML'],
] as const;

function KitLanding({ f }: { f: Folio }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 text-center sm:pt-20">
      <Badge variant="primary" className="mb-5">
        Xử lý ngay trên trình duyệt · không tải file lên máy chủ
      </Badge>
      <h1 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
        Sắp xếp trang PDF trong vài giây
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-base text-muted-foreground sm:text-lg">
        Xóa trang thừa, đổi thứ tự, xoay trang rồi tải về PDF hoặc XML.
      </p>

      <button
        type="button"
        onClick={f.openFilePicker}
        disabled={f.loading}
        className={cn(
          'surface-curved relative mt-10 flex w-full flex-col items-center gap-3 rounded-card bg-card px-6 py-12 shadow-soft outline-none',
          'transition-[box-shadow,background-color,transform] duration-[var(--duration-ui)] ease-[var(--ease-out-ui)]',
          'hover:shadow-raised focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.995] disabled:cursor-progress',
          f.dragOver && 'bg-primary-soft ring-2 ring-primary',
        )}
      >
        {f.loading ? (
          <>
            <Spinner size={34} className="text-primary" />
            <span className="text-sm text-muted-foreground">Đang mở file…</span>
          </>
        ) : (
          <>
            <span className="grid size-16 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground">
              <UploadSimpleIcon size={30} />
            </span>
            <span className="text-lg font-semibold">Chọn file PDF</span>
            <span className="text-sm text-muted-foreground">hoặc kéo thả vào đây · có thể chọn nhiều file</span>
          </>
        )}
      </button>

      <ol className="mt-6 grid gap-3 text-left sm:grid-cols-3">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="surface-curved relative flex items-start gap-3 rounded-card bg-card p-4 shadow-soft">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <div className="grid gap-0.5">
              <strong className="text-sm font-semibold">{title}</strong>
              <span className="text-sm text-muted-foreground">{text}</span>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

function KitWorkspace({ f }: { f: Folio }) {
  const { sources, pages, multiFile, verify } = f;

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-48 pt-1 sm:px-6 sm:pb-32">
      <div className="surface-curved relative flex flex-wrap items-center justify-between gap-1 rounded-card bg-card p-1.5 shadow-soft sm:gap-2 sm:p-2">
        <div className="flex items-center gap-0.5 sm:gap-1">
          <Button variant="ghost" size="sm" startIcon={PlusIcon} loading={f.loading} onClick={f.openFilePicker}>
            Thêm PDF
          </Button>
          <Separator orientation="vertical" className="mx-1 h-6 max-sm:hidden" />
          <Tooltip content={<>Hoàn tác <Kbd size="sm">Ctrl</Kbd> <Kbd size="sm">Z</Kbd></>}>
            <IconButton aria-label="Hoàn tác" variant="ghost" size="icon-sm" disabled={!f.canUndo} onClick={f.undo}>
              <ArrowUUpLeftIcon size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip content={<>Làm lại <Kbd size="sm">Ctrl</Kbd> <Kbd size="sm">Y</Kbd></>}>
            <IconButton aria-label="Làm lại" variant="ghost" size="icon-sm" disabled={!f.canRedo} onClick={f.redo}>
              <ArrowUUpRightIcon size={18} />
            </IconButton>
          </Tooltip>
          <Separator orientation="vertical" className="mx-1 h-6 max-sm:hidden" />
          <Tooltip content="Khôi phục thứ tự và trang gốc">
            <Button
              variant="ghost"
              size="sm"
              startIcon={ArrowCounterClockwiseIcon}
              disabled={!f.canUndo}
              onClick={f.restoreOriginal}
              aria-label="Khôi phục gốc"
              className="max-sm:w-9 max-sm:px-0"
            >
              <span className="hidden sm:inline">Khôi phục gốc</span>
            </Button>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <Badge variant="neutral">
            {pages.length} trang{f.deletedCount > 0 && ` · đã xóa ${f.deletedCount}`}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            startIcon={XIcon}
            onClick={() => f.setConfirmClose(true)}
            aria-label="Đóng tài liệu"
            className="max-sm:w-9 max-sm:px-0"
          >
            <span className="hidden sm:inline">Đóng</span>
          </Button>
        </div>
      </div>

      {(multiFile || f.attachments.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {multiFile &&
            sources.map((s) => (
              <Tooltip key={s.id} content={`${formatBytes(s.size)} · SHA-256: ${s.sha256.slice(0, 16)}…`}>
                <span className="surface-curved-soft relative inline-flex max-w-full items-center gap-2 rounded-pill bg-surface px-3 py-1 text-sm">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: sourceColor(s) }} />
                  <span className="truncate">{s.name}</span>
                  <span className="text-muted-foreground">{s.pageCount} tr</span>
                </span>
              </Tooltip>
            ))}
          {f.attachments.map((a, i) => (
            <Tooltip key={i} content={`Tệp đính kèm gốc trong "${a.source.name}" — tải nguyên bản`}>
              <Button
                variant="soft"
                size="sm"
                shape="pill"
                startIcon={PaperclipIcon}
                endIcon={DownloadSimpleIcon}
                onClick={() => downloadFile(a.content, a.filename, 'application/octet-stream')}
              >
                {a.filename}
              </Button>
            </Tooltip>
          ))}
        </div>
      )}

      <p className="mb-3 mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground [@media(hover:none)]:hidden">
        Kéo thả trang để đổi vị trí <span aria-hidden="true">·</span> Bấm để chọn, giữ <Kbd size="sm">Shift</Kbd> để chọn
        nhiều <span aria-hidden="true">·</span> Nhấp đúp để xem lớn
      </p>
      <p className="mb-3 mt-4 hidden text-xs text-muted-foreground [@media(hover:none)]:block">
        Giữ ⠿ hoặc nhấn giữ trang để kéo đổi vị trí · Chạm để chọn
      </p>

      {verify && !verify.ok && (
        <Alert variant="danger" icon={WarningIcon} title="Kiểm tra toàn vẹn thất bại — file không được tải xuống" className="mb-4">
          <ul className="mt-1 list-disc pl-5">
            {verify.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="kit-grid">
        <PageGrid f={f} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Selection bar
// ---------------------------------------------------------------------------

function KitSelectionBar({ f }: { f: Folio }) {
  const { selected } = f;
  const actions: Array<[string, IconType, () => void, boolean?]> = [
    ['Xoay', ArrowClockwiseIcon, () => f.rotateKeys(selected, 90)],
    ['Lên đầu', ArrowLineUpIcon, () => f.moveSelectedTo(0)],
    ['Xuống cuối', ArrowLineDownIcon, () => f.moveSelectedTo(Infinity)],
    ['Xóa', TrashIcon, () => f.deleteKeys(selected), true],
  ];

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:pb-5">
      <div
        role="toolbar"
        aria-label="Thao tác với trang đã chọn"
        className="surface-curved pointer-events-auto relative flex w-full animate-in flex-col gap-2 rounded-card bg-popover p-3 text-popover-foreground shadow-[var(--shadow-overlay)] fade-in slide-in-from-bottom-4 sm:w-auto sm:flex-row sm:items-center sm:gap-1 sm:rounded-pill sm:p-1.5 sm:pl-5"
      >
        <div className="flex items-center justify-between gap-3 sm:mr-2">
          <span className="text-sm font-semibold">{selected.size} trang đã chọn</span>
          <Button variant="ghost" size="sm" className="text-primary sm:hidden" onClick={f.clearSelection}>
            Bỏ chọn
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-1">
          {actions.map(([label, Icon, run, danger]) => (
            <Button
              key={label}
              variant={danger ? 'soft' : 'ghost'}
              size="sm"
              shape="pill"
              startIcon={Icon}
              onClick={run}
              className={cn(
                'max-sm:h-14 max-sm:flex-col max-sm:gap-1 max-sm:rounded-control max-sm:bg-surface max-sm:text-xs',
                danger && 'bg-destructive/10 text-destructive hover:bg-destructive/15 max-sm:bg-destructive/10',
              )}
            >
              {label}
            </Button>
          ))}
        </div>
        <Tooltip content={<>Bỏ chọn <Kbd size="sm">Esc</Kbd></>}>
          <IconButton aria-label="Bỏ chọn" variant="ghost" size="icon-sm" shape="pill" className="ml-1 max-sm:hidden" onClick={f.clearSelection}>
            <XIcon size={16} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

const SAVE_LABEL: Record<SaveFormat, string> = { pdf: 'Tải PDF', xml: 'Tải XML' };

function KitSaveDialog({ f, format }: { f: Folio; format: SaveFormat }) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [name, setName] = useState(f.outputName);
  const input = useRef<HTMLInputElement>(null);
  const finalName = safeFileName(name);
  const adjusted = name.trim() !== '' && finalName !== name.trim().replace(/\.(pdf|xml)$/i, '');
  const cancel = () => f.setSaveAs(null);
  useBackHandler(true, cancel);

  // The dialog moves focus into itself when it opens; then put it on the name, selected.
  useEffect(() => {
    const t = setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 60);
    return () => clearTimeout(t);
  }, []);

  const hint =
    name.trim() === ''
      ? `Để trống sẽ dùng tên “${finalName}.${format}”.`
      : adjusted
        ? `Sẽ lưu thành “${finalName}.${format}” (các ký tự \\ / : * ? " < > | không dùng được trong tên file).`
        : 'File sẽ được lưu vào thư mục Tải xuống của trình duyệt.';

  const body = (
    <form
      id="kit-save-form"
      onSubmit={(e) => {
        e.preventDefault();
        f.saveFile(format, finalName);
      }}
    >
      <Field label="Tên file" description={hint}>
        <div className="relative">
          <Input
            ref={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="tai-lieu"
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="done"
            className="pr-14 text-base sm:text-sm"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-muted-foreground">
            .{format}
          </span>
        </div>
      </Field>
    </form>
  );

  const footer = (
    <>
      <Button variant="secondary" onClick={cancel}>
        Hủy
      </Button>
      <Button type="submit" form="kit-save-form" startIcon={DownloadSimpleIcon}>
        Tải xuống
      </Button>
    </>
  );

  const onOpenChange = (open: boolean) => !open && cancel();
  return mobile ? (
    <Sheet open side="bottom" onOpenChange={onOpenChange} title={SAVE_LABEL[format]} footer={footer}>
      {body}
    </Sheet>
  ) : (
    <Dialog open onOpenChange={onOpenChange} title={SAVE_LABEL[format]} footer={footer} className="max-w-md">
      {body}
    </Dialog>
  );
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

function KitPreview({ f, index }: { f: Folio; index: number }) {
  const { pages } = f;
  const item = pages[index];
  const source = f.sourceMap.get(item.docId)!;
  const { w, h } = useViewport();
  const close = () => f.setPreview(null);
  useBackHandler(true, close);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && index > 0) f.setPreview(index - 1);
      if (e.key === 'ArrowRight' && index < pages.length - 1) f.setPreview(index + 1);
    };
    // Capture phase: the dialog's focus handling stops arrow keys from bubbling.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [f, index, pages.length]);

  const narrow = w < 640;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={`Trang ${index + 1}/${pages.length}`}
      description={`${source.name} · trang gốc ${item.pageIndex + 1}`}
      // w-max: the popup is `fixed left-1/2`, so an auto width would shrink to half the viewport.
      className="w-max max-w-[calc(100vw-1rem)] p-4 sm:p-6"
    >
      <div className="flex items-center justify-center gap-2 sm:gap-4">
        <IconButton
          aria-label="Trang trước"
          variant="secondary"
          shape="pill"
          disabled={index === 0}
          onClick={() => f.setPreview(index - 1)}
          className={cn(narrow && 'absolute left-3 top-1/2 z-10 -translate-y-1/2')}
        >
          <CaretLeftIcon size={20} />
        </IconButton>
        <div className="kit-preview-page">
          <PageCanvas
            key={item.key}
            doc={source.view}
            pageIndex={item.pageIndex}
            rotation={item.rotation}
            maxWidth={Math.max(200, Math.min(1000, w - (narrow ? 48 : 200)))}
            maxHeight={Math.max(200, h - 190)}
          />
        </div>
        <IconButton
          aria-label="Trang sau"
          variant="secondary"
          shape="pill"
          disabled={index === pages.length - 1}
          onClick={() => f.setPreview(index + 1)}
          className={cn(narrow && 'absolute right-3 top-1/2 z-10 -translate-y-1/2')}
        >
          <CaretRightIcon size={20} />
        </IconButton>
      </div>
    </Dialog>
  );
}

/** Mirrors Folio's toast list into the kit's (Sonner) toaster. */
function ToastBridge({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  const shown = useRef(new Set<number>());

  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    for (const t of toasts) {
      if (shown.current.has(t.id)) continue;
      shown.current.add(t.id);
      const show = t.kind === 'error' ? kitToast.error : t.kind === 'success' ? kitToast.success : kitToast.info;
      show(t.text, {
        id: t.id,
        duration: Infinity, // Folio's own timers decide when a toast goes away
        onDismiss: () => dismiss(t.id),
        action: t.action && {
          label: t.action.label,
          onClick: () => {
            t.action!.run();
            dismiss(t.id);
          },
        },
      });
    }
    for (const id of shown.current) {
      if (!live.has(id)) {
        shown.current.delete(id);
        kitToast.dismiss(id);
      }
    }
  }, [toasts, dismiss]);

  useEffect(() => {
    const ids = shown.current;
    return () => {
      ids.forEach((id) => kitToast.dismiss(id));
      ids.clear();
    };
  }, []);

  return null;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/** The new UI, built with @nphuonha/ui-kit. */
export default function KitView(props: ViewProps) {
  const { f, theme } = props;
  useStylesheet('kit', kitCss);
  const mobile = useMediaQuery(MOBILE_QUERY);

  return (
    <>
      <KitHeader {...props} />
      {f.hasDocs ? <KitWorkspace f={f} /> : <KitLanding f={f} />}
      {f.selected.size > 0 && <KitSelectionBar f={f} />}
      {f.saveAs && <KitSaveDialog key={f.saveAs} f={f} format={f.saveAs} />}
      <AlertDialog
        open={f.confirmClose}
        onOpenChange={f.setConfirmClose}
        title="Đóng tài liệu?"
        description="Các thay đổi chưa tải xuống sẽ bị mất. File gốc trên máy của bạn không bị ảnh hưởng."
        confirmLabel="Đóng tài liệu"
        cancelLabel="Hủy"
        icon={WarningIcon}
        onConfirm={f.closeDocument}
      />
      {f.confirmClose && <BackCloses onBack={() => f.setConfirmClose(false)} />}
      {f.preview !== null && f.pages[f.preview] && <KitPreview f={f} index={f.preview} />}
      {f.dragOver && f.hasDocs && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 border-[3px] border-dashed border-primary bg-primary-soft/90 text-lg font-semibold text-primary-soft-foreground">
          <UploadSimpleIcon size={40} />
          Thả để thêm file PDF
        </div>
      )}
      <Toaster theme={theme} position={mobile ? 'top-center' : 'bottom-right'} />
      <ToastBridge toasts={f.toasts} dismiss={f.dismissToast} />
    </>
  );
}

/** Phones' back button closes the confirmation instead of leaving the page. */
function BackCloses({ onBack }: { onBack: () => void }) {
  useBackHandler(true, onBack);
  return null;
}
