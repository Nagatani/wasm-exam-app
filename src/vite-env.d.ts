/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  // Optional self-hosted pyodide dist (see src/runner/pyRunner.ts).
  readonly VITE_PYODIDE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
