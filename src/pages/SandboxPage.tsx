import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CodeEditor } from '../components/CodeEditor';
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
    <div className="min-h-screen bg-gray-900 p-6 text-white">
      <Link to="/teacher" className="mb-4 inline-block text-sm text-teal-400 hover:underline">
        ← 講師管理画面に戻る
      </Link>

      <h1 className="mb-2 text-xl font-bold text-teal-400">
        C言語 コンパイル・実行サンドボックス（動作確認用）
      </h1>
      <p className="mb-4 text-sm text-gray-400">
        Monaco Editor + Wasmer SDK（clang/clang, WASIX）でブラウザ内のみでC言語をコンパイル・実行します。サーバーには一切送信されません。
      </p>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-gray-400">C言語ソースコード</label>
          <CodeEditor value={source} onChange={setSource} language="c" height={320} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-400">標準入力（stdin）</label>
          <textarea
            className="h-[320px] w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 font-mono text-sm text-white"
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
          />
        </div>
      </div>

      <button
        onClick={handleRun}
        disabled={status === 'loading'}
        className="mb-4 rounded bg-teal-500 px-4 py-2 font-bold text-gray-900 hover:bg-teal-600 disabled:opacity-50"
      >
        {status === 'loading' ? '実行中...' : '▶ コンパイル＆実行'}
      </button>

      {status === 'loading' && <p className="mb-4 text-sm text-gray-400">{statusMessage}</p>}
      {status === 'error' && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {result && (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="mb-2 font-bold">
            結果:{' '}
            {result.stage === 'success' ? (
              <span className="text-green-400">実行成功</span>
            ) : result.stage === 'compile_error' ? (
              <span className="text-red-400">コンパイルエラー</span>
            ) : (
              <span className="text-red-400">実行時エラー（終了コード: {result.exitCode}）</span>
            )}
          </p>

          {result.stage === 'compile_error' ? (
            <>
              <p className="mb-1 text-sm text-gray-400">コンパイラ出力:</p>
              <pre className="whitespace-pre-wrap rounded bg-gray-900 p-3 text-sm text-red-300">
                {result.compileStderr}
              </pre>
            </>
          ) : (
            <>
              <p className="mb-1 text-sm text-gray-400">標準出力:</p>
              <pre className="mb-3 whitespace-pre-wrap rounded bg-gray-900 p-3 text-sm text-green-300">
                {result.stdout || '(なし)'}
              </pre>
              {result.stderr && (
                <>
                  <p className="mb-1 text-sm text-gray-400">標準エラー出力:</p>
                  <pre className="whitespace-pre-wrap rounded bg-gray-900 p-3 text-sm text-red-300">
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
