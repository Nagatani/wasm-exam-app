import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PYODIDE_BASE_URL, resolvePyodideBaseUrl } from './pyRunner.ts';

describe('resolvePyodideBaseUrl', () => {
  it('defaults to the jsDelivr CDN when unset or blank', () => {
    assert.equal(resolvePyodideBaseUrl(undefined), DEFAULT_PYODIDE_BASE_URL);
    assert.equal(resolvePyodideBaseUrl('  '), DEFAULT_PYODIDE_BASE_URL);
  });

  it('uses a configured self-hosted location, always with a trailing slash', () => {
    assert.equal(resolvePyodideBaseUrl('/pyodide/v0.28.0/full'), '/pyodide/v0.28.0/full/');
    assert.equal(
      resolvePyodideBaseUrl('https://mirror.example.ac.jp/pyodide/'),
      'https://mirror.example.ac.jp/pyodide/',
    );
  });
});
