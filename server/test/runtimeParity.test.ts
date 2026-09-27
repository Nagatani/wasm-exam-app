import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PYODIDE_VERSION, RUN_TIME_LIMIT_MS } from '../../judge/runner/shared/limits.js';

// The judge grades with the same runtimes the browser previews with (see
// judge/runner/shared/README.md). Versions installed separately on each side
// must stay identical, or a program could behave differently in the preview
// than in the grading.
const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const json = (path: string) => JSON.parse(read(path));

describe('browser ↔ judge runtime parity', () => {
  it('sucrase (TS type-stripping) is the same exact version', () => {
    const browser = json('package-lock.json').packages['node_modules/sucrase'].version;
    const judge = json('judge/runner/package-lock.json').packages['node_modules/sucrase'].version;
    expect(judge).toBe(browser);
    expect(json('judge/runner/package.json').dependencies.sucrase).toBe(browser);
  });

  it('Pyodide: the judge bundles the version the browser loads from the CDN', () => {
    expect(json('judge/runner/package.json').dependencies.pyodide).toBe(PYODIDE_VERSION);
    expect(json('judge/runner/package-lock.json').packages['node_modules/pyodide'].version).toBe(PYODIDE_VERSION);
    // pyRunner.ts derives its CDN URL from the same constant.
    expect(read('src/runner/pyRunner.ts')).toContain('/pyodide/v${PYODIDE_VERSION}/full/');
  });

  it('both sides take their limits and shared code from judge/runner/shared', () => {
    expect(RUN_TIME_LIMIT_MS).toEqual({ C: 10_000, JS: 10_000, TS: 10_000, PYTHON: 15_000 });
    expect(read('src/runner/cRunner.ts')).toContain("from '../../judge/runner/shared/limits.js'");
    expect(read('src/runner/js.worker.ts')).toContain("from '../../judge/runner/shared/jsHarness.js'");
    expect(read('src/runner/py.worker.ts')).toContain("from '../../judge/runner/shared/pyodideProgram.js'");
    expect(read('judge/runner/run.mjs')).toContain("from './shared/jsPrepare.js'");
    expect(read('judge/runner/pyWorker.mjs')).toContain("from './shared/pyodideProgram.js'");
  });
});
