import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBulkCases } from './bulkTestCases.ts';

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
