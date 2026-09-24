import { describe, expect, it } from 'vitest'
import { ALL_LANGUAGES, isServerExec, isUntouchedTemplate, LANGUAGE_TEMPLATE } from './language'

describe('language metadata', () => {
  it('only Java executes server-side (mirrors server/src/lib/attempts.ts)', () => {
    expect(ALL_LANGUAGES.filter(isServerExec)).toEqual(['JAVA'])
  })

  it('every language has a starter template', () => {
    for (const lang of ALL_LANGUAGES) expect(LANGUAGE_TEMPLATE[lang].length).toBeGreaterThan(0)
  })

  it('isUntouchedTemplate: blank or an unedited template only', () => {
    expect(isUntouchedTemplate('')).toBe(true)
    expect(isUntouchedTemplate('  \n')).toBe(true)
    for (const lang of ALL_LANGUAGES) expect(isUntouchedTemplate(LANGUAGE_TEMPLATE[lang])).toBe(true)
    expect(isUntouchedTemplate(LANGUAGE_TEMPLATE.C + '// edited')).toBe(false)
    expect(isUntouchedTemplate('print(1)')).toBe(false)
  })
})
