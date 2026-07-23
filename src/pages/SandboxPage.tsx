import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CodeEditor } from '../components/CodeEditor';
import { ThemeToggle } from '../components/ThemeToggle';
import { compileAndRunC, type RunCResult } from '../runner/cRunner';

const DEFAULT_SOURCE = `#include <stdio.h>

int main() {
    int a, b;
    if (scanf("%d %d", &a, &b) == 2) {
        printf("%d\\n", a + b);
    }
    return 0;
}
`;

export function SandboxPage() {
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [stdin, setStdin] = useState('5 10\n');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [result, setResult] = useState<RunCResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setStatus('loading');
    setStatusMessage('Wasmer SDKを初期化し、clangパッケージを取得しています（初回は100MB程度のダウンロードが発生し、数十秒〜数分かかることがあります）...');
    setResult(null);
    setError(null);
    try {
      const runResult = await compileAndRunC(source, stdin);
      setResult(runResult);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '実行に失敗しました。');
      setStatus('error');
    }
  }

  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/teacher" className="inline-block text-sm text-mp-cyan hover:underline">
          ← 講師管理画面に戻る
        </Link>
        <ThemeToggle />
      </div>

      <h1 className="mb-2 text-xl font-bold text-mp-cyan">
        C言語 コンパイル・実行サンドボックス（動作確認用）
      </h1>
      <p className="mb-4 text-sm text-mp-muted">
        Monaco Editor + Wasmer SDK（clang/clang, WASIX）でブラウザ内のみでC言語をコンパイル・実行します。サーバーには一切送信されません。
      </p>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-mp-muted">C言語ソースコード</label>
          <CodeEditor value={source} onChange={setSource} language="c" height={320} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-mp-muted">標準入力（stdin）</label>
          <textarea
            className="h-[320px] w-full rounded border border-mp-border bg-mp-bg px-3 py-2 font-mono text-sm text-mp-fg"
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
          />
        </div>
      </div>

      <button
        onClick={handleRun}
        disabled={status === 'loading'}
        className="mb-4 rounded bg-mp-cyan px-4 py-2 font-bold text-mp-ink hover:opacity-90 disabled:opacity-50"
      >
        {status === 'loading' ? '実行中...' : '▶ コンパイル＆実行'}
      </button>

      {status === 'loading' && <p className="mb-4 text-sm text-mp-muted">{statusMessage}</p>}
      {status === 'error' && <p className="mb-4 text-sm text-mp-red">{error}</p>}

      {result && (
        <div className="rounded-lg border border-mp-border bg-mp-surface p-4">
          <p className="mb-2 font-bold">
            結果:{' '}
            {result.stage === 'success' ? (
              <span className="text-mp-green">実行成功</span>
            ) : result.stage === 'compile_error' ? (
              <span className="text-mp-red">コンパイルエラー</span>
            ) : (
              <span className="text-mp-red">実行時エラー（終了コード: {result.exitCode}）</span>
            )}
          </p>

          {result.stage === 'compile_error' ? (
            <>
              <p className="mb-1 text-sm text-mp-muted">コンパイラ出力:</p>
              <pre className="whitespace-pre-wrap rounded bg-mp-bg p-3 text-sm text-mp-red">
                {result.compileStderr}
              </pre>
            </>
          ) : (
            <>
              <p className="mb-1 text-sm text-mp-muted">標準出力:</p>
              <pre className="mb-3 whitespace-pre-wrap rounded bg-mp-bg p-3 text-sm text-mp-green">
                {result.stdout || '(なし)'}
              </pre>
              {result.stderr && (
                <>
                  <p className="mb-1 text-sm text-mp-muted">標準エラー出力:</p>
                  <pre className="whitespace-pre-wrap rounded bg-mp-bg p-3 text-sm text-mp-red">
                    {result.stderr}
                  </pre>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
