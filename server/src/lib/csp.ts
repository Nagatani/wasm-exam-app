import type { RequestHandler } from 'express';

// Content-Security-Policy for everything this server serves (2026-09-26).
//
// The app pulls code from a handful of external places, so the allow-list is
// explicit about each one:
//   - cdn.jsdelivr.net   Monaco (loader script, CSS, codicon font, its
//                        blob: workers importScripts from here) and Pyodide
//                        (importScripts + .wasm/.data fetches in py.worker)
//   - *.wasmer.io        @wasmer/sdk fetching clang from the Wasmer registry
//   - huggingface.co, *.huggingface.co, *.hf.co, raw.githubusercontent.com
//                        @mlc-ai/web-llm model weights / model library (AI
//                        作問サポート / AIヒント)
// 'unsafe-eval' is required, not a shortcut: the JS/TS runner checks syntax
// with `new Function` and runs student code the same way inside its worker.
// 'wasm-unsafe-eval' lets WebAssembly compile (clang, Pyodide, WebLLM).
//
// CSP_MODE: `report` (default) sends Content-Security-Policy-Report-Only —
// nothing is ever blocked, violations are POSTed to /api/csp-report and
// logged, so an operator can confirm a deployment is clean first; `enforce`
// sends the real header; `off` sends neither. CSP_EXTRA_SOURCES (space
// separated origins) is appended to script-src / connect-src / style-src /
// font-src, e.g. for a self-hosted Pyodide on another host.

export type CspMode = 'report' | 'enforce' | 'off';

export const CSP_REPORT_PATH = '/api/csp-report';

const CDN = 'https://cdn.jsdelivr.net';
const WASMER = ['https://registry.wasmer.io', 'https://*.wasmer.io'];
const WEBLLM = [
  'https://huggingface.co',
  'https://*.huggingface.co',
  'https://*.hf.co',
  'https://raw.githubusercontent.com',
];

export function cspMode(raw: string | undefined): CspMode {
  return raw === 'enforce' || raw === 'off' ? raw : 'report';
}

export function buildCsp(extraSources: string[] = []): string {
  const extra = extraSources.filter(Boolean);
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'blob:', CDN, ...extra],
    'worker-src': ["'self'", 'blob:'],
    'style-src': ["'self'", "'unsafe-inline'", CDN, ...extra],
    'font-src': ["'self'", 'data:', CDN, ...extra],
    'img-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'", 'blob:', 'data:', CDN, ...WASMER, ...WEBLLM, ...extra],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'report-uri': [CSP_REPORT_PATH],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export function cspMiddleware(mode: CspMode, extraSources: string[] = []): RequestHandler {
  const header =
    mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
  const value = buildCsp(extraSources);
  return (_req, res, next) => {
    if (mode !== 'off') res.setHeader(header, value);
    next();
  };
}

// Violation reports are logged, but capped so a class full of browsers (or a
// hostile client — the endpoint is necessarily unauthenticated) can't flood
// the log: at most REPORT_LOG_LIMIT lines per minute.
const REPORT_LOG_LIMIT = 30;
let windowStart = 0;
let loggedInWindow = 0;

export const cspReportHandler: RequestHandler = (req, res) => {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    loggedInWindow = 0;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const report = (body['csp-report'] ?? body) as Record<string, unknown>;
  if (loggedInWindow < REPORT_LOG_LIMIT) {
    loggedInWindow += 1;
    const page = typeof report['document-uri'] === 'string' ? safePath(report['document-uri']) : '?';
    console.warn(
      `CSP violation: ${String(report['violated-directive'] ?? report['effective-directive'] ?? '?')} ` +
        `blocked ${String(report['blocked-uri'] ?? '?')} on ${page}`,
    );
  }
  res.status(204).end();
};

// Log only the path — never a query string that might carry ids/tokens.
function safePath(uri: string): string {
  try {
    return new URL(uri).pathname;
  } catch {
    return '?';
  }
}
