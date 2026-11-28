/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  // Optional self-hosted pyodide dist (see src/runner/pyRunner.ts).
  readonly VITE_PYODIDE_BASE_URL?: string;
  // Optional campus/self-hosted WebLLM model weight mirror base URL (see src/ai/aiModelConfig.ts).
  readonly VITE_WEBLLM_MODEL_BASE_URL?: string;
  // Optional campus/self-hosted WebLLM wasm model_lib mirror base URL (see src/ai/aiModelConfig.ts).
  readonly VITE_WEBLLM_WASM_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
