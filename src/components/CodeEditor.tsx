import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from '../contexts/useTheme';
import {
  loadMonaco,
  type Monaco,
  type MonacoDisposable,
  type MonacoStandaloneEditor,
} from '../runner/monacoLoader';
import {
  MONACO_DARK_THEME_NAME,
  MONACO_LIGHT_THEME_NAME,
  ensureMonokaiProThemes,
} from '../runner/monacoThemes';

export interface EditorMarker {
  line: number;
  column: number;
  endColumn?: number;
  message: string;
  severity: 'error' | 'warning';
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'c' | 'java' | 'javascript' | 'typescript' | 'python' | 'plaintext';
  height?: string | number;
  readOnly?: boolean;
  // Fired per physical keydown that can produce/modify content (modifier-only
  // presses like a lone Ctrl/Shift are excluded). Used to build a "keystroke
  // count" a teacher can compare against the pasted-character count below to
  // spot answers that were mostly pasted in rather than typed.
  onKeystroke?: () => void;
  // Fired once per paste action with the number of characters that landed in
  // the model, so paste volume can be distinguished from a few keystrokes.
  onPasteText?: (charCount: number) => void;
  // Bound to Ctrl/Cmd+Enter inside the editor. Registered once on mount, so
  // the callback must stay valid for the editor's lifetime (wrap a ref if it
  // needs to see fresh state).
  onCmdEnter?: () => void;
  // Bound to Ctrl/Cmd+S inside the editor. Registered once on mount; reads the
  // latest callback through `latestRef`.
  onCmdS?: () => void;
  // Squiggly diagnostics to overlay (e.g. parsed compile-error locations).
  // Replaces any previously set ones each render; pass [] to clear.
  markers?: EditorMarker[];
  // Accessible name for the editor region and Monaco's internal textarea.
  // Defaults to `${language} コードエディタ`.
  ariaLabel?: string;
}

const LANGUAGE_DISPLAY: Record<NonNullable<CodeEditorProps['language']>, string> = {
  c: 'C',
  java: 'Java',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  plaintext: 'テキスト',
};

// Modifier keys fire their own onKeyDown when pressed alone (e.g. tapping
// Ctrl before Ctrl+V) — excluded so they don't inflate the keystroke count.
function isModifierOnlyKey(monaco: Monaco, keyCode: number): boolean {
  const { KeyCode } = monaco;
  return (
    keyCode === KeyCode.Ctrl ||
    keyCode === KeyCode.Shift ||
    keyCode === KeyCode.Alt ||
    keyCode === KeyCode.Meta ||
    keyCode === KeyCode.CapsLock
  );
}

const MARKER_OWNER = 'compile-errors';

function applyMarkers(
  editor: MonacoStandaloneEditor,
  monaco: Monaco,
  markers: EditorMarker[] | undefined,
) {
  const model = editor.getModel();
  if (!model) return;
  monaco.editor.setModelMarkers(
    model,
    MARKER_OWNER,
    (markers ?? []).map((m) => ({
      startLineNumber: m.line,
      startColumn: m.column,
      endLineNumber: m.line,
      endColumn: m.endColumn ?? m.column + 1,
      message: m.message,
      severity:
        m.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
    })),
  );
}

