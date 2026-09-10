// Line-by-line comparison of a sample test case's expected vs. actual output.
// Naive index alignment (no LCS) — enough for exam output, where line counts
// usually match or are off by one, and far clearer than two plain text blobs.
// The judge trims the whole string before comparing, so a leading/trailing
// whitespace-only difference is NOT a failure; interior differences are.

interface SampleDiffProps {
  expected: string;
  actual: string;
}

// Render a line, making trailing spaces/tabs visible.
function withVisibleTrailing(line: string) {
  const m = line.match(/[ \t]+$/);
  if (!m) return line === '' ? <span className="text-mp-muted">(空行)</span> : <>{line}</>;
  return (
    <>
      {line.slice(0, line.length - m[0].length)}
      <span className="rounded bg-mp-yellow/30 text-mp-yellow" title="末尾の空白">
        {'·'.repeat(m[0].length)}
      </span>
    </>
  );
}

function Column({
  label,
  lines,
  otherLines,
}: {
  label: string;
  lines: string[];
  otherLines: string[];
}) {
  return (
    <div>
      <p className="mb-0.5 text-mp-muted">{label}</p>
      <div className="overflow-x-auto rounded bg-mp-bg">
        {lines.map((line, i) => {
          const same = i < otherLines.length && otherLines[i] === line;
          return (
            <div
              key={i}
              className={`whitespace-pre px-1 ${same ? '' : 'bg-mp-red/15 text-mp-fg'}`}
            >
              {withVisibleTrailing(line)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SampleDiff({ expected, actual }: SampleDiffProps) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const lineCountDiffers = expectedLines.length !== actualLines.length;

  return (
    <div className="mt-1 space-y-1 text-xs">
      {lineCountDiffers && (
        <p className="font-bold text-mp-yellow">
          行数が違います（期待 {expectedLines.length} 行 / 出力 {actualLines.length} 行）
        </p>
      )}
      <div className="space-y-1.5">
        <Column label="期待される出力" lines={expectedLines} otherLines={actualLines} />
        <Column label="あなたの出力" lines={actualLines} otherLines={expectedLines} />
      </div>
      <p className="text-mp-muted">※ 先頭・末尾の空白だけの違いは判定では無視されます。</p>
    </div>
  );
}
