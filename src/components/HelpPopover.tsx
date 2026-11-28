import { useEffect, useId, useRef, useState } from 'react';

/**
 * A small "?" button next to a form label that reveals a short explanation
 * in a popup on click — for setting items whose meaning/caveats don't fit as
 * permanently-visible caption text (e.g. `<p className="text-xs">` blocks
 * elsewhere in this app) without cluttering the form. Complements, doesn't
 * replace, that existing pattern: use HelpPopover for the "more detail if
 * you want it" case, plain caption text for anything every teacher should
 * see regardless of whether they click.
 *
 * Click-to-open/close (not hover) so it works the same on touch as desktop.
 * Closes on an outside click, focus leaving the container, or Escape
 * (restoring focus to the trigger button), same conventions as ConfirmDialog /
 * UserDrawer.
 */
export function HelpPopover({ text, label = '説明を表示' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span
      ref={containerRef}
      className="relative inline-block"
      onBlur={(e) => {
        if (open && !containerRef.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-mp-border text-xs leading-none text-mp-muted hover:border-mp-cyan hover:text-mp-cyan"
      >
        ?
      </button>
      {open && (
        <div
          id={id}
          role="region"
          aria-label={label}
          className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-mp-border bg-mp-surface p-3 text-xs text-mp-fg shadow-xl"
        >
          {text}
        </div>
      )}
    </span>
  );
}
