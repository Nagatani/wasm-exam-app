import type { Language } from '../types/exam';
import type { JudgeOutcome } from '../types/student';
import { compileC, prewarmCRunner, runCompiledC } from './cRunner';
import { prepareJs, runJsOnce } from './jsRunner';
import { preparePy, prewarmPyRunner, runPyOnce } from './pyRunner';

// One entry point for every browser-executed language (C, JS, TS, Python).
// Java is server-executed and never comes through here. The shape it returns
// is exactly what the student flow feeds to the server's judge:
// { compileFailed, compileStderr, outcomes[] } — a self-declared verdict is
// never produced here.

export type ClientProgress =
  | { phase: 'compiling' }
  | { phase: 'running'; current: number; total: number };

export interface ClientExecResult {
  compileFailed: boolean;
  compileStderr: string;
  outcomes: JudgeOutcome[];
}

interface RunnableTestCase {
  id: string;
  input: string;
}

export function prewarmClientRunner(language: Language): void {
  if (language === 'C') prewarmCRunner();
  else if (language === 'PYTHON') prewarmPyRunner();
  // JS/TS need no warm-up; Java isn't client-side.
}

export async function runClientSide(
  language: Language,
  source: string,
  testCases: RunnableTestCase[],
  onProgress: (progress: ClientProgress) => void,
): Promise<ClientExecResult> {
  onProgress({ phase: 'compiling' });
  const total = testCases.length;
  const outcomes: JudgeOutcome[] = [];
  const record = (id: string, ok: boolean, stdout: string) => {
    outcomes.push({ testCaseId: id, stage: ok ? 'success' : 'runtime_error', stdout });
  };

  if (language === 'C') {
    const compiled = await compileC(source);
    if (!compiled.ok || !compiled.wasmBinary) {
      return { compileFailed: true, compileStderr: compiled.stderr, outcomes: [] };
    }
    for (const [index, tc] of testCases.entries()) {
      onProgress({ phase: 'running', current: index + 1, total });
      const result = await runCompiledC(compiled.wasmBinary, tc.input);
      record(tc.id, result.ok, result.stdout);
    }
    return { compileFailed: false, compileStderr: '', outcomes };
  }

  if (language === 'JS' || language === 'TS') {
    const prepared = prepareJs(source, language);
    if (!prepared.ok) {
      return { compileFailed: true, compileStderr: prepared.error, outcomes: [] };
    }
    for (const [index, tc] of testCases.entries()) {
      onProgress({ phase: 'running', current: index + 1, total });
      const result = await runJsOnce(prepared.js, tc.input);
      record(tc.id, result.ok && !result.timedOut, result.stdout);
    }
    return { compileFailed: false, compileStderr: '', outcomes };
  }

  if (language === 'PYTHON') {
    const prepared = await preparePy(source);
    if (!prepared.ok) {
      return { compileFailed: true, compileStderr: prepared.error, outcomes: [] };
    }
    for (const [index, tc] of testCases.entries()) {
      onProgress({ phase: 'running', current: index + 1, total });
      const result = await runPyOnce(source, tc.input);
      record(tc.id, result.ok && !result.timedOut, result.stdout);
    }
    return { compileFailed: false, compileStderr: '', outcomes };
  }

  throw new Error(`runClientSide: ${language} is not a client-side language`);
}
