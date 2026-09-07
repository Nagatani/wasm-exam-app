import { useEffect } from 'react';

/**
 * While `dirty` is true, warn before a full page unload (refresh, tab close,
 * external navigation) that there are unsaved changes. Client-side React
 * Router navigations are NOT intercepted — a page that needs that must guard
 * its own in-app navigation separately.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
