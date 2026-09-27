// Build-time step (judge/Dockerfile): load Pyodide once and save a memory
// snapshot of the freshly initialised interpreter. pyWorker.mjs restores each
// new interpreter from it (~50ms) instead of booting Pyodide from scratch
// (~1.1s) — the snapshot is taken before any student code has run, so every
// submission still starts from a pristine interpreter, exactly like a fresh
// load in the browser (no state can leak between students).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadPyodide } from 'pyodide';

const indexURL = path.dirname(createRequire(import.meta.url).resolve('pyodide/package.json')) + path.sep;
const out = process.argv[2] ?? new URL('./pyodide-snapshot.bin', import.meta.url);
const py = await loadPyodide({ indexURL, _makeSnapshot: true });
const snapshot = py.makeMemorySnapshot();
writeFileSync(out, snapshot);
console.log(`pyodide snapshot: ${(snapshot.byteLength / 1e6).toFixed(1)} MB → ${out}`);
