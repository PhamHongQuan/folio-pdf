import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ClassicView } from './ClassicView';
import { SwitchSkeleton } from './components/SwitchSkeleton';
import { useTheme } from './lib/theme';
import { useUiMode, type UiMode } from './lib/uiMode';
import { useFolio } from './useFolio';

// The new UI (and its Tailwind/ui-kit stylesheet) is a separate chunk.
const loadKit = () => import('./kit/KitView');
const KitView = lazy(loadKit);

/** The skeleton stays at least this long, so a fast switch doesn't just flicker. */
const MIN_SWITCH_MS = 350;

/** Runs `fn` once the browser has painted (with a fallback: hidden tabs don't run rAF). */
function afterPaint(fn: () => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  requestAnimationFrame(() => setTimeout(run, 0));
  setTimeout(run, 100);
}

/** Calls `onReady` once its Suspense boundary has committed, i.e. the view is on screen. */
function Ready({ onReady }: { onReady: () => void }) {
  const ref = useRef(onReady);
  ref.current = onReady;
  useEffect(() => ref.current(), []);
  return null;
}

export default function App() {
  const f = useFolio();
  const [theme, toggleTheme] = useTheme();
  const [ui, setUi] = useUiMode();
  const [switching, setSwitching] = useState<UiMode | null>(null);
  const switchStarted = useRef(0);

  // Fetch the new UI in the background so the first switch doesn't wait for the download.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
    idle(() => void loadKit().catch(() => {}));
  }, []);

  // Show the skeleton first, then do the heavy work (load chunk, swap stylesheet, remount).
  const switchUi = useCallback(
    (next: UiMode) => {
      if (next === ui || switching) return;
      switchStarted.current = performance.now();
      setSwitching(next);
      afterPaint(async () => {
        if (next === 'kit') await loadKit().catch(() => {});
        setUi(next);
      });
    },
    [ui, switching, setUi],
  );

  const onViewReady = useCallback(() => {
    if (!switching || switching !== ui) return;
    afterPaint(() => {
      const left = MIN_SWITCH_MS - (performance.now() - switchStarted.current);
      setTimeout(() => setSwitching(null), Math.max(0, left));
    });
  }, [switching, ui]);

  // The switch shows the chosen UI right away, while the skeleton covers the change.
  const viewProps = { f, theme, toggleTheme, ui: switching ?? ui, setUi: switchUi };

  return (
    <div
      className={ui === 'kit' ? 'kit-app flex min-h-dvh flex-col' : 'app'}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          f.setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) f.setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        f.setDragOver(false);
        if (e.dataTransfer.files.length) void f.addFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={f.fileInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void f.addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {ui === 'kit' ? (
        <Suspense fallback={null}>
          <KitView {...viewProps} />
          <Ready key="kit" onReady={onViewReady} />
        </Suspense>
      ) : (
        <>
          <ClassicView {...viewProps} />
          <Ready key="classic" onReady={onViewReady} />
        </>
      )}

      <SwitchSkeleton target={switching} theme={theme} hasDocs={f.hasDocs} pageCount={f.pages.length} />
    </div>
  );
}
