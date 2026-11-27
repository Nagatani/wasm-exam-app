import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface CorsOptions {
  origin: string;
  credentials?: boolean;
}

const DEFAULT_ALLOW_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE';
const DEFAULT_ALLOW_HEADERS = 'Content-Type, Authorization';

function appendVary(res: Response, field: string): void {
  const existing = res.getHeader('Vary');
  if (!existing) {
    res.setHeader('Vary', field);
    return;
  }
  const values = (Array.isArray(existing) ? existing.join(',') : String(existing))
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (!values.some((v) => v.toLowerCase() === field.toLowerCase())) {
    values.push(field);
    res.setHeader('Vary', values.join(', '));
  }
}

export function corsMiddleware(options: CorsOptions): RequestHandler {
  const { origin, credentials = false } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    appendVary(res, 'Origin');
    if (credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', DEFAULT_ALLOW_METHODS);
      const reqHeaders = req.headers['access-control-request-headers'];
      if (typeof reqHeaders === 'string' && reqHeaders.trim().length > 0) {
        res.setHeader('Access-Control-Allow-Headers', reqHeaders);
        appendVary(res, 'Access-Control-Request-Headers');
      } else if (Array.isArray(reqHeaders) && reqHeaders.length > 0) {
        res.setHeader('Access-Control-Allow-Headers', reqHeaders.join(', '));
        appendVary(res, 'Access-Control-Request-Headers');
      } else {
        res.setHeader('Access-Control-Allow-Headers', DEFAULT_ALLOW_HEADERS);
      }
      res.status(204).end();
      return;
    }

    next();
  };
}
