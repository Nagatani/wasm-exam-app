import type { Language, SubmissionOverallStatus } from '../types/exam';

// Pure, dependency-free context builder for teacher-facing in-browser
// misconception summaries (L4). Strictly anonymized: never accepts or outputs
// studentNumber, displayName, studentId, or any other PII.

export type NonAcStatus = Exclude<SubmissionOverallStatus, 'AC'>;

const NON_AC_STATUSES = new Set<string>(['WA', 'CE', 'TLE', 'MLE']);
const VALID_LANGUAGES = new Set<string>(['C', 'JAVA', 'JS', 'TS', 'PYTHON']);

export const MAX_SAMPLE_CODE_CHARS = 800;
export const MAX_CLUSTERS = 8;

export interface AnonymizedStatusCounts {
  AC: number;
  WA: number;
  CE: number;
  TLE: number;
  MLE: number;
  unsubmitted: number;
}

export interface AnonymizedFailureSample {
  status: NonAcStatus;
  language?: Language;
  code?: string;
  failingTestHints?: string[];
}

export interface ClusteredFailureSample {
  status: NonAcStatus;
  count: number;
  code: string;
  failingTestHints: string[];
}

export interface MisconceptionContextInput {
  taskTitle: string;
  language?: Language;
  totalStudents: number;
  statusCounts: AnonymizedStatusCounts;
  samples: AnonymizedFailureSample[];
}

function redactIdentifiers(text: string, redactStrings?: readonly string[]): string {
  if (!redactStrings || redactStrings.length === 0) return text;
  let result = text;
  for (const token of redactStrings) {
    const trimmed = token.trim();
    // Skip very short strings (1 char) to avoid mangling single-letter variable names.
    if (trimmed.length < 2) continue;
    result = result.split(trimmed).join('[匿名]');
  }
  return result;
}

/**
 * Extracts strictly anonymized fields from an arbitrary submission-like object,
 * discarding `studentId`, `studentNumber`, `displayName`, and any other PII.
 * Returns `null` if the record is AC or not a valid non-AC failure status.
 */
export function sanitizeSubmissionForMisconception(
  raw: Record<string, unknown>,
  redactStrings?: readonly string[],
): AnonymizedFailureSample | null {
  const status = raw.status ?? raw.overallStatus;
  if (typeof status !== 'string' || !NON_AC_STATUSES.has(status)) {
    return null;
  }

  const language =
    typeof raw.language === 'string' && VALID_LANGUAGES.has(raw.language)
      ? (raw.language as Language)
      : undefined;

  let code: string | undefined;
  if (typeof raw.code === 'string' && raw.code.trim().length > 0) {
    code = redactIdentifiers(raw.code.trim(), redactStrings).slice(0, MAX_SAMPLE_CODE_CHARS);
  }

  let failingTestHints: string[] | undefined;
  if (Array.isArray(raw.failingTestHints)) {
    const uniqueHints = [
      ...new Set(
        raw.failingTestHints
          .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
          .map((h) => redactIdentifiers(h.trim(), redactStrings).slice(0, 120)),
      ),
    ].slice(0, 5);
    if (uniqueHints.length > 0) {
      failingTestHints = uniqueHints;
    }
  }

  return {
    status: status as NonAcStatus,
    ...(language ? { language } : {}),
    ...(code ? { code } : {}),
    ...(failingTestHints ? { failingTestHints } : {}),
  };
}

/**
 * Deduplicates and clusters anonymized failure samples by status and
 * whitespace-normalized code so common misconception patterns surface first
 * within a compact token budget.
 */
export function clusterAnonymizedSamples(
  samples: readonly AnonymizedFailureSample[],
  maxClusters = MAX_CLUSTERS,
  maxCodeChars = MAX_SAMPLE_CODE_CHARS,
): ClusteredFailureSample[] {
  const clusters = new Map<
    string,
    { status: NonAcStatus; count: number; code: string; hints: Set<string> }
  >();

  for (const sample of samples) {
    if (!NON_AC_STATUSES.has(sample.status)) continue;
    const trimmedCode = (sample.code ?? '').trim().slice(0, maxCodeChars);
    const normalizedCode = trimmedCode.replace(/\s+/g, ' ');
    const key = `${sample.status}::${normalizedCode}`;

    const existing = clusters.get(key);
    if (existing) {
      existing.count += 1;
      for (const h of sample.failingTestHints ?? []) {
        if (h.trim()) existing.hints.add(h.trim());
      }
    } else {
      const hints = new Set<string>();
      for (const h of sample.failingTestHints ?? []) {
        if (h.trim()) hints.add(h.trim());
      }
      clusters.set(key, {
        status: sample.status,
        count: 1,
        code: trimmedCode,
        hints,
      });
    }
  }

  return [...clusters.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, maxClusters))
    .map((c) => ({
      status: c.status,
      count: c.count,
      code: c.code,
      failingTestHints: [...c.hints].slice(0, 5),
    }));
}

export function buildMisconceptionSystemPrompt(): string {
  return `あなたはプログラミング授業の教員を支援する分析アシスタントです。クラス全体の匿名化された集計データおよび非AC（誤答・コンパイルエラー等）のコードサンプルをもとに、生徒がつまずいている傾向を日本語で簡潔に要約してください。

ルール:
- 入力データはすべて匿名化されています。個人を特定する表現や推測は一切書かないでください。
- 以下の2セクション構成で、簡潔な箇条書きで出力してください:
  1. よくあるつまずき・誤答パターン（上位3〜5件、発生傾向と原因）
  2. 次回講義での補足・解説ポイント（2〜3点、具体的な指導の着眼点）
- 非ACのサンプルが少ない、またはコードサンプルが無い場合は、集計結果から分かる範囲だけを誠実に述べてください。`;
}

export function buildMisconceptionUserPrompt(
  input: MisconceptionContextInput,
  languageLabel?: string,
): string {
  const { statusCounts } = input;
  const submitted =
    statusCounts.AC +
    statusCounts.WA +
    statusCounts.CE +
    statusCounts.TLE +
    statusCounts.MLE;
  const nonAc = statusCounts.WA + statusCounts.CE + statusCounts.TLE + statusCounts.MLE;

  const lines: string[] = [
    `【設問】${input.taskTitle || '(無題)'}`,
    ...(languageLabel ? [`【言語】${languageLabel}`] : []),
    `【集計（匿名）】対象人数: ${input.totalStudents}名 / 提出: ${submitted}名 / 未提出: ${statusCounts.unsubmitted}名`,
    `内訳: AC=${statusCounts.AC}名, WA=${statusCounts.WA}名, CE=${statusCounts.CE}名, TLE=${statusCounts.TLE}名, MLE=${statusCounts.MLE}名（非AC合計: ${nonAc}名）`,
  ];

  const clustered = clusterAnonymizedSamples(input.samples);
  if (clustered.length > 0) {
    lines.push('', '【匿名化された非ACコードサンプル（クラスタ集計）】');
    clustered.forEach((cluster, index) => {
      lines.push(`\n--- パターン${index + 1}（${cluster.status} / ${cluster.count}件） ---`);
      if (cluster.failingTestHints.length > 0) {
        lines.push(`失敗傾向メモ: ${cluster.failingTestHints.join(' / ')}`);
      }
      if (cluster.code) {
        lines.push(cluster.code);
      } else {
        lines.push('(コードなし)');
      }
    });
  } else {
    lines.push('', '【匿名化された非ACコードサンプル】なし');
  }

  return lines.join('\n');
}
