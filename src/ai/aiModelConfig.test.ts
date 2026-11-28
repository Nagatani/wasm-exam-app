import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MODEL_TIER,
  formatByteSize,
  getAllPresetModelIds,
  getModelPreset,
  getSelectedModelTier,
  isModelTier,
  MODEL_PRESETS,
  MODEL_TIER_STORAGE_KEY,
  resolveModelId,
  setSelectedModelTier,
  type ModelTier,
} from './aiModelConfig.ts';

describe('aiModelConfig presets', () => {
  it('defines light (1.5B), standard (3B default), and high (7B) presets', () => {
    assert.equal(DEFAULT_MODEL_TIER, 'standard');
    assert.deepEqual(
      MODEL_PRESETS.map((p) => p.tier),
      ['light', 'standard', 'high'],
    );
    assert.equal(getModelPreset('light').f16ModelId, 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC');
    assert.equal(getModelPreset('standard').f16ModelId, 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC');
    assert.equal(getModelPreset('high').f16ModelId, 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC');
  });

  it('resolves q4f16_1 when shader-f16 is supported', () => {
    const expected: Record<ModelTier, string> = {
      light: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
      standard: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
      high: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC',
    };
    for (const [tier, modelId] of Object.entries(expected) as [ModelTier, string][]) {
      assert.equal(resolveModelId(tier, true), modelId);
    }
  });

  it('falls back to q4f32_1 when shader-f16 is NOT supported', () => {
    const expected: Record<ModelTier, string> = {
      light: 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC',
      standard: 'Qwen2.5-Coder-3B-Instruct-q4f32_1-MLC',
      high: 'Qwen2.5-Coder-7B-Instruct-q4f32_1-MLC',
    };
    for (const [tier, modelId] of Object.entries(expected) as [ModelTier, string][]) {
      assert.equal(resolveModelId(tier, false), modelId);
    }
  });

  it('lists all 6 preset model IDs (f16 and f32 for each tier)', () => {
    const allIds = getAllPresetModelIds();
    assert.equal(allIds.length, 6);
    assert.equal(new Set(allIds).size, 6);
    assert.ok(allIds.includes('Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC'));
    assert.ok(allIds.includes('Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC'));
    assert.ok(allIds.includes('Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC'));
    assert.ok(allIds.includes('Qwen2.5-Coder-3B-Instruct-q4f32_1-MLC'));
    assert.ok(allIds.includes('Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC'));
    assert.ok(allIds.includes('Qwen2.5-Coder-7B-Instruct-q4f32_1-MLC'));
  });

  it('validates ModelTier values with isModelTier', () => {
    assert.equal(isModelTier('light'), true);
    assert.equal(isModelTier('standard'), true);
    assert.equal(isModelTier('high'), true);
    assert.equal(isModelTier('ultra'), false);
    assert.equal(isModelTier(null), false);
    assert.equal(isModelTier(undefined), false);
    assert.equal(isModelTier(3), false);
  });

  it('formats byte sizes in MB and GB', () => {
    assert.equal(formatByteSize(512 * 1024 * 1024), '約512MB');
    assert.equal(formatByteSize(2.5 * 1024 * 1024 * 1024), '約2.5GB');
  });
});

describe('aiModelConfig localStorage persistence', () => {
  it('defaults to standard when localStorage is unavailable or invalid', () => {
    const originalStorage = globalThis.localStorage;
    try {
      // Simulate plain Node without localStorage
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      assert.equal(getSelectedModelTier(), 'standard');

      const backing = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => {
          backing.set(k, v);
        },
      };
      Object.defineProperty(globalThis, 'localStorage', {
        value: mockStorage,
        configurable: true,
        writable: true,
      });

      assert.equal(getSelectedModelTier(), 'standard');

      backing.set(MODEL_TIER_STORAGE_KEY, 'invalid-tier');
      assert.equal(getSelectedModelTier(), 'standard');

      setSelectedModelTier('high');
      assert.equal(backing.get(MODEL_TIER_STORAGE_KEY), 'high');
      assert.equal(getSelectedModelTier(), 'high');

      setSelectedModelTier('light');
      assert.equal(getSelectedModelTier(), 'light');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalStorage,
        configurable: true,
        writable: true,
      });
    }
  });
});
