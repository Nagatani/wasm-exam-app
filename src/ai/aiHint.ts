import type { InitProgressReport } from '@mlc-ai/web-llm';
import { loadAiAssistModel } from './aiAssist';
import type { JudgeVerdict } from '../types/student';
import {
  buildStageContext,
  looksLikeCode,
  type HintContext,
  type HintStage,
} from './aiHintContext';
import { LANGUAGE_LABEL } from '../lib/language';

export { HINT_STAGE_LABEL, type HintContext, type HintStage } from './aiHintContext';

// Staged, non-revealing hints for practice-mode tasks — reuses the same
// downloaded model/engine as ../ai/aiAssist.ts's authoring assist
// (loadAiAssistModel is memoized module-wide, so this never triggers a
// second download/worker). Unlike aiAssist.ts's JSON-schema-constrained
// draft generation, a hint is just a short paragraph of prose, so this asks
// for plain text.

// 実測での知見（2026-09-19、実際にモデルを走らせて確認）:
// - ステージ1は「抽象的な着眼点だけ」と指示しても、具体的な仕組み名（「最後の要素を
//   読み込めていない」等）まで踏み込んでしまうことがあった。「どの処理が」「何回」と
//   いった仕組みの名指しを明示的に禁止する。
// - ステージ3の「簡単な擬似コード（1行程度）までは可」という許容は、単純な1行バグの
//   問題では実質的に修正済みコードそのものを書かせる抜け道になっていた（実例:
//   「正しいのは `for (int i = 0; i < n; i++)` です」とそのまま出力）。この許容を
//   撤廃し、コード・擬似コード・具体的な条件式を全ステージで一律禁止する。
const STAGE_INSTRUCTION: Record<HintStage, string> = {
  1: '生徒はまだ自分でどこが間違っているか分かっていません。問題文とコード全体を見て、「どのあたりに注目して見直すべきか」という抽象的な着眼点だけを1〜2文で伝えてください。「〇〇の処理が足りない」「〇〇回しか実行されない」のように、具体的にどの仕組み・処理が問題かを名指しすることも禁止です。生徒が問題文とコードをもう一度自分で見直したくなるような、一般的な問いかけにとどめてください。',
  2: '問題文・コード・実行結果を踏まえて、「コードのどのあたりが疑わしいか」をもう一歩具体的に指摘してください（変数名や処理のまとまり単位で触れる程度は構いません）。ただし、何が正しい値・条件であるべきかや、修正の具体的な内容には踏み込まないでください。',
  3: '問題文・コード・実行結果を踏まえて、「どう直せばよいか」という修正の考え方を説明してください。どこに注目し、どう考え方を変えればよいかを言葉で説明することに徹してください。',
};

// Blanket rule applied to every stage, on top of the per-stage instruction
// above — the per-stage wording alone wasn't reliable (see the 2026-09-19
// note above), so this is stated again explicitly at the end of the system
// prompt as a hard constraint.
const NO_CODE_RULE =
  '重要な制約: どのステージであっても、修正後のコード・擬似コード・具体的な条件式や行（for文、if文、比較演算子、具体的な数値を使った式など）を一切書かないでください。コードの一部であっても不可です。説明はすべて自然な日本語の文章だけで行ってください。';

function isCompileErrorGuardActive(stage: HintStage, verdict: JudgeVerdict): boolean {
  return stage === 1 && verdict.overallStatus === 'CE';
}

const GENERATE_FAILURE_MESSAGE = 'ヒントの生成に失敗しました。もう一度お試しください。';
const CONTAINS_CODE_MESSAGE =
  'AIの回答にコードの一部が含まれていた可能性があるため表示を取り消しました。もう一度お試しください（内容は毎回変わります）。';

// How many times to silently retry when the guard catches code in the
// output, before giving up and surfacing CONTAINS_CODE_MESSAGE to the
// caller. Observed while tuning this (2026-09-19): for a single-line fix
// (e.g. a loop-bound off-by-one), stage 3 kept rewriting the corrected line
// across every attempt regardless of NO_CODE_RULE or the escalating retry
// nudge below — for that class of bug this ceiling appears to be the 3B
// model's, not something more retries fix. Kept at 2 (not higher) so a
// doomed case fails in ~2x the generation time instead of ~4x with the
// student staring at "生成中..." the whole way.
const MAX_ATTEMPTS = 2;

function buildRetryNudge(attempt: number): string {
  if (attempt === 0) return '';
  return `\n\n（注意: 直前の回答にはコードやそれに近い具体的な記述が含まれていたため却下されました。今回は、変数名や処理の意図に触れるのは構いませんが、for/if/while などの構文や比較演算子、具体的な条件式を一文字も使わずに、完全に自然な日本語の文章だけで説明し直してください。）`;
}

async function requestHintOnce(
  engine: Awaited<ReturnType<typeof loadAiAssistModel>>,
  stage: HintStage,
  ctx: HintContext,
  attempt: number,
): Promise<string> {
  const languageLabel = LANGUAGE_LABEL[ctx.language];
  const stageContext = buildStageContext(stage, ctx);
  // A CE at stage 1 has no useful "approach" to point at yet beyond "it
  // doesn't compile" — nudge the model toward that rather than guessing.
  const extraGuard = isCompileErrorGuardActive(stage, ctx.verdict)
    ? '\n\nこの生徒のコードはまだコンパイルが通っていません。まずはエラーメッセージが指している箇所を確認するよう促してください。'
    : '';

  const system = `あなたはプログラミング学習者を指導するアシスタントです。生徒が演習問題に取り組んでいて、まだ正解していません。生徒に「答えそのもの」や「そのまま貼り付ければ動く修正済みコード」を教えてはいけません。教えるのはヒントだけです。

${STAGE_INSTRUCTION[stage]}${extraGuard}

${NO_CODE_RULE}${buildRetryNudge(attempt)}

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
      // Lower than aiAssist.ts's draft generation (0.7) — a hint should be
      // a fairly literal application of the stage instruction, not a
      // creative one; less sampling variance means fewer chances to
      // wander into forbidden territory (see NO_CODE_RULE above).
      temperature: 0.4,
      max_tokens: 300,
    });
  } catch {
    throw new Error(GENERATE_FAILURE_MESSAGE);
  }

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(GENERATE_FAILURE_MESSAGE);
  }
  if (looksLikeCode(content)) {
    throw new Error(CONTAINS_CODE_MESSAGE);
  }
  return content;
}

export async function generateHint(
  stage: HintStage,
  ctx: HintContext,
  onProgress?: (report: InitProgressReport) => void,
): Promise<string> {
  // loadAiAssistModel() already throws a friendly Japanese message on
  // failure (see aiAssist.ts) — let it propagate as-is.
  const engine = await loadAiAssistModel(onProgress);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await requestHintOnce(engine, stage, ctx, attempt);
    } catch (err) {
      lastError = err;
      // Only worth retrying when the *content itself* was rejected — a
      // model/network failure (GENERATE_FAILURE_MESSAGE) won't be fixed by
      // resampling the same request.
      if (!(err instanceof Error) || err.message !== CONTAINS_CODE_MESSAGE) {
        throw err;
      }
    }
  }
  throw lastError;
}
