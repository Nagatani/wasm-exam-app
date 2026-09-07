import type { ReactNode } from 'react';

/**
 * Consistent "nothing here yet" panel — a dashed-border box with a message and
 * an optional call-to-action, instead of a bare muted <p>.
 */
export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-mp-border px-4 py-10 text-center">
      <p className="text-sm text-mp-muted">{message}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
