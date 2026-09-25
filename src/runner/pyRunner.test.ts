import { describe, expect, it } from 'vitest';
import { DEFAULT_PYODIDE_BASE_URL, resolvePyodideBaseUrl } from './pyRunner';

describe('resolvePyodideBaseUrl', () => {
  it('defaults to the jsDelivr CDN when unset or blank', () => {
    expect(resolvePyodideBaseUrl(undefined)).toBe(DEFAULT_PYODIDE_BASE_URL);
    expect(resolvePyodideBaseUrl('  ')).toBe(DEFAULT_PYODIDE_BASE_URL);
  });

  it('uses a configured self-hosted location, always with a trailing slash', () => {
    expect(resolvePyodideBaseUrl('/pyodide/v0.28.0/full')).toBe('/pyodide/v0.28.0/full/');
    expect(resolvePyodideBaseUrl('https://mirror.example.ac.jp/pyodide/')).toBe(
      'https://mirror.example.ac.jp/pyodide/',
    );
  });
});
