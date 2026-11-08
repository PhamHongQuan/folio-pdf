import { useEffect, useState, type CSSProperties } from 'react';
import type { Theme } from '../lib/theme';
import type { UiMode } from '../lib/uiMode';

const FADE_MS = 180;
const MAX_CARDS = 12;

/** Colours / radii of the UI being switched to, so the skeleton looks like what is coming. */
const LOOKS: Record<UiMode, Record<Theme, Record<string, string>>> = {
  classic: {
    light: { bg: '#f6f7f9', surface: '#ffffff', block: '#e7eaee', hl: 'rgba(255,255,255,0.65)', line: '#e3e6ea' },
    dark: { bg: '#0e1116', surface: '#161b22', block: '#222a35', hl: 'rgba(255,255,255,0.06)', line: '#262d37' },
  },
  kit: {
    light: { bg: '#f3f4f8', surface: '#ffffff', block: '#e4e7ef', hl: 'rgba(255,255,255,0.7)', line: 'transparent' },
    dark: { bg: '#0d0f15', surface: '#171a22', block: '#232835', hl: 'rgba(255,255,255,0.06)', line: 'transparent' },
  },
};

const RADII: Record<UiMode, { btn: string; card: string; bar: string }> = {
  classic: { btn: '8px', card: '12px', bar: '0px' },
  kit: { btn: '999px', card: '18px', bar: '20px' },
};

/*
 * Self-contained stylesheet: during the switch neither UI's CSS can be relied on.
 * The shimmer moves with `transform`, which the compositor animates, so it keeps
 * running even while the main thread is busy mounting the new UI.
 */
const CSS = `
.fsk{position:fixed;inset:0;z-index:1000;overflow:hidden;background:var(--sk-bg);transition:opacity ${FADE_MS}ms ease;
  font-family:Inter,"Segoe UI",system-ui,sans-serif}
.fsk i{display:block;position:relative;overflow:hidden;background:var(--sk-block);border-radius:6px;flex-shrink:0}
.fsk i::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,var(--sk-hl),transparent);animation:fsk-sweep 1.3s ease-in-out infinite}
@keyframes fsk-sweep{to{transform:translateX(100%)}}
.fsk-header{height:60px;display:flex;align-items:center;gap:12px;padding:0 24px;background:var(--sk-head);border-bottom:1px solid var(--sk-line)}
.fsk-sp{flex:1}
.fsk-main{padding:16px 24px;max-width:1400px;margin:0 auto}
.fsk-toolbar{display:flex;align-items:center;gap:10px;overflow:hidden;padding:10px;border-radius:var(--sk-r-bar);background:var(--sk-bar)}
.fsk-grid{display:grid;grid-template-columns:repeat(auto-fill,180px);gap:24px 20px;margin-top:18px}
.fsk-card{display:flex;flex-direction:column;align-items:center;gap:10px}
.fsk-frame{width:100%;padding:12px;border-radius:var(--sk-r-card);background:var(--sk-surface);display:flex;justify-content:center;
  box-shadow:0 1px 3px rgba(0,0,0,.06)}
.fsk-landing{max-width:720px;margin:0 auto;padding:72px 16px;display:flex;flex-direction:column;align-items:center;gap:14px}
.fsk-drop{width:100%;height:220px;margin-top:22px;border-radius:var(--sk-r-card);background:var(--sk-surface);display:grid;place-items:center}
.fsk-steps{width:100%;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:8px}
.fsk-step{height:72px;border-radius:var(--sk-r-card);background:var(--sk-surface);display:flex;align-items:center;gap:12px;padding:0 16px}
.fsk .fsk-only-sm{display:none}
.fsk-mobile{flex-direction:column;gap:10px;padding:4px 16px 0}
.fsk-mobile-row{display:flex;gap:8px}
.fsk-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (max-width:760px){
  .fsk-header{padding:0 16px}.fsk-main{padding:12px 16px}.fsk .fsk-hide-sm{display:none}.fsk .fsk-only-sm{display:flex}.fsk-toolbar{gap:6px}
  .fsk-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 12px}
  .fsk-steps{grid-template-columns:1fr}.fsk-landing{padding-top:40px}
}
@media (prefers-reduced-motion:reduce){.fsk i::after{animation:none}}
`;

