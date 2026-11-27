import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { corsMiddleware } from '../src/lib/cors';

function createMockRes(initialHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...initialHeaders };
  let statusCode: number | undefined;
  let ended = false;
  const res = {
    getHeader: (k: string) => headers[k.toLowerCase()] ?? headers[k],
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    end: () => {
      ended = true;
      return res;
    },
  } as unknown as Response;
  return { res, headers, getStatus: () => statusCode, isEnded: () => ended };
}

describe('corsMiddleware', () => {
  const mw = corsMiddleware({ origin: 'http://localhost:5173', credentials: true });

  it('sets CORS headers and Vary: Origin on normal requests and calls next()', () => {
    const { res, headers, isEnded } = createMockRes();
    const next = vi.fn();
    mw({ method: 'GET', headers: {} } as Request, res, next);

    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers['Vary']).toBe('Origin');
    expect(isEnded()).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('handles OPTIONS preflight with 204 and echoes Access-Control-Request-Headers', () => {
    const { res, headers, getStatus, isEnded } = createMockRes();
    const next = vi.fn();
    mw(
      { method: 'OPTIONS', headers: { 'access-control-request-headers': 'Content-Type, X-Custom' } } as unknown as Request,
      res,
      next,
    );

    expect(getStatus()).toBe(204);
    expect(isEnded()).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, X-Custom');
    expect(headers['Vary']).toBe('Origin, Access-Control-Request-Headers');
  });

  it('falls back to standard Access-Control-Allow-Headers when request headers are absent', () => {
    const { res, headers, getStatus, isEnded } = createMockRes();
    const next = vi.fn();
    mw({ method: 'OPTIONS', headers: {} } as Request, res, next);

    expect(getStatus()).toBe(204);
    expect(isEnded()).toBe(true);
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization');
    expect(headers['Vary']).toBe('Origin');
  });

  it('appends to an existing Vary header without duplicating Origin', () => {
    const { res, headers } = createMockRes({ vary: 'Accept-Encoding' });
    const next = vi.fn();
    mw({ method: 'GET', headers: {} } as Request, res, next);
    expect(headers['Vary']).toBe('Accept-Encoding, Origin');
  });

  it('omits Access-Control-Allow-Credentials when credentials is false', () => {
    const noCreds = corsMiddleware({ origin: 'https://example.com', credentials: false });
    const { res, headers } = createMockRes();
    const next = vi.fn();
    noCreds({ method: 'GET', headers: {} } as Request, res, next);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
