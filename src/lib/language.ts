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

// Skeleton starter code the task editor pre-fills when a teacher picks a
// language, so the "初期テンプレートコード" field is never blank. The I/O helpers
// referenced here match each runner: C reads real stdin; Java is a JEP 495
// compact source file (JDK 24 --enable-preview in the judge) with an instance
// main() and the auto-imported java.io.IO helpers; the JS/TS worker exposes
// readline()/print(); Python runs under a redirected sys.stdin so
// input()/print() work normally.
export const LANGUAGE_TEMPLATE: Record<Language, string> = {
  C: `#include <stdio.h>

int main(void) {
    // ここにコードを書く

    return 0;
}
`,
  JAVA: `// JEP 495: クラス宣言なしの簡易ソースファイル + インスタンス main
void main() {
    // IO.readln() で標準入力を1行読み、IO.println(...) で出力する
    String line = IO.readln();
    // ここにコードを書く

}
`,
  JS: `// readline() で標準入力を1行読み、print() で出力する
const input = readline();
// ここにコードを書く
`,
  TS: `// readline() で標準入力を1行読み、print() で出力する
const input: string = readline();
// ここにコードを書く
`,
  PYTHON: `# input() で標準入力を1行読み、print() で出力する
line = input()
# ここにコードを書く
`,
};

const TEMPLATE_VALUES = new Set(Object.values(LANGUAGE_TEMPLATE));

// True when `code` is blank or still one of the untouched per-language
// templates — i.e. it's safe to swap in a different language's template
// without discarding anything the teacher actually wrote.
export function isUntouchedTemplate(code: string): boolean {
  return code.trim() === '' || TEMPLATE_VALUES.has(code);
}
