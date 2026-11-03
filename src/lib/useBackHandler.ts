import { useEffect, useRef } from 'react';

/**
 * Phones' back button / swipe-back gesture pops browser history, which would
 * leave the page and throw away everything being edited. While any handler is
 * registered we keep one dummy history entry on top; a back press consumes it
 * and runs the most recently registered handler (e.g. close the open preview)
 * instead of navigating away.
 */
const handlers: Array<{ current: () => void }> = [];
let guarded = false; // our dummy entry is on top of the history stack
let skipPop = false; // the next popstate comes from our own history.back()
let syncQueued = false;

function sync() {
  syncQueued = false;
  const want = handlers.length > 0;
  if (want && !guarded) {
    history.pushState({ folioGuard: true }, '');
    guarded = true;
  } else if (!want && guarded) {
    guarded = false;
    skipPop = true;
    history.back();
  }
}

// Deferred so a register/unregister pair in the same tick (StrictMode, an
// overlay swapping for another) doesn't churn history.
function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  setTimeout(sync, 0);
}

window.addEventListener('popstate', () => {
  if (skipPop) {
    skipPop = false;
    return;
  }
  guarded = false;
  handlers[handlers.length - 1]?.current();
  queueSync();
});

/** While `active`, a back press calls `onBack` instead of leaving the page. */
export function useBackHandler(active: boolean, onBack: () => void) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    handlers.push(ref);
    queueSync();
    return () => {
      const i = handlers.lastIndexOf(ref);
      if (i >= 0) handlers.splice(i, 1);
      queueSync();
    };
  }, [active]);
}
