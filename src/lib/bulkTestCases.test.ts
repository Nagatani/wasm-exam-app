import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  exportCasesToCsv,
  exportCasesToJson,
  parseBulkCases,
  parseCsvTsvCases,
  parseJsonCases,
} from './bulkTestCases.ts';

describe('parseBulkCases', () => {
  it('splits cases on === and input/expected on ---', () => {
    assert.deepEqual(parseBulkCases('1 2\n---\n3\n===\n10 20\n---\n30'), [
      { input: '1 2', expectedOutput: '3', isSample: false },
      { input: '10 20', expectedOutput: '30', isSample: false },
    ]);
  });

  it('@sample on the first line marks a sample and is removed', () => {
    assert.deepEqual(parseBulkCases('@sample\n1\n---\n2'), [
      { input: '1', expectedOutput: '2', isSample: true },
    ]);
  });

  it('keeps multi-line input and expected output intact', () => {
    assert.deepEqual(parseBulkCases('3\n1 2 3\n---\n6\nok'), [
      { input: '3\n1 2 3', expectedOutput: '6\nok', isSample: false },
    ]);
  });

  it('accepts CRLF line endings', () => {
    assert.deepEqual(parseBulkCases('@sample\r\n1\r\n---\r\n2\r\n===\r\n3\r\n---\r\n4'), [
      { input: '1', expectedOutput: '2', isSample: true },
      { input: '3', expectedOutput: '4', isSample: false },
    ]);
  });

  it('a later --- line stays part of the expected output', () => {
    assert.deepEqual(parseBulkCases('in\n---\nline1\n---\nline2'), [
      { input: 'in', expectedOutput: 'line1\n---\nline2', isSample: false },
    ]);
  });

  it('a case without --- has an empty expected output', () => {
    assert.deepEqual(parseBulkCases('only input'), [
      { input: 'only input', expectedOutput: '', isSample: false },
    ]);
  });

  it('drops blank blocks and trailing whitespace', () => {
    assert.deepEqual(parseBulkCases('1\n---\n2\n\n===\n\n===\n'), [
      { input: '1', expectedOutput: '2', isSample: false },
    ]);
    assert.deepEqual(parseBulkCases(''), []);
  });

  it('@sample must be the whole first line', () => {
    assert.equal(parseBulkCases('@samples\n1\n---\n2')[0].isSample, false);
  });
});

describe('parseCsvTsvCases', () => {
  it('parses CSV with header row and sample flags', () => {
    const csv = 'input,expectedOutput,isSample\n1 2,3,true\n10 20,30,false\n5,10,1';
    assert.deepEqual(parseCsvTsvCases(csv), [
      { input: '1 2', expectedOutput: '3', isSample: true },
      { input: '10 20', expectedOutput: '30', isSample: false },
      { input: '5', expectedOutput: '10', isSample: true },
    ]);
  });

  it('parses CSV without header row and supports input-only rows', () => {
    const csv = '1 2,3\n4 5\n6 7,13,yes';
    assert.deepEqual(parseCsvTsvCases(csv), [
      { input: '1 2', expectedOutput: '3', isSample: false },
      { input: '4 5', expectedOutput: '', isSample: false },
      { input: '6 7', expectedOutput: '13', isSample: true },
    ]);
  });

  it('handles quoted multiline fields, commas, and escaped double quotes', () => {
    const csv = [
      'input,expectedOutput,isSample',
      '"3\n1 2 3","6\n""ok"", done",true',
      '"a,b","c,d",false',
    ].join('\r\n');
    assert.deepEqual(parseCsvTsvCases(csv), [
      { input: '3\n1 2 3', expectedOutput: '6\n"ok", done', isSample: true },
      { input: 'a,b', expectedOutput: 'c,d', isSample: false },
    ]);
  });

  it('auto-detects TSV (spreadsheet paste) and strips UTF-8 BOM', () => {
    const tsv = '\uFEFFinput\texpectedOutput\tisSample\n1 2\t3\tサンプル\n"a\nb"\t"c\nd"\tfalse';
    assert.deepEqual(parseCsvTsvCases(tsv), [
      { input: '1 2', expectedOutput: '3', isSample: true },
      { input: 'a\nb', expectedOutput: 'c\nd', isSample: false },
    ]);
  });

  it('returns empty array for blank input', () => {
    assert.deepEqual(parseCsvTsvCases('   \n  '), []);
  });
});

describe('parseJsonCases', () => {
  it('parses an array of test cases with defaults', () => {
    const json = JSON.stringify([
      { input: '1 2', expectedOutput: '3', isSample: true },
      { input: '10' },
    ]);
    assert.deepEqual(parseJsonCases(json), [
      { input: '1 2', expectedOutput: '3', isSample: true },
      { input: '10', expectedOutput: '', isSample: false },
    ]);
  });

  it('accepts wrapper object with testCases or cases array', () => {
    assert.deepEqual(
      parseJsonCases(JSON.stringify({ testCases: [{ input: 'a', expectedOutput: 'b' }] })),
      [{ input: 'a', expectedOutput: 'b', isSample: false }],
    );
    assert.deepEqual(
      parseJsonCases(JSON.stringify({ cases: [{ input: 'x', expectedOutput: 'y', isSample: true }] })),
      [{ input: 'x', expectedOutput: 'y', isSample: true }],
    );
  });

  it('returns empty array for blank input', () => {
    assert.deepEqual(parseJsonCases('  '), []);
  });

  it('throws on invalid JSON or invalid item types', () => {
    assert.throws(() => parseJsonCases('{not valid json'));
    assert.throws(() => parseJsonCases('{"foo": 1}'));
    assert.throws(() => parseJsonCases('[{"input": 123}]'));
    assert.throws(() => parseJsonCases('[{"input": "1", "isSample": "yes"}]'));
  });
});

describe('exportCasesToCsv and exportCasesToJson', () => {
  const sampleCases = [
    { input: '3\n1 2 3', expectedOutput: '6\n"ok", done', isSample: true },
    { input: '10 20', expectedOutput: '30', isSample: false },
  ];

  it('exports CSV with proper quoting and round-trips through parseCsvTsvCases', () => {
    const csv = exportCasesToCsv(sampleCases);
    assert.ok(csv.startsWith('input,expectedOutput,isSample\n'));
    assert.deepEqual(parseCsvTsvCases(csv), sampleCases);
  });

  it('exports JSON and round-trips through parseJsonCases', () => {
    const json = exportCasesToJson(sampleCases);
    assert.deepEqual(parseJsonCases(json), sampleCases);
  });
});
