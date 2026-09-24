import { describe, expect, it } from 'vitest'
import { parseBulkCases } from './bulkTestCases'

describe('parseBulkCases', () => {
  it('splits cases on === and input/expected on ---', () => {
    expect(parseBulkCases('1 2\n---\n3\n===\n10 20\n---\n30')).toEqual([
      { input: '1 2', expectedOutput: '3', isSample: false },
      { input: '10 20', expectedOutput: '30', isSample: false },
    ])
  })

  it('@sample on the first line marks a sample and is removed', () => {
    expect(parseBulkCases('@sample\n1\n---\n2')).toEqual([
      { input: '1', expectedOutput: '2', isSample: true },
    ])
  })

  it('keeps multi-line input and expected output intact', () => {
    expect(parseBulkCases('3\n1 2 3\n---\n6\nok')).toEqual([
      { input: '3\n1 2 3', expectedOutput: '6\nok', isSample: false },
    ])
  })

  it('accepts CRLF line endings', () => {
    expect(parseBulkCases('@sample\r\n1\r\n---\r\n2\r\n===\r\n3\r\n---\r\n4')).toEqual([
      { input: '1', expectedOutput: '2', isSample: true },
      { input: '3', expectedOutput: '4', isSample: false },
    ])
  })

  it('a later --- line stays part of the expected output', () => {
    expect(parseBulkCases('in\n---\nline1\n---\nline2')).toEqual([
      { input: 'in', expectedOutput: 'line1\n---\nline2', isSample: false },
    ])
  })

  it('a case without --- has an empty expected output', () => {
    expect(parseBulkCases('only input')).toEqual([
      { input: 'only input', expectedOutput: '', isSample: false },
    ])
  })

  it('drops blank blocks and trailing whitespace', () => {
    expect(parseBulkCases('1\n---\n2\n\n===\n\n===\n')).toEqual([
      { input: '1', expectedOutput: '2', isSample: false },
    ])
    expect(parseBulkCases('')).toEqual([])
  })

  it('@sample must be the whole first line', () => {
    expect(parseBulkCases('@samples\n1\n---\n2')[0].isSample).toBe(false)
  })
})
