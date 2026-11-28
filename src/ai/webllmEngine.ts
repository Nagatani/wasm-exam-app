import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  hasModelInCache,
  prebuiltAppConfig,
  type InitProgressReport,
  type MLCEngineInterface,
} from '@mlc-ai/web-llm';
import {
  DEFAULT_MODEL_TIER,
  getAllPresetModelIds,
  getModelPreset,
  getPresetModelIds,
  getSelectedModelTier,
  MODEL_PRESETS,
  resolveModelId,
  type ModelTier,
} from './aiModelConfig';

export const DEFAULT_WEBLLM_MODEL_ID = resolveModelId(DEFAULT_MODEL_TIER, true);

// Automatically unload the engine after 5 minutes of inactivity so the browser
// does not hold multi-GB GPU VRAM indefinitely after a single generation.
const IDLE_UNLOAD_MS = 5 * 60 * 1000;

export type WebLlmEngineState = 'idle' | 'loading' | 'ready' | 'error';

// Minimal structural types for WebGPU APIs (tsconfig lib is ES2023 + DOM,
// which does not include @webgpu/types).
interface WebGpuAdapterLike {
  readonly features: { has(feature: string): boolean };
  readonly limits: { readonly maxStorageBufferBindingSize?: number };
}

interface WebGpuLike {
  requestAdapter(): Promise<WebGpuAdapterLike | null>;
}

interface NavigatorWithGpu {
  readonly gpu?: WebGpuLike;
}

export interface WebGpuDiagnostics {
  hasNavigatorGpu: boolean;
  hasAdapter: boolean;
  supportsShaderF16: boolean;
  maxStorageBufferBindingSize: number | null;
  storageUsageBytes: number | null;
  storageQuotaBytes: number | null;
  storageAvailableBytes: number | null;
  selectedTier: ModelTier;
  resolvedModelId: string;
  cachedByTier: Record<ModelTier, boolean>;
  cachedModelIds: string[];
}

export class GenerationAbortedError extends Error {
  constructor(message = '生成を中断しました。') {
    super(message);
    this.name = 'GenerationAbortedError';
  }
}

export function isGenerationAbortedError(err: unknown): err is GenerationAbortedError {
  return err instanceof GenerationAbortedError;
}

export function isWebGpuSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function requestWebGpuAdapter(): Promise<WebGpuAdapterLike | null> {
  if (typeof navigator === 'undefined') return null;
  const gpu = (navigator as NavigatorWithGpu).gpu;
  if (!gpu?.requestAdapter) return null;
  try {
    return await gpu.requestAdapter();
  } catch {
    return null;
  }
}

let shaderF16Promise: Promise<boolean> | null = null;

export function detectShaderF16Support(): Promise<boolean> {
  if (!shaderF16Promise) {
    shaderF16Promise = requestWebGpuAdapter().then((adapter) =>
      adapter ? adapter.features.has('shader-f16') : false,
    );
  }
  return shaderF16Promise;
}

export async function resolveActiveModelId(tier?: ModelTier): Promise<string> {
  const selectedTier = tier ?? getSelectedModelTier();
  const supportsF16 = await detectShaderF16Support();
  return resolveModelId(selectedTier, supportsF16);
}

// The model record's own `vram_required_MB` as a rough stand-in for the
// download size to expect — WebLLM doesn't separately expose "bytes on the
// wire", and VRAM footprint of a q4-quantized model tracks its on-disk/cache
// size closely enough for a "about how big" caption.
export function getWebLlmModelSizeLabel(modelId?: string): string {
  const targetId = modelId ?? resolveModelId(getSelectedModelTier(), true);
  const record = prebuiltAppConfig.model_list.find((m) => m.model_id === targetId);
  if (record?.vram_required_MB) {
    return `約${(record.vram_required_MB / 1024).toFixed(1)}GB`;
  }
  return getModelPreset(getSelectedModelTier()).approxSizeLabel;
}

// navigator.storage.estimate() is a browser-wide figure (every origin's
// cached data, not just this model), but it's the only thing the platform
// exposes without hand-rolling a Cache/IndexedDB walk — good enough for a
// "here's roughly how much this browser is using" caption. `null` when the
// API isn't available (e.g. private browsing in some browsers).
export async function estimateStorageUsageBytes(): Promise<number | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage } = await navigator.storage.estimate();
  return usage ?? null;
}

