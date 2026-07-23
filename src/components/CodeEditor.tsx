import Editor from '@monaco-editor/react';
import { useTheme } from '../contexts/ThemeContext';
import { MONACO_DARK_THEME_NAME, MONACO_LIGHT_THEME_NAME, ensureMonokaiProThemes } from '../runner/monacoThemes';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'c' | 'plaintext';
  height?: string | number;
  readOnly?: boolean;
}

export function CodeEditor({
  value,
  onChange,
  language = 'c',
  height = 300,
  readOnly = false,
}: CodeEditorProps) {
  const { theme } = useTheme();

  return (
    <div className="overflow-hidden rounded border border-mp-border">
      <Editor
        height={height}
        language={language}
        theme={theme === 'dark' ? MONACO_DARK_THEME_NAME : MONACO_LIGHT_THEME_NAME}
        beforeMount={ensureMonokaiProThemes}
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
