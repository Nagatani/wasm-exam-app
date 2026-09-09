import type { Language } from '../types/exam';

// Every language a teacher can assign to a task (task.language). The student
// answers in exactly that language — there is no student-side picker.
export const ALL_LANGUAGES: Language[] = ['C', 'JAVA', 'JS', 'TS', 'PYTHON'];

// Languages that can actually be compiled/run. If a task's language isn't here
// (e.g. its `judge` service is down / not configured), the student UI disables
// run+submit. C/JS/TS/Python run in the browser; Java is compiled and run
// server-side in the sandboxed judge container.
export const RUNNABLE_LANGUAGES: Language[] = ['C', 'JAVA', 'JS', 'TS', 'PYTHON'];

// Languages the browser cannot execute — the client sends source to the
// server, which compiles and runs it in the judge sandbox and returns the
// verdict directly. Everything else runs client-side and the client reports
// per-test outcomes.
export const SERVER_EXEC_LANGUAGES: Language[] = ['JAVA'];

export function isServerExec(language: Language): boolean {
  return SERVER_EXEC_LANGUAGES.includes(language);
}

export const LANGUAGE_LABEL: Record<Language, string> = {
  C: 'C言語',
  JAVA: 'Java',
  JS: 'JavaScript',
  TS: 'TypeScript',
  PYTHON: 'Python',
};

// Monaco language id for the editor.
export const MONACO_LANGUAGE: Record<Language, 'c' | 'java' | 'javascript' | 'typescript' | 'python'> =
  {
    C: 'c',
    JAVA: 'java',
    JS: 'javascript',
    TS: 'typescript',
    PYTHON: 'python',
  };

// Filename shown above the editor / used as the compile unit name.
export const LANGUAGE_FILENAME: Record<Language, string> = {
  C: 'main.c',
  JAVA: 'Main.java',
  JS: 'main.js',
  TS: 'main.ts',
  PYTHON: 'main.py',
};
