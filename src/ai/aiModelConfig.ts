// Dependency-free WebLLM model tier configuration and localStorage persistence.
// Deliberately imports nothing from @mlc-ai/web-llm so it can be unit-tested
// in plain Node and safely referenced without affecting bundle splitting.

export type ModelTier = 'light' | 'standard' | 'high';

export interface ModelPreset {
  tier: ModelTier;
  label: string;
  description: string;
  approxSizeLabel: string;
  approxSizeBytes: number;
  f16ModelId: string;
  f32ModelId: string;
}

export const DEFAULT_MODEL_TIER: ModelTier = 'standard';

export const MODEL_TIER_STORAGE_KEY = 'wasm-exam-webllm-model-tier';
const MODEL_TIER_CHANGE_EVENT = 'wasm-exam-webllm-model-tier-changed';

const GIB = 1024 * 1024 * 1024;

export const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    tier: 'light',
    label: '軽量 (1.5B)',
    description: '省メモリ・高速（生徒用ノートPC向け）',
    approxSizeLabel: '約1.6GB',
    approxSizeBytes: Math.round(1.6 * GIB),
    f16ModelId: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
    f32ModelId: 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC',
  },
  {
    tier: 'standard',
    label: '標準 (3B)',
    description: '品質と軽さのバランス（既定）',
    approxSizeLabel: '約2.5GB',
    approxSizeBytes: Math.round(2.5 * GIB),
    f16ModelId: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
    f32ModelId: 'Qwen2.5-Coder-3B-Instruct-q4f32_1-MLC',
  },
  {
    tier: 'high',
    label: '高精度 (7B)',
    description: '高品質（講師PC・大容量VRAM向け）',
    approxSizeLabel: '約5.1GB',
    approxSizeBytes: Math.round(5.1 * GIB),
    f16ModelId: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC',
    f32ModelId: 'Qwen2.5-Coder-7B-Instruct-q4f32_1-MLC',
  },
] as const;

export function isModelTier(value: unknown): value is ModelTier {
  return value === 'light' || value === 'standard' || value === 'high';
}

export function getModelPreset(tier: ModelTier): ModelPreset {
  const preset = MODEL_PRESETS.find((p) => p.tier === tier);
  return preset ?? MODEL_PRESETS[1];
}

/**
 * Resolves the concrete WebLLM model ID for a preset tier. Automatically falls
 * back to the `q4f32_1` variant when the GPU adapter does not support
 * `shader-f16`.
 */
export function resolveModelId(tier: ModelTier, supportsShaderF16: boolean): string {
  const preset = getModelPreset(tier);
  return supportsShaderF16 ? preset.f16ModelId : preset.f32ModelId;
}

export function getPresetModelIds(tier: ModelTier): readonly [string, string] {
  const preset = getModelPreset(tier);
  return [preset.f16ModelId, preset.f32ModelId];
}

export function getAllPresetModelIds(): string[] {
  return MODEL_PRESETS.flatMap((p) => [p.f16ModelId, p.f32ModelId]);
}

export function getSelectedModelTier(): ModelTier {
  if (typeof localStorage === 'undefined') return DEFAULT_MODEL_TIER;
  try {
    const raw = localStorage.getItem(MODEL_TIER_STORAGE_KEY);
    return isModelTier(raw) ? raw : DEFAULT_MODEL_TIER;
  } catch {
    return DEFAULT_MODEL_TIER;
  }
}

export function setSelectedModelTier(tier: ModelTier): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MODEL_TIER_STORAGE_KEY, tier);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MODEL_TIER_CHANGE_EVENT));
  }
}

export function onModelTierChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(MODEL_TIER_CHANGE_EVENT, handler);
  return () => window.removeEventListener(MODEL_TIER_CHANGE_EVENT, handler);
}

export function formatByteSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `約${(mb / 1024).toFixed(1)}GB` : `約${Math.round(mb)}MB`;
}

export interface WebLlmMirrorEnv {
  readonly VITE_WEBLLM_MODEL_BASE_URL?: string;
  readonly VITE_WEBLLM_WASM_BASE_URL?: string;
}

export interface WebLlmMirrorBases {
  readonly modelBaseUrl: string | null;
  readonly wasmBaseUrl: string | null;
}

export interface WebLlmModelRecordLike {
  readonly model: string;
  readonly model_id: string;
  readonly model_lib: string;
}

function normalizeMirrorBaseUrl(configured: string | undefined | null): string | null {
  const url = (configured ?? '').trim();
  if (!url) return null;
  return `${url.replace(/\/+$/, '')}/`;
}

function extractUrlBasename(url: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? '';
  const trimmed = withoutQuery.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Resolves optional build-time campus/self-hosted mirror base URLs for WebLLM
 * model weights (`VITE_WEBLLM_MODEL_BASE_URL`) and compiled `.wasm` model
 * libraries (`VITE_WEBLLM_WASM_BASE_URL`). Normalizes non-empty values to end
 * with a single trailing slash. Safe to call in both Vite and plain Node tests.
 */
export function resolveWebLlmMirrorBases(env?: WebLlmMirrorEnv): WebLlmMirrorBases {
  const rawModel = env
    ? env.VITE_WEBLLM_MODEL_BASE_URL
    : import.meta.env
      ? import.meta.env.VITE_WEBLLM_MODEL_BASE_URL
      : undefined;
  const rawWasm = env
    ? env.VITE_WEBLLM_WASM_BASE_URL
    : import.meta.env
      ? import.meta.env.VITE_WEBLLM_WASM_BASE_URL
      : undefined;
  return {
    modelBaseUrl: normalizeMirrorBaseUrl(rawModel),
    wasmBaseUrl: normalizeMirrorBaseUrl(rawWasm),
  };
}

/**
 * Rewrites a WebLLM `ModelRecord`-shaped object to point at configured campus
 * mirror base URLs. Returns `record` unchanged when neither mirror base URL is
 * configured (keeping WebLLM's default Hugging Face / GitHub raw URLs).
 */
export function rewriteWebLlmModelRecord<T extends WebLlmModelRecordLike>(
  record: T,
  bases: WebLlmMirrorBases,
): T {
  const modelBase = normalizeMirrorBaseUrl(bases.modelBaseUrl);
  const wasmBase = normalizeMirrorBaseUrl(bases.wasmBaseUrl);
  if (!modelBase && !wasmBase) {
    return record;
  }

  const cleanModelId = record.model_id.replace(/^\/+|\/+$/g, '');
  const nextModel = modelBase ? `${modelBase}${cleanModelId}/` : record.model;

  let nextModelLib = record.model_lib;
  if (wasmBase) {
    const basename = extractUrlBasename(record.model_lib);
    if (basename) {
      nextModelLib = `${wasmBase}${basename}`;
    }
  }

  return {
    ...record,
    model: nextModel,
    model_lib: nextModelLib,
  };
}
