// Executes ONE prepared JavaScript program against ONE stdin, in an isolated
// Web Worker. The caller (jsRunner.ts) spins up a fresh worker per test case
// and terminate()s it on timeout, so an infinite loop here can't freeze the
// page. The program itself runs through the harness shared with the judge
// (judge/runner/shared/jsHarness.js) — same stdin helpers and output
// formatting on both sides.
import { runJsProgram } from '../../judge/runner/shared/jsHarness.js';

self.onmessage = (e: MessageEvent<{ code: string; stdin: string }>) => {
  const { code, stdin } = e.data;
  self.postMessage(runJsProgram(code, stdin));
};
