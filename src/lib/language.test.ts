import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALL_LANGUAGES, isServerExec, isUntouchedTemplate, LANGUAGE_TEMPLATE } from './language.ts';

describe('language metadata', () => {
  it('only Java executes server-side (mirrors server/src/lib/attempts.ts)', () => {
    assert.deepEqual(ALL_LANGUAGES.filter(isServerExec), ['JAVA']);
  });

  it('every language has a starter template', () => {
    for (const lang of ALL_LANGUAGES) assert.ok(LANGUAGE_TEMPLATE[lang].length > 0);
  });

  it('isUntouchedTemplate: blank or an unedited template only', () => {
    assert.equal(isUntouchedTemplate(''), true);
    assert.equal(isUntouchedTemplate('  \n'), true);
    for (const lang of ALL_LANGUAGES) assert.equal(isUntouchedTemplate(LANGUAGE_TEMPLATE[lang]), true);
    assert.equal(isUntouchedTemplate(LANGUAGE_TEMPLATE.C + '// edited'), false);
    assert.equal(isUntouchedTemplate('print(1)'), false);
  });
});
