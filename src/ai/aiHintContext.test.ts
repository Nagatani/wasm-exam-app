import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStageContext, looksLikeCode, type HintContext } from './aiHintContext.ts';

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
  };
}

describe('buildStageContext', () => {
  it('stage 1 shows only the overall verdict', () => {
    const text = buildStageContext(1, ctx());
    assert.ok(text.includes('不正解'));
    assert.ok(!text.includes('SAMPLE_ACTUAL'));
    assert.ok(!text.includes('非公開'));
  });

  it('stages 2/3 add sample output and hidden-test categories', () => {
    for (const stage of [2, 3] as const) {
      const text = buildStageContext(stage, ctx());
      assert.ok(text.includes('SAMPLE_ACTUAL'));
      assert.ok(text.includes('非公開テストケース（WA）: 行末の空白や改行の違いの可能性があります。'));
    }
  });

  it('never includes a hidden test case’s output, and skips passing hidden tests', () => {
    for (const stage of [1, 2, 3] as const) {
      const text = buildStageContext(stage, ctx());
      assert.ok(!text.includes('HIDDEN_ACTUAL'));
      assert.ok(!text.includes('HIDDEN_AC_ACTUAL'));
    }
    assert.equal(buildStageContext(2, ctx()).match(/非公開テストケース/g)?.length, 1);
  });

  it('includes (truncated) compile errors from stage 2 on', () => {
    const ce = ctx({
      compileStderr: 'E'.repeat(5000),
      verdict: { overallStatus: 'CE', score: 0, results: [] },
    });
    assert.ok(!buildStageContext(1, ce).includes('EEEE'));
    const text = buildStageContext(2, ce);
    assert.ok(text.includes('コンパイルエラーの内容'));
    assert.ok((text.match(/E/g)?.length ?? 0) <= 2000 + 5);
  });
});

describe('looksLikeCode (hint leak guard)', () => {
  for (const text of [
    // C
    'for (int i = 0; i < n; i++) にしてください',
    'while(x) を見直しましょう',
    'if (a == b) の部分',
    'i <= n にします',
    '```c\nint x;\n```',
    'scanf("%d") の回数',
    'printf("%d\\n", ans) とします',
    'i++ を確認',
    '#include <stdio.h> を追加',
    // Python
    'def solve(n): のように関数を定義',
    'for i in range(n): を使いましょう',
    'print(result) で出力します',
    'elif x > 0: で分岐します',
    'n = int(input()) で読み取ります',
    'if x < 0: の条件を見直しましょう',
    // JavaScript / TypeScript
    'const total = 0 として初期化します',
    'let count = 0 を使います',
    'const sum: number = 0 に変更',
    'console.log(ans) で出力します',
    'items.map(x => x * 2) を使います',
    'function calc(n) の戻り値を確認',
    // Java
    'System.out.println(ans) にします',
    'Scanner sc = new Scanner(System.in) を使います',
    'public static void main の引数を変更',
  ]) {
    it(`flags ${text}`, () => {
      assert.equal(looksLikeCode(text), true);
    });
  }

  it('flags language-specific patterns when language is specified', () => {
    assert.equal(looksLikeCode('import sys を使ってください', 'PYTHON'), true);
    assert.equal(looksLikeCode('int count = 0 の初期化', 'C'), true);
    assert.equal(looksLikeCode('new ArrayList() で生成します', 'JAVA'), true);
    assert.equal(looksLikeCode('return ans として返します', 'JS'), true);
    assert.equal(looksLikeCode('type Pair = number を定義します', 'TS'), true);
  });

  for (const text of [
    'ループが何回繰り返されるかを、問題文の入力の個数と比べてみましょう。',
    '出力の形式が問題文の指示どおりになっているか確認してみてください。',
    '配列のインデックスが0から始まる点と、最後の要素の扱いに注目してみましょう。',
    '整数同士の割り算と小数点以下の扱いについて、問題文の条件を見直してください。',
    '条件分岐の境界（等しいときを含むかどうか）をもう一度確認してみましょう。',
  ]) {
    it(`allows prose: ${text}`, () => {
      assert.equal(looksLikeCode(text), false);
      assert.equal(looksLikeCode(text, 'C'), false);
      assert.equal(looksLikeCode(text, 'PYTHON'), false);
      assert.equal(looksLikeCode(text, 'JS'), false);
      assert.equal(looksLikeCode(text, 'TS'), false);
      assert.equal(looksLikeCode(text, 'JAVA'), false);
    });
  }
});
