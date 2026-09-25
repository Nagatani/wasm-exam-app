import { useEffect, useRef, useState } from 'react';
import { clearBackup, readBackup, writeBackup, type LocalBackup } from '../lib/localBackup';

const WRITE_DEBOUNCE_MS = 500;

/**
 * Keeps a browser-local backup (lib/localBackup) of editor code that isn't
 * saved server-side yet, and offers it back after a crash/reload.
 *
 * - `key` null = not ready yet (page still loading); once it's set, a stored
 *   backup that differs from the code the page loaded with becomes `pending`
 *   (the page shows RestoreBackupBanner). An identical one is just dropped.
 * - While nothing is pending: `dirty` → the code is written (debounced);
 *   clean → the backup is removed. Pages still clear it explicitly after a
 *   successful server save, since that doesn't change `code`.
 * - While a backup is pending it is left untouched in storage, so reloading
 *   again before answering the banner still offers it.
 */
export function useCodeBackup(key: string | null, code: string, dirty: boolean) {
  // Which key the stored backup was last checked for, plus what was found —
  // one state so the write effect never runs for a key before its check has
  // landed (it would otherwise clear the backup it's about to offer).
  const [checked, setChecked] = useState<{ key: string; pending: LocalBackup | null } | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  useEffect(() => {
    if (!key) {
      setChecked(null);
      return;
    }
    const backup = readBackup(key);
    if (backup && backup.code === codeRef.current) clearBackup(key);
    setChecked({ key, pending: backup && backup.code !== codeRef.current ? backup : null });
  }, [key]);

  const ready = key !== null && checked?.key === key;
  const pending = ready ? checked.pending : null;

  useEffect(() => {
    if (!ready || !key || pending) return;
    if (!dirty) {
      clearBackup(key);
      return;
    }
    const id = setTimeout(() => writeBackup(key, code), WRITE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [ready, key, code, dirty, pending]);

  return {
    pending,
    // Returns the backed-up code for the caller to put in the editor.
    restore(): string | null {
      const restored = pending?.code ?? null;
      if (key) setChecked({ key, pending: null });
      return restored;
    },
    discard() {
      if (key) {
        clearBackup(key);
        setChecked({ key, pending: null });
      }
    },
  };
}
