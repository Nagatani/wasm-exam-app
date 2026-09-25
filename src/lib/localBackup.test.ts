import { describe, expect, it } from 'vitest';
import {
  BACKUP_MAX_AGE_MS,
  clearBackup,
  clearBackups,
  examAttemptBackupPrefix,
  examBackupKey,
  practiceBackupKey,
  readBackup,
  writeBackup,
} from './localBackup';

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe('localBackup', () => {
  it('round-trips code with its timestamp', () => {
    const s = memoryStore();
    writeBackup('k', 'int main(){}', 1000, s);
    expect(readBackup('k', 2000, s)).toEqual({ code: 'int main(){}', savedAt: 1000 });
  });

  it('drops and forgets a backup older than the max age', () => {
    const s = memoryStore();
    writeBackup('k', 'x', 0, s);
    expect(readBackup('k', BACKUP_MAX_AGE_MS + 1, s)).toBeNull();
    expect(s.map.size).toBe(0);
  });

  it('ignores and removes malformed entries', () => {
    const s = memoryStore();
    s.setItem('wasm-exam-backup:k', '{"code":1}');
    expect(readBackup('k', 0, s)).toBeNull();
    expect(s.map.size).toBe(0);
    s.setItem('wasm-exam-backup:k', 'not json');
    expect(readBackup('k', 0, s)).toBeNull();
  });

  it('clears one key, a key prefix, or everything — but never foreign keys', () => {
    const s = memoryStore();
    s.setItem('wasm-exam-theme', 'dark');
    writeBackup(examBackupKey('u1', 'a1', 't1'), 'a', 0, s);
    writeBackup(examBackupKey('u1', 'a1', 't2'), 'b', 0, s);
    writeBackup(examBackupKey('u1', 'a2', 't1'), 'c', 0, s);
    writeBackup(practiceBackupKey('u1', 't1'), 'd', 0, s);

    clearBackup(examBackupKey('u1', 'a1', 't2'), s);
    expect(readBackup(examBackupKey('u1', 'a1', 't2'), 0, s)).toBeNull();

    clearBackups(examAttemptBackupPrefix('u1', 'a1'), s);
    expect(readBackup(examBackupKey('u1', 'a1', 't1'), 0, s)).toBeNull();
    expect(readBackup(examBackupKey('u1', 'a2', 't1'), 0, s)?.code).toBe('c');

    clearBackups('', s);
    expect([...s.map.keys()]).toEqual(['wasm-exam-theme']);
  });

  it('keys are scoped per user', () => {
    expect(examBackupKey('u1', 'a', 't')).not.toBe(examBackupKey('u2', 'a', 't'));
    expect(practiceBackupKey('u1', 't')).not.toBe(practiceBackupKey('u2', 't'));
  });

  it('is a no-op without storage', () => {
    expect(readBackup('k', 0, null)).toBeNull();
    expect(() => writeBackup('k', 'x', 0, null)).not.toThrow();
    expect(() => clearBackups('', null)).not.toThrow();
  });
});
