import { Link } from '../lib/router';
import { UserDrawer } from './UserDrawer';

/**
 * Shared top bar for the teacher detail pages (exam / task editors, results):
 * a "back" link on the left and the user menu on the right. Keeps the
 * back-link markup and spacing identical across those pages.
 */
export function BackHeader({
  to,
  label,
  beforeNavigate,
}: {
  to: string;
  label: string;
  // Forwarded to UserDrawer — see its doc comment.
  beforeNavigate?: () => Promise<boolean>;
}) {
  return (
    <header className="mb-4 flex items-center justify-between gap-3">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-mp-cyan focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:text-mp-btn-fg"
      >
        本文へスキップ
      </a>
      <Link to={to} className="inline-block text-sm font-semibold text-mp-cyan hover:underline">
        ← {label}
      </Link>
      <UserDrawer beforeNavigate={beforeNavigate} />
    </header>
  );
}
