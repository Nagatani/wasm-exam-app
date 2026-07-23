import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useTheme } from '../contexts/ThemeContext';
import { MONACO_DARK_THEME_NAME, MONACO_LIGHT_THEME_NAME, ensureMonokaiProThemes } from '../runner/monacoThemes';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'c' | 'plaintext';
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

export function CodeEditor({
  value,
  onChange,
  language = 'c',
  height = 300,
  readOnly = false,
  onKeystroke,
  onPasteText,
}: CodeEditorProps) {
  const { theme } = useTheme();

  const handleMount: OnMount = (editor, monaco) => {
    editor.onKeyDown((e) => {
      if (isModifierOnlyKey(monaco, e.keyCode)) return;
      onKeystroke?.();
    });
    editor.onDidPaste((e) => {
      const model = editor.getModel();
      const pastedText = model ? model.getValueInRange(e.range) : '';
      onPasteText?.(pastedText.length);
    });
  };

  return (
    <div className="overflow-hidden rounded border border-mp-border">
      <Editor
        height={height}
        language={language}
        theme={theme === 'dark' ? MONACO_DARK_THEME_NAME : MONACO_LIGHT_THEME_NAME}
        beforeMount={ensureMonokaiProThemes}
        onMount={handleMount}
        value={value}
        onChange={(v) => onChange(v ?? '')}
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
