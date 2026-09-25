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
    const message = formatError(err);
    // V8's SyntaxError carries no line/column, so the editor couldn't mark
    // it (compileErrors.ts looks for `(line:col)`). Re-parse with sucrase
    // only to locate the error; `new Function` stays the authority on
    // whether the code is valid.
    const position = syntaxErrorPosition(source);
    return {
      ok: false,
      js: '',
      error: position && !/\(\d+:\d+\)/.test(message) ? `${message} (${position})` : message,
    };
  }
}

// `line:col` of the first syntax error sucrase finds, or null if it parses
// (sucrase is more lenient than V8 in a few places, e.g. top-level await).
function syntaxErrorPosition(source: string): string | null {
  try {
    transform(source, { transforms: [] });
    return null;
  } catch (err) {
    const m = err instanceof Error ? err.message.match(/\((\d+:\d+)\)/) : null;
    return m ? m[1] : null;
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