async function safeHasModelInCache(modelId: string): Promise<boolean> {
  try {
    return await hasModelInCache(modelId);
  } catch {
    return false;
  }
}

/**
 * Inspects WebGPU adapter capabilities (`shader-f16`,
 * `maxStorageBufferBindingSize`), browser storage quota/usage, and which
 * preset models are currently cached via WebLLM's `hasModelInCache()`.
 */
export async function diagnoseWebGpu(tier?: ModelTier): Promise<WebGpuDiagnostics> {
  const hasNavigatorGpu = isWebGpuSupported();
  const adapter = hasNavigatorGpu ? await requestWebGpuAdapter() : null;
  const hasAdapter = adapter !== null;
  const supportsShaderF16 = adapter ? adapter.features.has('shader-f16') : false;
  const maxStorageBufferBindingSize =
    adapter && typeof adapter.limits.maxStorageBufferBindingSize === 'number'
      ? adapter.limits.maxStorageBufferBindingSize
      : null;

  let storageUsageBytes: number | null = null;
  let storageQuotaBytes: number | null = null;
  let storageAvailableBytes: number | null = null;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      storageUsageBytes = estimate.usage ?? null;
      storageQuotaBytes = estimate.quota ?? null;
      if (storageQuotaBytes !== null && storageUsageBytes !== null) {
        storageAvailableBytes = Math.max(0, storageQuotaBytes - storageUsageBytes);
      }
    } catch {
      /* storage estimate unavailable (e.g. restricted browsing context) */
    }
  }

  const selectedTier = tier ?? getSelectedModelTier();
  const resolvedModelId = resolveModelId(selectedTier, supportsShaderF16);

  const allIds = getAllPresetModelIds();
  const cacheChecks = await Promise.all(
    allIds.map(async (id) => ({ id, cached: await safeHasModelInCache(id) })),
  );
  const cachedSet = new Set(cacheChecks.filter((c) => c.cached).map((c) => c.id));
  const cachedModelIds = [...cachedSet];

  const cachedByTier: Record<ModelTier, boolean> = {
    light: false,
    standard: false,
    high: false,
  };
  for (const preset of MODEL_PRESETS) {
    cachedByTier[preset.tier] =
      cachedSet.has(preset.f16ModelId) || cachedSet.has(preset.f32ModelId);
  }

  return {
    hasNavigatorGpu,
    hasAdapter,
    supportsShaderF16,
    maxStorageBufferBindingSize,
    storageUsageBytes,
    storageQuotaBytes,
    storageAvailableBytes,
    selectedTier,
    resolvedModelId,
    cachedByTier,
    cachedModelIds,
  };
}

let state: WebLlmEngineState = 'idle';
let enginePromise: Promise<MLCEngineInterface> | null = null;
let loadedEngine: MLCEngineInterface | null = null;
let loadedModelId: string | null = null;
let activeWorker: Worker | null = null;
let activeGenerations = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleHookInstalled = false;

const progressListeners = new Set<(report: InitProgressReport) => void>();

export function getWebLlmState(): WebLlmEngineState {
  return state;
}

export function getLoadedModelId(): string | null {
  return loadedModelId;
}

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleUnload(): void {
  clearIdleTimer();
  if (activeGenerations > 0 || !loadedEngine) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (activeGenerations === 0 && loadedEngine) {
      void unloadWebLlmEngine();
    }
  }, IDLE_UNLOAD_MS);
}

function ensureLifecycleHook(): void {
  if (lifecycleHookInstalled || typeof window === 'undefined') return;
  lifecycleHookInstalled = true;
  window.addEventListener('pagehide', () => {
    void unloadWebLlmEngine();
  });
}

const LOAD_FAILURE_MESSAGE =
  'AIモデルの読み込みに失敗しました。ネットワーク環境を確認するか、しばらくしてから再度お試しください。';

/**
 * Downloads (first call only — memoized) and initializes the WebLLM engine in
 * a dedicated ES module worker. When `explicitModelId` is omitted, uses the
 * user's selected tier from `localStorage` and automatically falls back to
 * `q4f32_1` if the GPU adapter lacks `shader-f16`.
 */
