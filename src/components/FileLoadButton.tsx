import { useState } from 'react';

interface FileLoadButtonProps {
  label?: string;
  accept?: string;
  maxBytes?: number;
  onLoaded: (text: string, fileName: string) => void;
}

/**
 * Small "read a text file into a textarea" control — the file's content is
 * handed to the caller (who puts it wherever a paste would go) rather than
 * submitted directly, so the teacher still reviews/edits it before whatever
 * "add"/"create" button actually sends it. Shared by every bulk-paste panel
 * that also accepts a file (test cases, course rosters) so the size limit
 * and error handling live in one place.
 */
export function FileLoadButton({
  label = 'ファイルから読み込む',
  accept = '.txt,.csv,text/plain,text/csv',
  maxBytes = 2_000_000,
  onLoaded,
}: FileLoadButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > maxBytes) {
      setError(`ファイルが大きすぎます（${Math.floor(maxBytes / 1_000_000)}MBまで）。`);
      return;
    }
    try {
      const text = await file.text();
      setFileName(file.name);
      onLoaded(text, file.name);
    } catch {
      setError('ファイルを読み込めませんでした。');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="cursor-pointer rounded border border-mp-border bg-mp-bg px-2 py-1 text-xs font-semibold hover:bg-mp-surface-hover">
        {label}
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleFile(file);
          }}
        />
      </label>
      {fileName && !error && (
        <span className="text-xs text-mp-muted">{fileName} を読み込みました。</span>
      )}
      {error && <span className="text-xs text-mp-red">{error}</span>}
    </div>
  );
}
