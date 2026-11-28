import type { Language } from '../types/exam';
import type { JudgeVerdict } from '../types/student';

// The pure, dependency-free half of ./aiHint.ts — what the model is shown
// per stage and the code-leak guard applied to its answer. Split out so it
// can be unit-tested without pulling in @mlc-ai/web-llm (aiHint.ts's model
// loading), and so the "never shows a hidden test's output" rule has a test.

export type HintStage = 1 | 2 | 3;

export const HINT_STAGE_LABEL: Record<HintStage, string> = {
  1: 'ヒント1: 着眼点',
  2: 'ヒント2: 疑わしい箇所',
  3: 'ヒント3: 修正方針',
};

export interface HintContext {
  language: Language;
  statementMarkdown: string;
  code: string;
  verdict: JudgeVerdict;
  compileStderr: string | null;
}

const OVERALL_STATUS_LABEL: Record<JudgeVerdict['overallStatus'], string> = {
  AC: '全テストケース正解',
  WA: '不正解（一部または全部のテストケースで出力が一致しない）',
  CE: 'コンパイルエラー',
  TLE: '実行時間超過',
  MLE: 'メモリ超過',
};

// What the model is allowed to see, built up progressively by stage. Never
// includes a hidden test case's expected output — PracticeTask's testCases
// only ever carry it for samples in the first place (see
// server/src/routes/practice.ts), so there's nothing to redact here beyond
// simply not asking for it.
export function buildStageContext(stage: HintStage, ctx: HintContext): string {
  const lines: string[] = [`直近の実行結果: ${OVERALL_STATUS_LABEL[ctx.verdict.overallStatus]}`];

  if (stage === 1) {
    return lines.join('\n');
  }

  if (ctx.verdict.overallStatus === 'CE' && ctx.compileStderr) {
    lines.push('', 'コンパイルエラーの内容:', ctx.compileStderr.slice(0, 2000));
  }

  for (const r of ctx.verdict.results) {
    if (r.isSample) {
      lines.push(
        '',
        `サンプルテストケース（${r.status}）:`,
        `  実際の出力: ${r.actualOutput || '(なし)'}`,
      );
    } else if (r.status !== 'AC') {
      // Hidden test case: never the actual/expected output, only the
      // non-revealing category hint already computed server-side (same one
      // shown to the student for a non-sample WA — see judge.ts's
      // computeWaHint) and the coarse per-test status.
      lines.push(
        '',
        `非公開テストケース（${r.status}）${r.hint ? `: ${r.hint}` : ''}`,
      );
    }
  }

  return lines.join('\n');
}

export const MAX_FOLLOW_UP_TURNS = 2;
export const MAX_FOLLOW_UP_QUESTION_CHARS = 100;

// Best-effort safety net, not a guarantee: the system prompt's NO_CODE_RULE
// isn't reliably followed by a 3B model (see the 2026-09-19 note above this
// file's STAGE_INSTRUCTION — stage 3 was observed emitting the literal
// corrected line despite being told not to). This catches common code leaks
// across all 5 supported languages (C, Java, JS, TS, Python) and rejects the
// output rather than showing it, so a retry (new sampling) gets another chance
// instead of the student seeing a near-complete answer. Deliberately simple /
// over-inclusive: a false positive just costs a retry, which is cheap here.
const CODE_LIKE_PATTERN = new RegExp(
  [
    // Markdown code fences
    '```',
    // C-family control flow, braces/semicolons, comparison & inc/dec operators, arrows
    '\\bfor\\s*\\(',
    '\\bwhile\\s*\\(',
    '\\bif\\s*\\(',
    '[{};]',
    '==',
    '!=',
    '<=',
    '>=',
    '\\+\\+',
    '--',
    '=>',
    // C
    '\\bscanf\\s*\\(',
    '\\bprintf\\s*\\(',
    '#include\\b',
    '\\bint\\s+main\\b',
    // Python
    '\\bdef\\s+\\w+\\s*\\(',
    '\\brange\\s*\\(',
    '\\bprint\\s*\\(',
    '\\belif\\b',
    '\\binput\\s*\\(',
    '\\bfor\\s+\\w+\\s+in\\b',
    '\\b(?:if|while)\\s+[A-Za-z0-9_(\\s!=<>+\\-*/%]+\\s*:',
    // JavaScript / TypeScript
    '\\b(?:const|let|var)\\s+\\w+\\s*(?::[^=\\n]+)?=',
    '\\bconsole\\.log\\b',
    '\\bfunction\\s+\\w*\\s*\\(',
    '\\breadline\\s*\\(',
    // Java
    '\\bSystem\\.out\\b',
    '\\bScanner\\b',
    '\\bpublic\\s+(?:static\\s+)?(?:void|class)\\b',
  ].join('|'),
);

const LANGUAGE_EXTRA_CODE_PATTERN: Partial<Record<Language, RegExp>> = {
  PYTHON: /\bimport\s+\w+|\blambda\s+\w+:/,
  JS: /\breturn\s+[A-Za-z0-9_([\s]/,
  TS: /\b(?:interface|type)\s+\w+\s*[={]|\breturn\s+[A-Za-z0-9_([\s]/,
  JAVA: /\bimport\s+java\.|\bnew\s+[A-Z]\w*\s*\(/,
  C: /\b(?:int|long|double|char|void)\s+\w+\s*(?:=|\[)/,
};

export function looksLikeCode(text: string, language?: Language): boolean {
  if (CODE_LIKE_PATTERN.test(text)) return true;
  if (language) {
    const extra = LANGUAGE_EXTRA_CODE_PATTERN[language];
    if (extra?.test(text)) return true;
  }
  return false;
}
