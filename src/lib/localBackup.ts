// Browser-local safety net for code the student hasn't saved to the server
// yet (exam: before "下書き保存"; practice: there is no server draft at all).
// A tab crash / accidental reload / closed laptop otherwise loses everything
// since the last save. Stored in localStorage under a per-user key, never
// sent anywhere, and deliberately short-lived: expired after MAX_AGE_MS,
// dropped once the server has the same code, and wiped on logout so the next
// person on a shared lab PC can't find the previous student's answers.

const PREFIX = 'wasm-exam-backup:';
export const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface LocalBackup {
  code: string;
  savedAt: number; // epoch ms
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // e.g. storage disabled by browser settings
  }
}

export function examBackupKey(userId: string, attemptId: string, taskId: string): string {
  return `exam:${userId}:${attemptId}:${taskId}`;
}

export function examAttemptBackupPrefix(userId: string, attemptId: string): string {
  return `exam:${userId}:${attemptId}:`;
}

export function practiceBackupKey(userId: string, taskId: string): string {
  return `practice:${userId}:${taskId}`;
}

export function readBackup(
  key: string,
  now = Date.now(),
  store: KeyValueStore | null = defaultStore(),
): LocalBackup | null {
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalBackup>;
    if (typeof parsed.code !== 'string' || typeof parsed.savedAt !== 'number') {
      store.removeItem(PREFIX + key);
      return null;
    }
    if (now - parsed.savedAt > BACKUP_MAX_AGE_MS) {
      store.removeItem(PREFIX + key);
      return null;
    }
    return { code: parsed.code, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function writeBackup(
  key: string,
  code: string,
  now = Date.now(),
  store: KeyValueStore | null = defaultStore(),
): void {
  if (!store) return;
  try {
    store.setItem(PREFIX + key, JSON.stringify({ code, savedAt: now } satisfies LocalBackup));
  } catch {
    // Quota exceeded / storage disabled: the backup is best-effort only.
  }
}

export function clearBackup(key: string, store: KeyValueStore | null = defaultStore()): void {
  if (!store) return;
  try {
    store.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

// Removes every backup whose key starts with `keyPrefix` ('' = all backups).
export function clearBackups(keyPrefix = '', store: KeyValueStore | null = defaultStore()): void {
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (k && k.startsWith(PREFIX + keyPrefix)) doomed.push(k);
    }
    doomed.forEach((k) => store.removeItem(k));
  } catch {
    // ignore
  }
}
