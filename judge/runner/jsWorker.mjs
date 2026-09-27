// Node worker thread for ONE JS test case — the judge-side counterpart of
// src/runner/js.worker.ts. Same shared harness; run.mjs terminates this
// worker on timeout.
import { parentPort, workerData } from 'node:worker_threads';
import { runJsProgram } from './shared/jsHarness.js';

parentPort.postMessage(runJsProgram(workerData.code, workerData.stdin));
