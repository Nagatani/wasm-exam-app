import { z } from 'zod';
import type { Language } from '@prisma/client';

// Every language the platform knows about at the schema level. Each task is
// answered in exactly one of these (task.language), chosen by the teacher.
export const LANGUAGES = [
  'C',
  'JAVA',
  'JS',
  'TS',
  'PYTHON',
] as const satisfies readonly Language[];

export const languageSchema = z.enum(LANGUAGES);

export function parseLanguageParam(raw: string): Language | null {
  const upper = raw.toUpperCase();
  return (LANGUAGES as readonly string[]).includes(upper) ? (upper as Language) : null;
}
