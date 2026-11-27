import type { IncomingMessage } from 'node:http';

/**
 * Extracts a single cookie value from the `Cookie` request header.
 * Returns `undefined` if the header or cookie name is absent.
 * Malformed percent-encoding falls back to the raw value.
 */
export function getCookie(req: Pick<IncomingMessage, 'headers'>, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key !== name) continue;

    let raw = part.slice(eqIdx + 1).trim();
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1);
    }
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return undefined;
}
