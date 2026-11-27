import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAccountRoster, parseRoster } from './roster.ts';

describe('parseRoster (enroll existing students)', () => {
  it('takes the first field of each line (CSV, TSV, space, or bare)', () => {
    assert.deepEqual(parseRoster('s001,山田\ns002\t佐藤\ns003 鈴木\ns004'), [
      's001',
      's002',
      's003',
      's004',
    ]);
  });

  it('skips a 学籍番号 header row, blank lines, and CRLF', () => {
    assert.deepEqual(parseRoster('学籍番号,氏名\r\n\r\ns001,山田\r\n  \r\n'), ['s001']);
  });
});

describe('parseAccountRoster (create accounts)', () => {
  it('parses 学籍番号,氏名 from CSV and TSV', () => {
    assert.deepEqual(parseAccountRoster('s001,山田 太郎\ns002\t佐藤 花子'), [
      { studentNumber: 's001', displayName: '山田 太郎' },
      { studentNumber: 's002', displayName: '佐藤 花子' },
    ]);
  });

  it('joins extra columns into the display name (e.g. 姓,名)', () => {
    assert.deepEqual(parseAccountRoster('s001,山田,太郎'), [
      { studentNumber: 's001', displayName: '山田 太郎' },
    ]);
  });

  it('trims fields and drops rows without a name, the header, and blanks', () => {
    assert.deepEqual(parseAccountRoster('学籍番号,氏名\n s001 , 山田 \ns002\ns003,\n\n'), [
      { studentNumber: 's001', displayName: '山田' },
    ]);
  });
});
