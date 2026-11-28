import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const result: HTMLElement[] = [];
  for (const el of candidates) {
    if (el.tabIndex < 0) continue;
    if (el.closest('[inert]')) continue;
    if (el.getClientRects().length === 0) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    result.push(el);
  }
  return result;
}

/**
 * Shared accessibility hook for modal dialogs and drawers:
 * - Locks body scroll while open
 * - Moves initial focus to `initialFocusRef` (or the first focusable child)
 * - Traps Tab / Shift+Tab inside `dialogRef`
 * - Calls `onClose` on Escape
 * - Restores focus to the previously focused element on close/unmount
 */
export function useDialogFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previousActive =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const container = dialogRef.current;
    const initialTarget =
      initialFocusRef?.current ?? (container ? getFocusableElements(container)[0] : null);
    initialTarget?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key !== 'Tab') return;
      const currentContainer = dialogRef.current;
      if (!currentContainer) return;

      const focusables = getFocusableElements(currentContainer);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !(active instanceof Node && currentContainer.contains(active))) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !(active instanceof Node && currentContainer.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (previousActive && previousActive.isConnected) {
        previousActive.focus();
      }
    };
  }, [open, dialogRef, initialFocusRef]);
}
