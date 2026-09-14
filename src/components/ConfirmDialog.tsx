import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Centered confirmation modal for irreversible actions (delete exam/task/
 * course, 差し戻し, final submit) — replaces the browser's native
 * window.confirm() for those specifically, so the moment that most needs
 * clarity doesn't jump out to an unstyled OS dialog. Follows the same
 * backdrop + role="dialog" + focus + Escape pattern as UserDrawer /
 * TaskBankPicker; unlike those it's a small centered box, not a drawer, since
 * there's no content to browse — just a decision to make.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '実行する',
  cancelLabel = 'キャンセル',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    confirmButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="キャンセル"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-sm rounded-lg border border-mp-border bg-mp-surface p-4 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="mb-2 text-sm font-bold text-mp-fg">
          {title}
        </h2>
        <p className="mb-4 text-sm text-mp-muted">{message}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-mp-border bg-mp-bg px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className="rounded bg-mp-red px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