export async function loadWebLlmEngine(
  onProgress?: (report: InitProgressReport) => void,
  explicitModelId?: string,
): Promise<MLCEngineInterface> {
  ensureLifecycleHook();

  if (!isWebGpuSupported()) {
    state = 'error';
    throw new Error('このブラウザはAI機能（WebGPU）に対応していません。');
  }

  const modelId = explicitModelId ?? (await resolveActiveModelId());

  if (enginePromise && loadedModelId === modelId) {
    if (onProgress) {
      progressListeners.add(onProgress);
      void enginePromise.finally(() => {
        progressListeners.delete(onProgress);
      });
    }
    return enginePromise;
  }

  // If a different model was previously loaded, unload it before loading the new one.
  const unloadFirst = enginePromise ? unloadWebLlmEngine() : Promise.resolve();

  if (onProgress) {
    progressListeners.add(onProgress);
  }

  state = 'loading';
  loadedModelId = modelId;
  clearIdleTimer();

  const promise = unloadFirst
    .then(() => {
      const worker = new Worker(new URL('./aiAssist.worker.ts', import.meta.url), {
        type: 'module',
      });
      activeWorker = worker;
      return CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (report) => {
          for (const listener of progressListeners) {
            listener(report);
          }
        },
      });
    })
    .then(
      (engine) => {
        loadedEngine = engine;
        state = 'ready';
        scheduleIdleUnload();
        return engine;
      },
      (err) => {
        state = 'error';
        enginePromise = null;
        loadedEngine = null;
        loadedModelId = null;
        activeWorker?.terminate();
        activeWorker = null;
        console.error('WebLLM model load failed:', err);
        throw new Error(LOAD_FAILURE_MESSAGE);
      },
    )
    .finally(() => {
      if (onProgress) {
        progressListeners.delete(onProgress);
      }
    });

  enginePromise = promise;
  return promise;
}

/**
 * Marks the start of an active inference call so the idle timeout will not
 * unload the engine mid-generation. Always pair with `endWebLlmGeneration()`.
 */
export function beginWebLlmGeneration(): void {
  activeGenerations += 1;
  clearIdleTimer();
}

/**
 * Marks the end of an active inference call and restarts the idle unload timer.
 */
export function endWebLlmGeneration(): void {
  activeGenerations = Math.max(0, activeGenerations - 1);
  if (activeGenerations === 0) {
    scheduleIdleUnload();
  }
}

/**
 * Requests the active WebLLM engine to abort any in-flight generation.
 */
export function interruptGenerate(): void {
  loadedEngine?.interruptGenerate();
}

/**
 * Unloads the live engine (if any) and terminates its worker to free VRAM.
 * Keeps cached model files intact so subsequent loads are fast.
 */
export async function unloadWebLlmEngine(): Promise<void> {
  clearIdleTimer();
  const pending = enginePromise;
  const worker = activeWorker;
  enginePromise = null;
  loadedEngine = null;
  loadedModelId = null;
  activeWorker = null;
  state = 'idle';

  if (pending) {
    try {
      const engine = await pending;
      await engine.unload();
    } catch {
      /* engine may have failed to load in the first place — ignore */
    }
  }
  worker?.terminate();
}

/**
 * Unloads the live engine if it matches and deletes cached WebLLM entries for
 * the specified model ID.
 */
export async function clearWebLlmModelCache(
  modelId: string = DEFAULT_WEBLLM_MODEL_ID,
): Promise<void> {
  if (loadedModelId === modelId || enginePromise) {
    await unloadWebLlmEngine();
  }
  await deleteModelAllInfoInCache(modelId);
}

/**
 * Deletes both `q4f16_1` and `q4f32_1` cache entries for a single preset tier.
 */
export async function clearTierModelCache(tier: ModelTier): Promise<void> {
  const ids = getPresetModelIds(tier);
  if (loadedModelId && ids.includes(loadedModelId)) {
    await unloadWebLlmEngine();
  }
  for (const id of ids) {
    try {
      await deleteModelAllInfoInCache(id);
    } catch {
      /* ignore missing cache entries */
    }
  }
}

/**
 * Unloads any live engine and deletes cached entries for all preset tiers.
 */
export async function clearAllPresetModelCaches(): Promise<void> {
  await unloadWebLlmEngine();
  for (const id of getAllPresetModelIds()) {
    try {
      await deleteModelAllInfoInCache(id);
    } catch {
      /* ignore missing cache entries */
    }
  }
}
