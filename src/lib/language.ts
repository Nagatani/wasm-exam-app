import type { Language } from '../types/exam';

export const ALL_LANGUAGES: Language[] = ['C', 'JAVA'];

// Languages a student can actually compile/run right now. A task may allow
// more than this (the teacher picks freely); the student UI only offers the
// intersection. Java joins this list in Increment 2 (server-side judge).
export const RUNNABLE_LANGUAGES: Language[] = ['C'];

export const LANGUAGE_LABEL: Record<Language, string> = {
  C: 'C言語',
  JAVA: 'Java',
};

// Monaco language id for the editor.
export const MONACO_LANGUAGE: Record<Language, 'c' | 'java'> = {
  C: 'c',
  JAVA: 'java',
};

// Filename shown above the editor / used as the compile unit name.
export const LANGUAGE_FILENAME: Record<Language, string> = {
  C: 'main.c',
  JAVA: 'Main.java',
};

export function isRunnable(language: Language): boolean {
  return RUNNABLE_LANGUAGES.includes(language);
}
