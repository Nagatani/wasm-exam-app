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

/**
 * `beforeNavigate` handler for UserDrawer / BackHeader on a page guarded by
 * useUnsavedGuard: the drawer's in-app links aren't covered by
 * `beforeunload`, so ask before leaving unsaved edits behind.
 */
export function confirmLeaveIfDirty(dirty: boolean): () => Promise<boolean> {
  return async () =>
    !dirty || window.confirm('保存していない変更があります。破棄して移動しますか？');
}
