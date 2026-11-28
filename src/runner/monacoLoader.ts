const MONACO_VERSION = '0.55.1';
const MONACO_VS_URL = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;
const MONACO_LOADER_URL = `${MONACO_VS_URL}/loader.js`;

export interface MonacoDisposable {
  dispose(): void;
}

export interface MonacoRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface MonacoTextModel {
  getValue(): string;
  setValue(newValue: string): void;
  getValueInRange(range: MonacoRange): string;
  dispose(): void;
}

export interface MonacoMarkerData {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number;
}

export interface MonacoThemeRule {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

export interface MonacoThemeData {
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  inherit: boolean;
  rules: MonacoThemeRule[];
  colors: Record<string, string>;
}

export interface MonacoEditorOptions {
  fontSize?: number;
  minimap?: { enabled: boolean };
  scrollBeyondLastLine?: boolean;
  automaticLayout?: boolean;
  readOnly?: boolean;
  ariaLabel?: string;
  accessibilitySupport?: 'auto' | 'off' | 'on';
}

export interface MonacoCreateOptions extends MonacoEditorOptions {
  value?: string;
  language?: string;
  theme?: string;
}

export interface MonacoActionDescriptor {
  id: string;
  label: string;
  keybindings?: number[];
  run: (editor: MonacoStandaloneEditor) => void | Promise<void>;
}

export interface MonacoStandaloneEditor {
  getValue(): string;
  setValue(newValue: string): void;
  getModel(): MonacoTextModel | null;
  updateOptions(newOptions: MonacoEditorOptions): void;
  onDidChangeModelContent(listener: () => void): MonacoDisposable;
  onKeyDown(listener: (e: { keyCode: number }) => void): MonacoDisposable;
  onDidPaste(listener: (e: { range: MonacoRange }) => void): MonacoDisposable;
  addAction(descriptor: MonacoActionDescriptor): MonacoDisposable;
  dispose(): void;
}

export interface Monaco {
  editor: {
    create(domElement: HTMLElement, options?: MonacoCreateOptions): MonacoStandaloneEditor;
    defineTheme(themeName: string, themeData: MonacoThemeData): void;
    setTheme(themeName: string): void;
    setModelLanguage(model: MonacoTextModel, languageId: string): void;
    setModelMarkers(model: MonacoTextModel, owner: string, markers: MonacoMarkerData[]): void;
    getModels(): MonacoTextModel[];
  };
  KeyCode: {
    Ctrl: number;
    Shift: number;
    Alt: number;
    Meta: number;
    CapsLock: number;
    Enter: number;
    KeyS: number;
  };
  KeyMod: {
    CtrlCmd: number;
  };
  MarkerSeverity: {
    Error: number;
    Warning: number;
  };
}

interface AmdRequire {
  (
    deps: string[],
    onLoad: (...modules: unknown[]) => void,
    onError?: (err: unknown) => void,
  ): void;
  config(cfg: { paths: Record<string, string> }): void;
}

interface WindowWithMonaco extends Window {
  monaco?: Monaco;
  require?: AmdRequire;
}

let monacoPromise: Promise<Monaco> | null = null;

export function loadMonaco(): Promise<Monaco> {
  const win = window as unknown as WindowWithMonaco;
  if (win.monaco) {
    return Promise.resolve(win.monaco);
  }
  if (monacoPromise) {
    return monacoPromise;
  }

  monacoPromise = new Promise<Monaco>((resolve, reject) => {
    const requireEditorMain = () => {
      const amdRequire = win.require;
      if (!amdRequire || typeof amdRequire.config !== 'function') {
        reject(new Error('Monaco AMD loader failed to initialize'));
        return;
      }
      amdRequire.config({ paths: { vs: MONACO_VS_URL } });
      amdRequire(
        ['vs/editor/editor.main'],
        () => {
          if (win.monaco) {
            resolve(win.monaco);
          } else {
            reject(new Error('Monaco editor loaded but window.monaco is undefined'));
          }
        },
        (err) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    };

    if (win.require && typeof win.require.config === 'function') {
      requireEditorMain();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${MONACO_LOADER_URL}"]`,
    );
    if (existing) {
      existing.addEventListener('load', requireEditorMain, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Monaco AMD loader script')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = MONACO_LOADER_URL;
    script.async = true;
    script.onload = requireEditorMain;
    script.onerror = () => reject(new Error('Failed to load Monaco AMD loader script'));
    document.head.appendChild(script);
  }).catch((err) => {
    monacoPromise = null;
    throw err;
  });

  return monacoPromise;
}
