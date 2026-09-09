// HTTP client for the sandboxed `judge` container (docker-compose `judge`
// service). Only the server talks to it — never the browser — and it lives on
// loopback / an internal network. See judge/Judge.java for the protocol.

const JUDGE_URL = (process.env.JUDGE_URL ?? '').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.JUDGE_REQUEST_TIMEOUT_MS ?? 60_000);

export function isJudgeConfigured(): boolean {
  return JUDGE_URL.length > 0;
}

export interface JudgeTestSpec {
  id: string;
  stdin: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface JudgeRunRequest {
  code: string;
  tests: JudgeTestSpec[];
}

export interface JudgeTestOutcome {
  id: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  oom: boolean;
}

export interface JudgeRunResponse {
  compile: { ok: boolean; stderr: string };
  results: JudgeTestOutcome[];
}

export class JudgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeError';
  }
}

export async function runOnJudge(req: JudgeRunRequest): Promise<JudgeRunResponse> {
  if (!isJudgeConfigured()) {
    throw new JudgeError('judge_not_configured');
  }

  let res: Response;
  try {
    res = await fetch(`${JUDGE_URL}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new JudgeError(`judge_unreachable: ${reason}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new JudgeError(`judge_status_${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as JudgeRunResponse;
}

export async function judgeHealthy(): Promise<boolean> {
  if (!isJudgeConfigured()) return false;
  try {
    const res = await fetch(`${JUDGE_URL}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
