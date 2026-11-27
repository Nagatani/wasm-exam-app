import { describe, expect, it } from 'vitest';
import { getCookie } from '../src/lib/cookies';

function reqWithCookie(cookie?: string) {
  return { headers: cookie === undefined ? {} : { cookie } };
}

describe('getCookie', () => {
  it('returns undefined when Cookie header is missing or empty', () => {
    expect(getCookie(reqWithCookie(undefined), 'session_token')).toBeUndefined();
    expect(getCookie(reqWithCookie(''), 'session_token')).toBeUndefined();
  });

  it('extracts a single cookie or one from multiple semicolon-separated cookies', () => {
    expect(getCookie(reqWithCookie('session_token=abc123'), 'session_token')).toBe('abc123');
    expect(getCookie(reqWithCookie('theme=dark; session_token=deadbeef; foo=bar'), 'session_token')).toBe('deadbeef');
    expect(getCookie(reqWithCookie('other=1; session_token=xyz'), 'missing')).toBeUndefined();
  });

  it('preserves = characters inside cookie values and unwraps surrounding quotes', () => {
    expect(getCookie(reqWithCookie('token=a=b=c'), 'token')).toBe('a=b=c');
    expect(getCookie(reqWithCookie('token="quoted=val"'), 'token')).toBe('quoted=val');
  });

  it('decodes percent-encoded values and falls back to raw on malformed escape sequences', () => {
    expect(getCookie(reqWithCookie('name=hello%20world'), 'name')).toBe('hello world');
    expect(getCookie(reqWithCookie('bad=%E0%A4%A'), 'bad')).toBe('%E0%A4%A');
  });

  it('ignores malformed segments without = and returns empty string for empty values', () => {
    expect(getCookie(reqWithCookie('novalue; session_token=ok'), 'session_token')).toBe('ok');
    expect(getCookie(reqWithCookie('session_token='), 'session_token')).toBe('');
  });
});
