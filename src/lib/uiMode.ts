import { useCallback, useLayoutEffect, useState } from 'react';

/** `classic`: Folio's original UI. `kit`: the UI built with @nphuonha/ui-kit. */
export type UiMode = 'classic' | 'kit';

const STORAGE_KEY = 'folio-ui';

function storedMode(): UiMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'kit' ? 'kit' : 'classic';
  } catch {
    return 'classic';
  }
}

/** The chosen UI, remembered across visits. Marks <html data-ui="kit"> while the kit UI is on. */
export function useUiMode(): [UiMode, (mode: UiMode) => void] {
  const [mode, setModeState] = useState<UiMode>(storedMode);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (mode === 'kit') root.dataset.ui = 'kit';
    else delete root.dataset.ui;
  }, [mode]);

  const setMode = useCallback((next: UiMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
  }, []);

  return [mode, setMode];
}

/**
 * Adds a stylesheet to <head> while the calling component is mounted.
 * Each UI loads only its own CSS, so the two never override each other
 * (they share variable names like --primary and --surface).
 */
export function useStylesheet(id: string, css: string) {
  useLayoutEffect(() => {
    const el = document.createElement('style');
    el.dataset.folioUi = id;
    el.textContent = css;
    document.head.appendChild(el);
    return () => el.remove();
  }, [id, css]);
}
