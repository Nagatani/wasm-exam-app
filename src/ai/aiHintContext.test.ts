import { describe, expect, it } from 'vitest'
import { buildStageContext, looksLikeCode, type HintContext } from './aiHintContext'

function ctx(overrides: Partial<HintContext> = {}): HintContext {
  return {
    language: 'C',
    statementMarkdown: '2つの整数の和を出力せよ',
    code: 'int main(){}',
    compileStderr: null,
    verdict: {
      overallStatus: 'WA',
      score: 0,
      results: [
        { testCaseId: 's', isSample: true, status: 'WA', actualOutput: 'SAMPLE_ACTUAL' },
        {
          testCaseId: 'h1',
          isSample: false,
          status: 'WA',
          actualOutput: 'HIDDEN_ACTUAL',
          hint: '行末の空白や改行の違いの可能性があります。',
        },
        { testCaseId: 'h2', isSample: false, status: 'AC', actualOutput: 'HIDDEN_AC_ACTUAL' },
      ],
    },
    ...overrides,
  }
}

describe('buildStageContext', () => {
  it('stage 1 shows only the overall verdict', () => {
    const text = buildStageContext(1, ctx())
    expect(text).toContain('不正解')
    expect(text).not.toContain('SAMPLE_ACTUAL')
    expect(text).not.toContain('非公開')
  })

  it('stages 2/3 add sample output and hidden-test categories', () => {
    for (const stage of [2, 3] as const) {
      const text = buildStageContext(stage, ctx())
      expect(text).toContain('SAMPLE_ACTUAL')
      expect(text).toContain('非公開テストケース（WA）: 行末の空白や改行の違いの可能性があります。')
    }
  })

  it('never includes a hidden test case’s output, and skips passing hidden tests', () => {
    for (const stage of [1, 2, 3] as const) {
      const text = buildStageContext(stage, ctx())
      expect(text).not.toContain('HIDDEN_ACTUAL')
      expect(text).not.toContain('HIDDEN_AC_ACTUAL')
    }
    expect(buildStageContext(2, ctx()).match(/非公開テストケース/g)).toHaveLength(1)
  })

  it('includes (truncated) compile errors from stage 2 on', () => {
    const ce = ctx({
      compileStderr: 'E'.repeat(5000),
      verdict: { overallStatus: 'CE', score: 0, results: [] },
    })
    expect(buildStageContext(1, ce)).not.toContain('EEEE')
    const text = buildStageContext(2, ce)
    expect(text).toContain('コンパイルエラーの内容')
    expect(text.match(/E/g)!.length).toBeLessThanOrEqual(2000 + 5)
  })
})

describe('looksLikeCode (hint leak guard)', () => {
  it.each([
    'for (int i = 0; i < n; i++) にしてください',
    'while(x) を見直しましょう',
    'if (a == b) の部分',
    'i <= n にします',
    '```c\nint x;\n```',
    'scanf("%d") の回数',
    'i++ を確認',
  ])('flags %s', (text) => {
    expect(looksLikeCode(text)).toBe(true)
  })

  it.each([
    'ループが何回繰り返されるかを、問題文の入力の個数と比べてみましょう。',
    '出力の形式が問題文の指示どおりになっているか確認してみてください。',
  ])('allows prose: %s', (text) => {
    expect(looksLikeCode(text)).toBe(false)
  })
})