export function CodeEditor({
  value,
  onChange,
  language = 'c',
  height = 300,
  readOnly = false,
  onKeystroke,
  onPasteText,
  onCmdEnter,
  onCmdS,
  markers,
  ariaLabel,
}: CodeEditorProps) {
  const { theme } = useTheme();
  const themeName = theme === 'dark' ? MONACO_DARK_THEME_NAME : MONACO_LIGHT_THEME_NAME;
  const hintId = useId();
  const resolvedAriaLabel = ariaLabel ?? `${LANGUAGE_DISPLAY[language]} コードエディタ`;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoStandaloneEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const isSyncingFromPropRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const latestRef = useRef({
    value,
    language,
    themeName,
    readOnly,
    markers,
    resolvedAriaLabel,
    onChange,
    onKeystroke,
    onPasteText,
    onCmdEnter,
    onCmdS,
  });

  useEffect(() => {
    latestRef.current = {
      value,
      language,
      themeName,
      readOnly,
      markers,
      resolvedAriaLabel,
      onChange,
      onKeystroke,
      onPasteText,
      onCmdEnter,
      onCmdS,
    };
  });

  useEffect(() => {
    let cancelled = false;
    const disposables: MonacoDisposable[] = [];

    loadMonaco()
      .then((monaco) => {
        if (cancelled || !containerRef.current) return;
        ensureMonokaiProThemes(monaco);
        const latest = latestRef.current;

        const editor = monaco.editor.create(containerRef.current, {
          value: latest.value,
          language: latest.language,
          theme: latest.themeName,
          fontSize: 14,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          readOnly: latest.readOnly,
          ariaLabel: latest.resolvedAriaLabel,
          accessibilitySupport: 'auto',
        });

        editorRef.current = editor;
        monacoRef.current = monaco;

        disposables.push(
          editor.onDidChangeModelContent(() => {
            if (isSyncingFromPropRef.current) return;
            latestRef.current.onChange(editor.getValue());
          }),
        );

        disposables.push(
          editor.onKeyDown((e) => {
            if (isModifierOnlyKey(monaco, e.keyCode)) return;
            latestRef.current.onKeystroke?.();
          }),
        );

        disposables.push(
          editor.onDidPaste((e) => {
            const model = editor.getModel();
            const pastedText = model ? model.getValueInRange(e.range) : '';
            latestRef.current.onPasteText?.(pastedText.length);
          }),
        );

        if (latest.onCmdEnter) {
          disposables.push(
            editor.addAction({
              id: 'code-editor-cmd-enter',
              label: 'コンパイル＆テスト実行',
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
              run: () => latestRef.current.onCmdEnter?.(),
            }),
          );
        }

        if (latest.onCmdS) {
          disposables.push(
            editor.addAction({
              id: 'code-editor-cmd-s',
              label: 'すべて保存',
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
              run: () => latestRef.current.onCmdS?.(),
            }),
          );
        }

        applyMarkers(editor, monaco, latest.markers);
        setLoadError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('エディタの読み込みに失敗しました。ページを再読み込みしてください。');
        }
      });

    return () => {
      cancelled = true;
      for (const d of disposables) d.dispose();
      disposables.length = 0;

      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (editor) {
        const model = editor.getModel();
        if (model && monaco) {
          monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
        }
        editor.dispose();
        model?.dispose();
        editorRef.current = null;
      }
      monacoRef.current = null;
    };
  }, []);

  // Sync controlled `value` into the editor without triggering `onChange` or
  // moving the cursor when the model already matches. External calls like
  // `window.monaco.editor.getModels()[0].setValue(code)` (used by E2E) run
  // with `isSyncingFromPropRef.current === false` and flow through `onChange`.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === value) return;
    const model = editor.getModel();
    isSyncingFromPropRef.current = true;
    try {
      if (model) model.setValue(value);
      else editor.setValue(value);
    } finally {
      isSyncingFromPropRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    const monaco = monacoRef.current;
    if (model && monaco) {
      monaco.editor.setModelLanguage(model, language);
    }
  }, [language]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (monaco) {
      ensureMonokaiProThemes(monaco);
      monaco.editor.setTheme(themeName);
    }
  }, [themeName]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    editorRef.current?.updateOptions({ ariaLabel: resolvedAriaLabel });
  }, [resolvedAriaLabel]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (editor && monaco) {
      applyMarkers(editor, monaco, markers);
    }
  }, [markers]);

  const heightStyle = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      role="region"
      aria-label={resolvedAriaLabel}
      aria-describedby={hintId}
      className="overflow-hidden rounded border border-mp-border"
    >
      {loadError ? (
        <div
          role="alert"
          style={{ height: heightStyle }}
          className="flex items-center justify-center bg-mp-bg p-4 text-sm text-mp-red"
        >
          {loadError}
        </div>
      ) : (
        <div ref={containerRef} style={{ height: heightStyle }} />
      )}
      <p
        id={hintId}
        className="border-t border-mp-border bg-mp-surface px-2 py-1 text-[11px] text-mp-muted"
      >
        キーボード操作: <kbd className="font-mono">Ctrl+M</kbd>（macOS:{' '}
        <kbd className="font-mono">Control+Shift+M</kbd>）で Tab キーによるフォーカス移動を切り替え
      </p>
    </div>
  );
}
