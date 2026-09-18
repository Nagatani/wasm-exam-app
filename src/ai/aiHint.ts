import type { InitProgressReport } from '@mlc-ai/web-llm';
import { loadAiAssistModel } from './aiAssist';
import type { Language } from '../types/exam';
import type { JudgeVerdict } from '../types/student';
import { LANGUAGE_LABEL } from '../lib/language';

// Staged, non-revealing hints for practice-mode tasks — reuses the same
// downloaded model/engine as ../ai/aiAssist.ts's authoring assist
// (loadAiAssistModel is memoized module-wide, so this never triggers a
// second download/worker). Unlike aiAssist.ts's JSON-schema-constrained
// draft generation, a hint is just a short paragraph of prose, so this asks
// for plain text.

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
function buildStageContext(stage: HintStage, ctx: HintContext): string {
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

const STAGE_INSTRUCTION: Record<HintStage, string> = {
  1: '生徒はまだ自分でどこが間違っているか分かっていません。問題文とコード全体を見て、「どのあたりに注目して見直すべきか」という抽象的な着眼点だけを1〜2文で伝えてください。具体的な行・変数名・バグの指摘や、コードの一部でも書くことは禁止です。',
  2: '問題文・コード・実行結果を踏まえて、「コードのどのあたりが疑わしいか」をもう一歩具体的に指摘してください（該当しそうな処理内容や考え方のレベルまで）。ただし、修正後のコードやその一部を書くことは禁止です。',
  3: '問題文・コード・実行結果を踏まえて、「どう直せばよいか」という具体的な修正の方針を説明してください。考え方や簡単な擬似コード（1行程度）までは構いませんが、修正後の完全なコード全体を書くことは禁止です。',
};

function isCompileErrorGuardActive(stage: HintStage, verdict: JudgeVerdict): boolean {
  return stage === 1 && verdict.overallStatus === 'CE';
}

const GENERATE_FAILURE_MESSAGE = 'ヒントの生成に失敗しました。もう一度お試しください。';

export async function generateHint(
  stage: HintStage,
  ctx: HintContext,
  onProgress?: (report: InitProgressReport) => void,
): Promise<string> {
  // loadAiAssistModel() already throws a friendly Japanese message on
  // failure (see aiAssist.ts) — let it propagate as-is.
  const engine = await loadAiAssistModel(onProgress);

  const languageLabel = LANGUAGE_LABEL[ctx.language];
  const stageContext = buildStageContext(stage, ctx);
  // A CE at stage 1 has no useful "approach" to point at yet beyond "it
  // doesn't compile" — nudge the model toward that rather than guessing.
  const extraGuard = isCompileErrorGuardActive(stage, ctx.verdict)
    ? '\n\nこの生徒のコードはまだコンパイルが通っていません。まずはエラーメッセージが指している箇所を確認するよう促してください。'
    : '';

  const system = `あなたはプログラミング学習者を指導するアシスタントです。生徒が演習問題に取り組んでいて、まだ正解していません。生徒に「答えそのもの」や「そのまま貼り付ければ動く修正済みコード」を教えてはいけません。教えるのはヒントだけです。

${STAGE_INSTRUCTION[stage]}${extraGuard}

回答は日本語で、2〜4文程度の短い文章のみにしてください。見出しや箇条書き、コードブロック（\`\`\`）は使わないでください。`;

  const user = `【問題文】
${ctx.statementMarkdown}

【生徒の現在のコード（${languageLabel}）】
${ctx.code || '(まだ何も書かれていません)'}

【${stageContext}】`;

  let completion;
  try {
    completion = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
      max_tokens: 300,
    });
  } catch {
    throw new Error(GENERATE_FAILURE_MESSAGE);
  }

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(GENERATE_FAILURE_MESSAGE);
  }
  return content;
}
