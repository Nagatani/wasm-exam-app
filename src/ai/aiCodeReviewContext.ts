import type { Language } from '../types/exam';

// Pure, dependency-free context builder for post-AC code reviews in PRACTICE
// mode. Deliberately accepts only language, statementMarkdown, and the
// student's accepted code — never test cases, hidden expected outputs, or
// teacher reference solutions.

export interface CodeReviewContext {
  language: Language;
  statementMarkdown: string;
  code: string;
}

export function buildCodeReviewSystemPrompt(languageLabel: string): string {
  return `あなたはプログラミング学習者を指導するメンターです。生徒は演習問題で正解（AC）を達成しました。生徒の${languageLabel}コードに対して、さらなる成長につながる簡潔なコードレビューを日本語で行ってください。

観点:
- 可読性（変数名・関数分割・インデントや構造の分かりやすさ）
- 冗長な分岐や重複処理の整理
- 境界条件・エッジケースへの配慮
- 計算量やメモリ効率（改善余地がある場合のみ）

回答形式:
- 「良い点」を1点、「改善のヒント」を1〜2点、簡潔な日本語の箇条書きで伝えてください。
- 押し付けがましくならず、励ましを込めて具体的に述べてください。
- 問題文に書かれていない非公開テストケースの内容を推測したり言及したりしないでください。`;
}

export function buildCodeReviewUserPrompt(
  ctx: CodeReviewContext,
  languageLabel: string,
): string {
  const statement = ctx.statementMarkdown.trim().slice(0, 3000) || '(問題文なし)';
  const code = ctx.code.trim().slice(0, 6000) || '(コードなし)';

  return `【問題文】
${statement}

【生徒の正解（AC）コード（${languageLabel}）】
${code}`;
}
