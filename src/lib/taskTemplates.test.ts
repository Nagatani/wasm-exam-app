import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALL_LANGUAGES } from './language.ts';
import { getTaskTemplateById, TASK_TEMPLATES } from './taskTemplates.ts';

const REQUIRED_SECTIONS = ['【問題】', '【入力形式】', '【出力形式】', '【制約】'];
const VALID_COMPARISON_MODES = new Set([
  'EXACT',
  'TRIM_TRAILING_WS',
  'IGNORE_BLANK_LINES',
  'FLOAT',
  'IGNORE_CASE',
]);

describe('taskTemplates', () => {
  it('provides 5 intro CS templates with unique ids', () => {
    assert.equal(TASK_TEMPLATES.length, 5);
    const ids = new Set(TASK_TEMPLATES.map((t) => t.id));
    assert.equal(ids.size, TASK_TEMPLATES.length);
  });

  it('every template has valid non-empty metadata and required statement sections', () => {
    for (const tpl of TASK_TEMPLATES) {
      assert.ok(tpl.id.trim().length > 0, 'id must be non-empty');
      assert.ok(tpl.name.trim().length > 0, `${tpl.id}: name must be non-empty`);
      assert.ok(tpl.description.trim().length > 0, `${tpl.id}: description must be non-empty`);
      assert.ok(
        VALID_COMPARISON_MODES.has(tpl.comparisonMode),
        `${tpl.id}: invalid comparisonMode ${tpl.comparisonMode}`,
      );
      for (const heading of REQUIRED_SECTIONS) {
        assert.ok(
          tpl.statementMarkdown.includes(heading),
          `${tpl.id}: statementMarkdown missing ${heading}`,
        );
      }
    }
  });

  it('every template provides non-empty starter code for all 5 languages', () => {
    for (const tpl of TASK_TEMPLATES) {
      for (const lang of ALL_LANGUAGES) {
        const code = tpl.starterCodeByLanguage[lang];
        assert.equal(typeof code, 'string', `${tpl.id}: missing starter code for ${lang}`);
        assert.ok(code.trim().length > 0, `${tpl.id}: empty starter code for ${lang}`);
      }
    }
  });

  it('every template provides sample and boundary test case skeletons', () => {
    for (const tpl of TASK_TEMPLATES) {
      assert.ok(tpl.sampleCases.length >= 2, `${tpl.id}: should have at least 2 test cases`);
      assert.ok(
        tpl.sampleCases.some((c) => c.isSample),
        `${tpl.id}: should include at least 1 sample test case`,
      );
      for (const tc of tpl.sampleCases) {
        assert.ok(tc.input.trim().length > 0, `${tpl.id}: test case input must be non-empty`);
        assert.equal(typeof tc.expectedOutput, 'string');
        assert.equal(typeof tc.isSample, 'boolean');
      }
    }
  });

  it('includes a floating-point template configured with FLOAT comparison mode', () => {
    const floatTpl = getTaskTemplateById('float-calc');
    assert.ok(floatTpl);
    assert.equal(floatTpl.comparisonMode, 'FLOAT');
    assert.ok(typeof floatTpl.floatTolerance === 'number' && floatTpl.floatTolerance > 0);
  });
});
