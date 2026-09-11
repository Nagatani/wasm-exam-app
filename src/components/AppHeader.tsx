import type { ReactNode } from 'react';
import { UserDrawer } from './UserDrawer';

/**
 * Shared top bar for the full-width dashboard pages (student / teacher): page
 * title on the left, then any page-specific `actions`, and the user menu
 * (theme toggle + logout live inside that drawer now, not as separate
 * buttons here — see UserDrawer).
 */
export function AppHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold text-mp-cyan">{title}</h1>
      <div className="flex items-center gap-2">
        {actions}
        <UserDrawer />
      </div>
    </header>
  );
}
