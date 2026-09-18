import { useEffect, useRef, useState } from 'react';

/**
 * A small "ⓘ" button next to a form label that reveals a short explanation
 * in a popup on click — for setting items whose meaning/caveats don't fit as
 * permanently-visible caption text (e.g. `<p className="text-xs">` blocks
 * elsewhere in this app) without cluttering the form. Complements, doesn't
 * replace, that existing pattern: use HelpPopover for the "more detail if
 * you want it" case, plain caption text for anything every teacher should
 * see regardless of whether they click.
 *
 * Click-to-open/close (not hover) so it works the same on touch as desktop.
 * Closes on an outside click or Escape, same conventions as ConfirmDialog /
 * UserDrawer.
 */
export function HelpPopover({ text, label = '説明を表示' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-mp-border text-[10px] leading-none text-mp-muted hover:border-mp-cyan hover:text-mp-cyan"
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-mp-border bg-mp-surface p-3 text-xs text-mp-fg shadow-xl"
        >
          {text}
        </div>
      )}
    </span>
  );
}