const b = (w: number | string, h: number, r?: string): CSSProperties => ({ width: w, height: h, borderRadius: r });

interface Props {
  /** The UI being switched to; null when no switch is running. */
  target: UiMode | null;
  theme: Theme;
  hasDocs: boolean;
  pageCount: number;
}

/** Skeleton of the target UI, shown while switching UI. */
export function SwitchSkeleton({ target, theme, hasDocs, pageCount }: Props) {
  // Keep the last target while fading out.
  const [shown, setShown] = useState<UiMode | null>(target);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (target) {
      setShown(target);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const t = setTimeout(() => setShown(null), FADE_MS);
    return () => clearTimeout(t);
  }, [target]);

  if (!shown) return null;
  const look = LOOKS[shown][theme];
  const r = RADII[shown];
  const kit = shown === 'kit';

  const vars = {
    '--sk-bg': look.bg,
    '--sk-surface': look.surface,
    '--sk-block': look.block,
    '--sk-hl': look.hl,
    '--sk-line': look.line,
    '--sk-head': kit ? look.bg : look.surface,
    '--sk-bar': kit ? look.surface : 'transparent',
    '--sk-r-card': r.card,
    '--sk-r-bar': r.bar,
    opacity: leaving ? 0 : 1,
  } as CSSProperties;

  return (
    <div className="fsk" style={vars} role="status" aria-live="polite">
      <style>{CSS}</style>
      <span className="fsk-sr">Đang chuyển sang giao diện {kit ? 'mới' : 'cổ điển'}…</span>

      <div className="fsk-header">
        <i style={b(28, 28, kit ? '9px' : '8px')} />
        <i style={b(56, 16)} />
        {hasDocs && <i className="fsk-hide-sm" style={b(160, 14)} />}
        <div className="fsk-sp" />
        {hasDocs && <i className="fsk-hide-sm" style={b(92, 36, r.btn)} />}
        {hasDocs && <i className="fsk-hide-sm" style={b(92, 36, r.btn)} />}
        <i style={b(124, kit ? 40 : 34, r.btn)} />
        <i style={b(36, 36, kit ? '12px' : '8px')} />
      </div>

      {hasDocs && (
        // Phones: the file name and the download buttons sit under the header.
        <div className="fsk-only-sm fsk-mobile">
          <i style={b(140, 14)} />
          <div className="fsk-mobile-row">
            <i style={{ ...b('50%', 40, kit ? '12px' : r.btn), flexShrink: 1 }} />
            <i style={{ ...b('50%', 40, kit ? '12px' : r.btn), flexShrink: 1 }} />
          </div>
        </div>
      )}

      {hasDocs ? (
        <div className="fsk-main">
          <div className="fsk-toolbar">
            <i style={b(96, 30, r.btn)} />
            <i style={b(30, 30, r.btn)} />
            <i style={b(30, 30, r.btn)} />
            <i className="fsk-hide-sm" style={b(118, 30, r.btn)} />
            <div className="fsk-sp" />
            <i style={b(64, 24, '999px')} />
            <i style={b(30, 30, r.btn)} />
          </div>
          <i style={{ ...b('min(420px, 80%)', 12), marginTop: 16 }} />
          <div className="fsk-grid">
            {Array.from({ length: Math.max(1, Math.min(pageCount, MAX_CARDS)) }, (_, k) => (
              <div key={k} className="fsk-card">
                <div className="fsk-frame">
                  <i style={{ width: '100%', maxWidth: 150, aspectRatio: '3 / 4', borderRadius: 4 }} />
                </div>
                <i style={b(56, 12)} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="fsk-landing">
          {kit && <i style={b(280, 24, '999px')} />}
          <i style={b('min(560px, 92%)', 40, '10px')} />
          <i style={b('min(420px, 80%)', 16)} />
          <div className="fsk-drop">
            <div style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
              <i style={b(64, 64, kit ? '999px' : '16px')} />
              <i style={b(120, 16)} />
              <i style={b(240, 12)} />
            </div>
          </div>
          <div className="fsk-steps">
            {[0, 1, 2].map((k) => (
              <div key={k} className="fsk-step">
                <i style={b(28, 28, '999px')} />
                <div style={{ display: 'grid', gap: 8, flex: 1 }}>
                  <i style={b('60%', 12)} />
                  <i style={b('85%', 10)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
