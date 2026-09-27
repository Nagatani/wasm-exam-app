import { transform } from 'sucrase';
import { prepareJsSource } from '../../judge/runner/shared/jsPrepare.js';
import { RUN_TIME_LIMIT_MS } from '../../judge/runner/shared/limits.js';

// JavaScript / TypeScript client-side runner. TS is type-stripped with sucrase
// (no type-checking — a type error won't fail the judge, only a syntax error
// will); the resulting JS runs one test case at a time in a throwaway Web
// Worker (see js.worker.ts) that is terminate()d on timeout.

export interface JsPrepareResult {
  ok: boolean;
  /** Executable JS (TS transpiled to JS; JS passed through). */
  js: string;
  /** Compile/syntax error message when ok is false. */
  error: string;
}

export interface JsRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = RUN_TIME_LIMIT_MS.JS;

// Transpile (TS) or syntax-check (JS) once; the result is reused for every
// test case, so a syntax error is reported before any test runs. The logic is
// shared with the judge (judge/runner/shared/jsPrepare.js), which runs it with
// the same sucrase version.
export function prepareJs(source: string, language: 'JS' | 'TS'): JsPrepareResult {
  return prepareJsSource(source, language, transform);
}

export async function runJsOnce(
  js: string,
  stdin: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<JsRunResult> {
  const worker = new Worker(new URL('./js.worker.ts', import.meta.url));
  try {
    return await new Promise<JsRunResult>((resolve) => {
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({ ok: false, stdout: '', stderr: '実行時間の上限を超えました。', timedOut: true });
      }, timeoutMs);

      worker.onmessage = (e: MessageEvent) => {
        clearTimeout(timer);
        const data = e.data as { ok: boolean; stdout: string; stderr: string };
        resolve({ ok: data.ok, stdout: data.stdout, stderr: data.stderr, timedOut: false });
      };
      worker.onerror = (e: ErrorEvent) => {
        clearTimeout(timer);
        resolve({ ok: false, stdout: '', stderr: e.message || 'worker error', timedOut: false });
      };

      worker.postMessage({ code: js, stdin });
    });
  } finally {
    worker.terminate();
  }
}

