import Editor from '@monaco-editor/react';

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
  return (
    <div className="overflow-hidden rounded border border-gray-600">
      <Editor
        height={height}
        language={language}
        theme="vs-dark"
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
