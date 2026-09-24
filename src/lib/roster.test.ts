import { describe, expect, it } from 'vitest'
import { parseAccountRoster, parseRoster } from './roster'

describe('parseRoster (enroll existing students)', () => {
  it('takes the first field of each line (CSV, TSV, space, or bare)', () => {
    expect(parseRoster('s001,山田\ns002\t佐藤\ns003 鈴木\ns004')).toEqual(['s001', 's002', 's003', 's004'])
  })

  it('skips a 学籍番号 header row, blank lines, and CRLF', () => {
    expect(parseRoster('学籍番号,氏名\r\n\r\ns001,山田\r\n  \r\n')).toEqual(['s001'])
  })
})

describe('parseAccountRoster (create accounts)', () => {
  it('parses 学籍番号,氏名 from CSV and TSV', () => {
    expect(parseAccountRoster('s001,山田 太郎\ns002\t佐藤 花子')).toEqual([
      { studentNumber: 's001', displayName: '山田 太郎' },
      { studentNumber: 's002', displayName: '佐藤 花子' },
    ])
  })

  it('joins extra columns into the display name (e.g. 姓,名)', () => {
    expect(parseAccountRoster('s001,山田,太郎')).toEqual([{ studentNumber: 's001', displayName: '山田 太郎' }])
  })

  it('trims fields and drops rows without a name, the header, and blanks', () => {
    expect(parseAccountRoster('学籍番号,氏名\n s001 , 山田 \ns002\ns003,\n\n')).toEqual([
      { studentNumber: 's001', displayName: '山田' },
    ])
  })
})
