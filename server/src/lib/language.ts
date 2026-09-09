import { z } from 'zod';
import type { Language } from '@prisma/client';

// Every language the platform knows about at the schema level. Note this is
// not the same as "languages a student can currently run" — the student UI
// intersects a task's allowedLanguages with what the runner actually
// supports (Increment 1: C only; Java lands in Increment 2).
export const LANGUAGES = ['C', 'JAVA'] as const satisfies readonly Language[];

export const languageSchema = z.enum(LANGUAGES);

export function parseLanguageParam(raw: string): Language | null {
  const upper = raw.toUpperCase();
  return (LANGUAGES as readonly string[]).includes(upper) ? (upper as Language) : null;
}
