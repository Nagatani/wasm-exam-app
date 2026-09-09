import { transform } from 'sucrase';

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

const DEFAULT_TIMEOUT_MS = 10_000;

// Transpile (TS) or syntax-check (JS) once; the result is reused for every
// test case, so a syntax error is reported before any test runs.
export function prepareJs(source: string, language: 'JS' | 'TS'): JsPrepareResult {
  if (language === 'TS') {
    try {
      const { code } = transform(source, {
        transforms: ['typescript'],
        disableESTransforms: true,
      });
      return { ok: true, js: code, error: '' };
    } catch (err) {
      return { ok: false, js: '', error: formatError(err) };
    }
  }

  try {
    // Parse without executing — throws SyntaxError on malformed source.
    new Function(source);
    return { ok: true, js: source, error: '' };
  } catch (err) {
    return { ok: false, js: '', error: formatError(err) };
  }
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

function formatError(err: unknown): string {
  if (err instanceof Error) {
    // sucrase syntax errors already carry a "(line:col)" location in .message.
    return err.message;
  }
  return String(err);
}
