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
  resolveWebLlmMirrorBases,
  rewriteWebLlmModelRecord,
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

describe('aiModelConfig campus mirror helpers', () => {
  const sampleRecord = {
    model: 'https://huggingface.co/mlc-ai/Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
    model_id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
    model_lib:
      'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2.5-Coder-3B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm',
    vram_required_MB: 2504.76,
    low_resource_required: true,
    required_features: ['shader-f16'],
  };

  it('returns null bases when env is omitted in plain Node or values are blank', () => {
    assert.deepEqual(resolveWebLlmMirrorBases(), {
      modelBaseUrl: null,
      wasmBaseUrl: null,
    });
    assert.deepEqual(
      resolveWebLlmMirrorBases({
        VITE_WEBLLM_MODEL_BASE_URL: '   ',
        VITE_WEBLLM_WASM_BASE_URL: '',
      }),
      {
        modelBaseUrl: null,
        wasmBaseUrl: null,
      },
    );
  });

  it('normalizes trailing slashes on configured mirror base URLs', () => {
    assert.deepEqual(
      resolveWebLlmMirrorBases({
        VITE_WEBLLM_MODEL_BASE_URL: 'https://mirror.example.ac.jp/webllm/models',
        VITE_WEBLLM_WASM_BASE_URL: 'https://mirror.example.ac.jp/webllm/wasm///',
      }),
      {
        modelBaseUrl: 'https://mirror.example.ac.jp/webllm/models/',
        wasmBaseUrl: 'https://mirror.example.ac.jp/webllm/wasm/',
      },
    );
    assert.deepEqual(
      resolveWebLlmMirrorBases({
        VITE_WEBLLM_MODEL_BASE_URL: ' /webllm/models/ ',
        VITE_WEBLLM_WASM_BASE_URL: '/webllm/wasm',
      }),
      {
        modelBaseUrl: '/webllm/models/',
        wasmBaseUrl: '/webllm/wasm/',
      },
    );
  });

  it('returns the original record unchanged when neither mirror base URL is set', () => {
    const result = rewriteWebLlmModelRecord(sampleRecord, {
      modelBaseUrl: null,
      wasmBaseUrl: null,
    });
    assert.equal(result, sampleRecord);
  });

  it('rewrites only model URL when only modelBaseUrl is configured', () => {
    const result = rewriteWebLlmModelRecord(sampleRecord, {
      modelBaseUrl: 'https://mirror.example.ac.jp/webllm/models',
      wasmBaseUrl: null,
    });
    assert.equal(
      result.model,
      'https://mirror.example.ac.jp/webllm/models/Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC/',
    );
    assert.equal(result.model_lib, sampleRecord.model_lib);
    assert.equal(result.model_id, sampleRecord.model_id);
    assert.equal(result.vram_required_MB, sampleRecord.vram_required_MB);
    assert.deepEqual(result.required_features, sampleRecord.required_features);
  });

  it('rewrites only model_lib URL when only wasmBaseUrl is configured', () => {
    const result = rewriteWebLlmModelRecord(sampleRecord, {
      modelBaseUrl: null,
      wasmBaseUrl: '/webllm/wasm/',
    });
    assert.equal(result.model, sampleRecord.model);
    assert.equal(
      result.model_lib,
      '/webllm/wasm/Qwen2.5-Coder-3B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm',
    );
    assert.equal(result.vram_required_MB, sampleRecord.vram_required_MB);
  });

  it('rewrites both model and model_lib and strips query/hash from model_lib basename', () => {
    const recordWithQuery = {
      ...sampleRecord,
      model_lib: `${sampleRecord.model_lib}?raw=1#v1`,
    };
    const bases = resolveWebLlmMirrorBases({
      VITE_WEBLLM_MODEL_BASE_URL: 'https://mirror.example.ac.jp/models/',
      VITE_WEBLLM_WASM_BASE_URL: 'https://mirror.example.ac.jp/wasm',
    });
    const result = rewriteWebLlmModelRecord(recordWithQuery, bases);
    assert.equal(
      result.model,
      'https://mirror.example.ac.jp/models/Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC/',
    );
    assert.equal(
      result.model_lib,
      'https://mirror.example.ac.jp/wasm/Qwen2.5-Coder-3B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm',
    );
    assert.equal(result.low_resource_required, true);
  });
});
