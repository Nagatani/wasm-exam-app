import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BACKUP_MAX_AGE_MS,
  clearBackup,
  clearBackups,
  examAttemptBackupPrefix,
  examBackupKey,
  practiceBackupKey,
  readBackup,
  writeBackup,
} from './localBackup.ts';

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
    assert.deepEqual(readBackup('k', 2000, s), { code: 'int main(){}', savedAt: 1000 });
  });

  it('drops and forgets a backup older than the max age', () => {
    const s = memoryStore();
    writeBackup('k', 'x', 0, s);
    assert.equal(readBackup('k', BACKUP_MAX_AGE_MS + 1, s), null);
    assert.equal(s.map.size, 0);
  });

  it('ignores and removes malformed entries', () => {
    const s = memoryStore();
    s.setItem('wasm-exam-backup:k', '{"code":1}');
    assert.equal(readBackup('k', 0, s), null);
    assert.equal(s.map.size, 0);
    s.setItem('wasm-exam-backup:k', 'not json');
    assert.equal(readBackup('k', 0, s), null);
  });

  it('clears one key, a key prefix, or everything — but never foreign keys', () => {
    const s = memoryStore();
    s.setItem('wasm-exam-theme', 'dark');
    writeBackup(examBackupKey('u1', 'a1', 't1'), 'a', 0, s);
    writeBackup(examBackupKey('u1', 'a1', 't2'), 'b', 0, s);
    writeBackup(examBackupKey('u1', 'a2', 't1'), 'c', 0, s);
    writeBackup(practiceBackupKey('u1', 't1'), 'd', 0, s);

    clearBackup(examBackupKey('u1', 'a1', 't2'), s);
    assert.equal(readBackup(examBackupKey('u1', 'a1', 't2'), 0, s), null);

    clearBackups(examAttemptBackupPrefix('u1', 'a1'), s);
    assert.equal(readBackup(examBackupKey('u1', 'a1', 't1'), 0, s), null);
    assert.equal(readBackup(examBackupKey('u1', 'a2', 't1'), 0, s)?.code, 'c');

    clearBackups('', s);
    assert.deepEqual([...s.map.keys()], ['wasm-exam-theme']);
  });

  it('keys are scoped per user', () => {
    assert.notEqual(examBackupKey('u1', 'a', 't'), examBackupKey('u2', 'a', 't'));
    assert.notEqual(practiceBackupKey('u1', 't'), practiceBackupKey('u2', 't'));
  });

  it('is a no-op without storage', () => {
    assert.equal(readBackup('k', 0, null), null);
    assert.doesNotThrow(() => writeBackup('k', 'x', 0, null));
    assert.doesNotThrow(() => clearBackups('', null));
  });
});
