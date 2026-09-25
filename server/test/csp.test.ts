import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { buildCsp, cspMiddleware, cspMode } from '../src/lib/csp';

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split('; ').map((d) => {
      const [name, ...values] = d.split(' ');
      return [name, values];
    }),
  );
}

describe('CSP', () => {
  it('defaults to report-only; enforce/off are explicit', () => {
    expect(cspMode(undefined)).toBe('report');
    expect(cspMode('bogus')).toBe('report');
    expect(cspMode('enforce')).toBe('enforce');
    expect(cspMode('off')).toBe('off');
  });

  it('allows exactly what the runtimes need', () => {
    const d = directives(buildCsp());
    expect(d['default-src']).toEqual(["'self'"]);
    // new Function (JS runner) + WebAssembly (clang / Pyodide / WebLLM)
    expect(d['script-src']).toEqual(expect.arrayContaining(["'unsafe-eval'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net']));
    expect(d['connect-src']).toEqual(
      expect.arrayContaining(['https://registry.wasmer.io', 'https://huggingface.co', 'https://raw.githubusercontent.com']),
    );
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['report-uri']).toEqual(['/api/csp-report']);
  });

  it('appends CSP_EXTRA_SOURCES (e.g. a self-hosted Pyodide host)', () => {
    const d = directives(buildCsp(['https://mirror.example.ac.jp', '']));
    expect(d['script-src']).toContain('https://mirror.example.ac.jp');
    expect(d['connect-src']).toContain('https://mirror.example.ac.jp');
    expect(d['script-src']).not.toContain('');
  });

  it('middleware picks the header by mode', () => {
    const run = (mode: 'report' | 'enforce' | 'off') => {
      const headers: Record<string, string> = {};
      const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
      const next = vi.fn();
      cspMiddleware(mode)({} as Request, res, next);
      expect(next).toHaveBeenCalled();
      return Object.keys(headers);
    };
    expect(run('report')).toEqual(['Content-Security-Policy-Report-Only']);
    expect(run('enforce')).toEqual(['Content-Security-Policy']);
    expect(run('off')).toEqual([]);
  });
});
