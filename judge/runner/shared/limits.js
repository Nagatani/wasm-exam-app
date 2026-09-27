// Per-test-case limits for the languages that run in the browser for the
// preview AND on the judge for grading — identical on both sides so a program
// can't pass one and time out on the other.
export const RUN_TIME_LIMIT_MS = { C: 10_000, JS: 10_000, TS: 10_000, PYTHON: 15_000 };

// Linear-memory cap for compiled C (wasm32-wasi), passed to the linker.
export const C_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

// clang arguments (besides input/output) used for C in both places.
export const C_COMPILE_FLAGS = [`-Wl,--max-memory=${C_MEMORY_LIMIT_BYTES}`];

// Pyodide release the browser loads from the CDN and the judge bundles.
export const PYODIDE_VERSION = '0.28.0';
