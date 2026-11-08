import { Icon } from './components/Icon';
import { PageGrid } from './components/PageGrid';
import { sourceColor } from './components/PageCard';
import { PreviewModal } from './components/PreviewModal';
import { SaveDialog } from './components/SaveDialog';
import { Sheet } from './components/Sheet';
import { downloadFile, formatBytes } from './lib/download';
import type { Theme } from './lib/theme';
import { useStylesheet, type UiMode } from './lib/uiMode';
import type { Folio } from './useFolio';
import classicCss from './styles.css?inline';

export interface ViewProps {
  f: Folio;
  theme: Theme;
  toggleTheme: () => void;
  ui: UiMode;
  setUi: (mode: UiMode) => void;
}

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

function UiSwitch({ ui, setUi }: Pick<ViewProps, 'ui' | 'setUi'>) {
  return (
    <div className="ui-switch" role="radiogroup" aria-label="Chọn giao diện">
      {(
        [
          ['classic', 'Cổ điển'],
          ['kit', 'Mới'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          role="radio"
          aria-checked={ui === value}
          className={ui === value ? 'active' : undefined}
          onClick={() => setUi(value)}
          title={value === 'kit' ? 'Giao diện mới (nphuonha UI kit)' : 'Giao diện cổ điển'}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Folio's original UI. */
export function ClassicView({ f, theme, toggleTheme, ui, setUi }: ViewProps) {
  useStylesheet('classic', classicCss);

  const { sources, pages, hasDocs, multiFile, verify, busy, selected } = f;
  const themeLabel = theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';

  return (
    <>
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
              <button className="btn xml-btn" onClick={() => f.setSaveAs('xml')} disabled={!!busy}>
                {busy === 'xml' ? <span className="spinner" /> : <Icon name="download" size={16} />}
                Tải XML
              </button>
              <button className="btn primary" onClick={() => f.setSaveAs('pdf')} disabled={!!busy}>
                {busy === 'pdf' ? <span className="spinner" /> : <Icon name="download" size={16} />}
                Tải PDF
              </button>
            </div>
          </>
        ) : null}
        <UiSwitch ui={ui} setUi={setUi} />
        <button className="icon-btn theme-toggle" onClick={toggleTheme} title={themeLabel} aria-label={themeLabel}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </header>

      {!hasDocs ? (
        <main className="landing">
          <h1>Sắp xếp trang PDF trong vài giây</h1>
          <p className="lead">Xóa trang thừa, đổi thứ tự, xoay trang rồi tải về PDF hoặc XML.</p>

          <button
            className={`dropzone${f.dragOver ? ' active' : ''}`}
            onClick={f.openFilePicker}
            disabled={f.loading}
          >
            {f.loading ? (
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
              <button className="btn ghost" onClick={f.openFilePicker} disabled={f.loading}>
                {f.loading ? <span className="spinner" /> : <Icon name="plus" size={16} />} Thêm PDF
              </button>
              <span className="divider" />
              <button className="icon-btn" onClick={f.undo} disabled={!f.canUndo} title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác">
                <Icon name="undo" />
              </button>
              <button className="icon-btn" onClick={f.redo} disabled={!f.canRedo} title="Làm lại (Ctrl+Y)" aria-label="Làm lại">
                <Icon name="redo" />
              </button>
              <span className="divider" />
              <button className="btn ghost" onClick={f.restoreOriginal} disabled={!f.canUndo} title="Khôi phục gốc">
                <Icon name="reset" size={16} /> <span className="label-optional">Khôi phục gốc</span>
              </button>
            </div>

            <div className="toolbar-group">
              <span className="page-count">
                {pages.length} trang
                {f.deletedCount > 0 && <span className="muted"> · đã xóa {f.deletedCount}</span>}
              </span>
              <button className="btn ghost" onClick={() => f.setConfirmClose(true)} title="Đóng tài liệu">
                <Icon name="close" size={16} /> <span className="label-optional">Đóng</span>
              </button>
            </div>
          </div>

          {(multiFile || f.attachments.length > 0) && (
            <div className="files">
              {multiFile &&
                sources.map((s) => (
                  <span key={s.id} className="file-chip" title={`${s.name}\n${formatBytes(s.size)} · SHA-256: ${s.sha256}`}>
                    <span className="dot" style={{ background: sourceColor(s) }} />
                    {s.name}
                    <span className="muted">{s.pageCount} tr</span>
                  </span>
                ))}
              {f.attachments.map((a, i) => (
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

          <PageGrid f={f} />
        </main>
      )}

      {selected.size > 0 && (
        <div className="selection-bar" role="toolbar" aria-label="Thao tác với trang đã chọn">
          <div className="selection-head">
            <span className="selection-count">{selected.size} trang đã chọn</span>
            <button className="close" onClick={f.clearSelection} aria-label="Bỏ chọn" title="Bỏ chọn (Esc)">
              <Icon name="close" size={16} />
              <span className="close-label">Bỏ chọn</span>
            </button>
          </div>
          <div className="selection-actions">
            <button onClick={() => f.rotateKeys(selected, 90)}>
              <Icon name="rotateRight" size={18} /> <span>Xoay</span>
            </button>
            <button onClick={() => f.moveSelectedTo(0)}>
              <Icon name="toTop" size={18} /> <span>Lên đầu</span>
            </button>
            <button onClick={() => f.moveSelectedTo(Infinity)}>
              <Icon name="toBottom" size={18} /> <span>Xuống cuối</span>
            </button>
            <button className="danger" onClick={() => f.deleteKeys(selected)}>
              <Icon name="trash" size={18} /> <span>Xóa</span>
            </button>
          </div>
        </div>
      )}

      {f.saveAs && (
        <SaveDialog
          format={f.saveAs}
          initialName={f.outputName}
          onCancel={() => f.setSaveAs(null)}
          onSave={(name) => f.saveFile(f.saveAs!, name)}
        />
      )}

      {f.confirmClose && (
        <Sheet
          title="Đóng tài liệu?"
          onClose={() => f.setConfirmClose(false)}
          footer={
            <>
              <button className="btn block" onClick={() => f.setConfirmClose(false)}>
                Hủy
              </button>
              <button className="btn danger-solid block" onClick={f.closeDocument}>
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

      {f.preview !== null && pages[f.preview] && (
        <PreviewModal
          pages={pages}
          index={f.preview}
          sources={f.sourceMap}
          onNavigate={f.setPreview}
          onClose={() => f.setPreview(null)}
        />
      )}

      {f.dragOver && hasDocs && (
        <div className="drop-overlay">
          <Icon name="upload" size={36} />
          Thả để thêm file PDF
        </div>
      )}

      <div className="toasts" aria-live="polite">
        {f.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  f.dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
