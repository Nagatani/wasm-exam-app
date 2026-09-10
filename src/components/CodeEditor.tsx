import { useEffect, useRef } from 'react';
import Editor, {
  type Monaco,
  type OnMount,
  type OnChange,
} from '@monaco-editor/react';
import { useTheme } from '../contexts/ThemeContext';

type StandaloneEditor = Parameters<OnMount>[0];
import { MONACO_DARK_THEME_NAME, MONACO_LIGHT_THEME_NAME, ensureMonokaiProThemes } from '../runner/monacoThemes';

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
  // Squiggly diagnostics to overlay (e.g. parsed compile-error locations).
  // Replaces any previously set ones each render; pass [] to clear.
  markers?: EditorMarker[];
}

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

export function CodeEditor({
  value,
  onChange,
  language = 'c',
  height = 300,
  readOnly = false,
  onKeystroke,
  onPasteText,
  onCmdEnter,
  markers,
}: CodeEditorProps) {
  const { theme } = useTheme();
  const editorRef = useRef<StandaloneEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onKeyDown((e) => {
      if (isModifierOnlyKey(monaco, e.keyCode)) return;
      onKeystroke?.();
    });
    editor.onDidPaste((e) => {
      const model = editor.getModel();
      const pastedText = model ? model.getValueInRange(e.range) : '';
      onPasteText?.(pastedText.length);
    });
    if (onCmdEnter) {
      editor.addAction({
        id: 'code-editor-cmd-enter',
        label: 'コンパイル＆テスト実行',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => onCmdEnter(),
      });
    }
    applyMarkers();
  };

  function applyMarkers() {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
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
          m.severity === 'warning'
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Error,
      })),
    );
  }

  // Re-apply whenever the marker list changes (and clear on unmount).
  useEffect(() => {
    applyMarkers();
    return () => {
      const model = editorRef.current?.getModel();
      if (model && monacoRef.current) {
        monacoRef.current.editor.setModelMarkers(model, MARKER_OWNER, []);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  const handleChange: OnChange = (v) => onChange(v ?? '');

  return (
    <div className="overflow-hidden rounded border border-mp-border">
      <Editor
        height={height}
        language={language}
        theme={theme === 'dark' ? MONACO_DARK_THEME_NAME : MONACO_LIGHT_THEME_NAME}
        beforeMount={ensureMonokaiProThemes}
        onMount={handleMount}
        value={value}
        onChange={handleChange}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          readOnly,
        }}
      />
    </div>
  );
}
