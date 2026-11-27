import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { datetimeLocalToIso, toDatetimeLocalValue } from './datetime.ts';

describe('datetime-local helpers', () => {
  it('round-trips through the local time zone', () => {
    const iso = new Date(2026, 8, 25, 9, 5).toISOString();
    const local = toDatetimeLocalValue(iso);
    assert.equal(local, '2026-09-25T09:05');
    assert.equal(datetimeLocalToIso(local), iso);
  });

  it('empty / invalid values map to "" / null', () => {
    assert.equal(toDatetimeLocalValue(null), '');
    assert.equal(toDatetimeLocalValue(undefined), '');
    assert.equal(toDatetimeLocalValue('not a date'), '');
    assert.equal(datetimeLocalToIso(''), null);
    assert.equal(datetimeLocalToIso('garbage'), null);
  });
});
