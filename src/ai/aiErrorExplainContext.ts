import type { Language } from '../types/exam';
import type { JudgeVerdict, PerTestCaseStatus } from '../types/student';

// Pure, dependency-free context builder for beginner-friendly compiler/runtime
// error explanations in PRACTICE mode. Deliberately excludes the problem
// statement, reference solutions, and ALL hidden test case outputs so no
// answer or hidden test data can ever enter the prompt.

export const ERROR_EXPLAIN_NO_CODE_RULE =
  '重要な制約: 修正後のコード・擬似コード・具体的な条件式や行（for文、if文、比較演算子、具体的な数値を使った式など）を一切書かないでください。コードの一部であっても不可です。エラーの意味と確認すべき観点だけを、自然な日本語の文章で説明してください。';

export interface ErrorExplainContext {
  language: Language;
  code: string;
  verdict: JudgeVerdict;
  compileStderr: string | null;
}

const RUNTIME_ERROR_STATUSES: ReadonlySet<PerTestCaseStatus> = new Set(['RE', 'TLE', 'MLE']);

const RUNTIME_STATUS_DESC: Record<'RE' | 'TLE' | 'MLE', string> = {
  RE: '実行時エラー（RE）',
  TLE: '実行時間超過（TLE）',
  MLE: 'メモリ超過（MLE）',
};

export function hasExplainableError(
  verdict: JudgeVerdict | null,
  compileStderr: string | null,
): boolean {
  if (!verdict) return false;
  if (verdict.overallStatus === 'CE') return true;
  if (compileStderr && compileStderr.trim() !== '') return true;
  if (verdict.overallStatus === 'TLE' || verdict.overallStatus === 'MLE') return true;
  return verdict.results.some((r) => RUNTIME_ERROR_STATUSES.has(r.status));
}

function findErrorLineNumber(compileStderr: string | null): number | null {
  if (!compileStderr) return null;
  // Matches typical compiler/interpreter line references:
  //   main.c:12:5: error: ...
  //   Main.java:8: error: ...
  //   File "<string>", line 14
  //   (line 7:3)
  const patterns = [
    /:(\d+):\d+:/,
    /\.java:(\d+):/,
    /line\s+(\d+)/i,
    /:(\d+):/,
  ];
  for (const re of patterns) {
    const m = compileStderr.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * Extracts a short, line-numbered snippet around the error line (when known)
 * or the first ~60 lines of student code, capped to keep the prompt compact.
 */
export function extractCodeSnippet(code: string, compileStderr: string | null): string {
  if (!code.trim()) return '(コードが入力されていません)';
  const lines = code.split(/\r?\n/);
  const targetLine = findErrorLineNumber(compileStderr);

  let startIdx = 0;
  let endIdx = Math.min(lines.length, 60);
  if (targetLine !== null && targetLine <= lines.length) {
    startIdx = Math.max(0, targetLine - 6);
    endIdx = Math.min(lines.length, targetLine + 5);
  }

  const numbered = lines
    .slice(startIdx, endIdx)
    .map((line, offset) => `${startIdx + offset + 1}: ${line}`)
    .join('\n');

  return numbered.slice(0, 1500);
}

/**
 * Builds the user message for `explainErrorStream`.
 * Strictly omits:
 * - Problem statement / reference solutions
 * - Any hidden test case's actualOutput, expectedOutput, or WA hint
 * - Passing (AC) and wrong-answer (WA) test cases
 */
export function buildErrorExplainContext(ctx: ErrorExplainContext): string {
  const lines: string[] = [];

  if (ctx.verdict.overallStatus === 'CE' || (ctx.compileStderr && ctx.compileStderr.trim() !== '')) {
    lines.push('エラー種別: コンパイル／構文エラー（CE）');
    if (ctx.compileStderr && ctx.compileStderr.trim() !== '') {
      lines.push('', 'エラーメッセージ:', ctx.compileStderr.slice(0, 2000));
    }
  }

  let addedHiddenRuntimeSummary = false;
  for (const r of ctx.verdict.results) {
    if (r.status !== 'RE' && r.status !== 'TLE' && r.status !== 'MLE') continue;
    if (r.isSample) {
      lines.push(
        '',
        `サンプルテストケースで${RUNTIME_STATUS_DESC[r.status]}が発生しました。`,
        `  実際の出力: ${r.actualOutput ? r.actualOutput.slice(0, 500) : '(なし)'}`,
      );
    } else if (!addedHiddenRuntimeSummary) {
      // Hidden test case: never include actualOutput, expectedOutput, or hint.
      lines.push('', `非公開テストケースで${RUNTIME_STATUS_DESC[r.status]}が発生しました。`);
      addedHiddenRuntimeSummary = true;
    }
  }

  if (
    lines.length === 0 &&
    (ctx.verdict.overallStatus === 'TLE' || ctx.verdict.overallStatus === 'MLE')
  ) {
    lines.push(`エラー種別: ${RUNTIME_STATUS_DESC[ctx.verdict.overallStatus]}`);
  }

  lines.push('', `該当箇所の周辺コード（${ctx.language}）:`, extractCodeSnippet(ctx.code, ctx.compileStderr));

  return lines.join('\n');
}

export function buildErrorExplainSystemPrompt(languageLabel: string, attempt = 0): string {
  const retryNudge =
    attempt > 0
      ? '\n\n（注意: 直前の回答にはコードやそれに近い具体的な記述が含まれていたため却下されました。今回は構文・記号・具体的な条件式を一文字も使わず、完全に自然な日本語の文章だけでエラーの意味を説明し直してください。）'
      : '';

  return `あなたはプログラミング初学者をサポートするアシスタントです。生徒の${languageLabel}コードで発生したコンパイルエラーや実行時エラー（RE / TLE / MLE）の意味を、初学者にも分かるやさしい日本語でかみ砕いて説明してください。

方針:
- 英語のエラーメッセージや専門用語を、初心者向けの言葉に言い換えて説明する。
- 「何のエラーなのか」「どのあたりを見直すとよいか」を2〜4文程度で簡潔に伝える。
- 答えや修正後のコードは教えず、生徒が自分で直せるように導く。

${ERROR_EXPLAIN_NO_CODE_RULE}${retryNudge}

回答は日本語で、2〜4文程度の短い文章のみにしてください。見出しや箇条書き、コードブロック（\`\`\`）は使わないでください。`;
}
