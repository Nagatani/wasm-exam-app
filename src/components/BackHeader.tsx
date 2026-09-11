import { Link } from 'react-router-dom';
import { UserDrawer } from './UserDrawer';

/**
 * Shared top bar for the teacher detail pages (exam / task editors, results):
 * a "back" link on the left and the user menu on the right. Keeps the
 * back-link markup and spacing identical across those pages.
 */
export function BackHeader({ to, label }: { to: string; label: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <Link to={to} className="inline-block text-sm font-semibold text-mp-cyan hover:underline">
        ← {label}
      </Link>
      <UserDrawer />
    </div>
  );
}
