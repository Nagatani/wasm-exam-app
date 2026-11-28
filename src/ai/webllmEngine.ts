import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  prebuiltAppConfig,
  type InitProgressReport,
  type MLCEngineInterface,
} from '@mlc-ai/web-llm';

export const DEFAULT_WEBLLM_MODEL_ID = 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC';

// Automatically unload the engine after 5 minutes of inactivity so the browser
// does not hold multi-GB GPU VRAM indefinitely after a single generation.
const IDLE_UNLOAD_MS = 5 * 60 * 1000;

export type WebLlmEngineState = 'idle' | 'loading' | 'ready' | 'error';

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

// The model record's own `vram_required_MB` as a rough stand-in for the
// download size to expect — WebLLM doesn't separately expose "bytes on the
// wire", and VRAM footprint of a q4-quantized model tracks its on-disk/cache
// size closely enough for a "about how big" caption.
export function getWebLlmModelSizeLabel(modelId: string = DEFAULT_WEBLLM_MODEL_ID): string {
  const record = prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
  if (!record?.vram_required_MB) return '数GB程度';
  return `約${(record.vram_required_MB / 1024).toFixed(1)}GB`;
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
 * a dedicated ES module worker. Never called automatically: only features the
 * user explicitly opted into (see aiAssistSettings.ts / aiHintSettings.ts)
 * should trigger this.
 */
export function loadWebLlmEngine(
  onProgress?: (report: InitProgressReport) => void,
  modelId: string = DEFAULT_WEBLLM_MODEL_ID,
): Promise<MLCEngineInterface> {
  ensureLifecycleHook();

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

  if (!isWebGpuSupported()) {
    state = 'error';
    return Promise.reject(new Error('このブラウザはAI機能（WebGPU）に対応していません。'));
  }

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
 * Unloads the live engine and deletes all cached WebLLM entries (weights,
 * wasm, tokenizer/config) for the specified model.
 */
export async function clearWebLlmModelCache(
  modelId: string = DEFAULT_WEBLLM_MODEL_ID,
): Promise<void> {
  if (loadedModelId === modelId || enginePromise) {
    await unloadWebLlmEngine();
  }
  await deleteModelAllInfoInCache(modelId);
}
