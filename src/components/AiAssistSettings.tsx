import { useEffect, useState } from 'react';
import {
  aiAssistModelSizeLabel,
  clearAiAssistCache,
  estimateStorageUsageBytes,
  isWebGpuSupported,
} from '../ai/aiAssist';
import { isAiAssistEnabled, setAiAssistEnabled } from '../ai/aiAssistSettings';
import { ConfirmDialog } from './ConfirmDialog';

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `約${(mb / 1024).toFixed(1)}GB` : `約${Math.round(mb)}MB`;
}

/**
 * Teacher-only settings section for AI作問サポート (TaskEditorPage's
 * AiAssistPanel) — lives in UserDrawer next to 表示テーマ. Turning the
 * feature on is gated behind an inline caution (download size, browser-only
 * storage) rather than taking effect immediately on click; turning it off
 * just stops offering the panel and leaves any already-downloaded model
 * cached (fast to turn back on). Deleting the cached model is a distinct,
 * explicit action below, confirmed via the same ConfirmDialog every other
 * irreversible action in this app uses.
 */
export function AiAssistSettings() {
  const [enabled, setEnabled] = useState(isAiAssistEnabled);
  const [showCaution, setShowCaution] = useState(false);
  const [usageBytes, setUsageBytes] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const supported = isWebGpuSupported();

  useEffect(() => {
    if (!enabled) return;
    estimateStorageUsageBytes().then(setUsageBytes);
  }, [enabled]);

  function handleEnable() {
    setAiAssistEnabled(true);
    setEnabled(true);
    setShowCaution(false);
  }

  function handleDisable() {
    setAiAssistEnabled(false);
    setEnabled(false);
  }

  async function handleClearCache() {
    setClearing(true);
    try {
      await clearAiAssistCache();
    } finally {
      setClearing(false);
      setAiAssistEnabled(false);
      setEnabled(false);
      setUsageBytes(null);
      setDeleteConfirmOpen(false);
    }
  }

  return (
    <div className="mb-4">
      <p className="mb-1 text-xs font-bold text-mp-muted">AI作問サポート（問題編集画面）</p>

      {!supported ? (
        <p className="rounded border border-mp-border bg-mp-bg px-3 py-2 text-xs text-mp-muted">
          このブラウザはAI作問サポート（WebGPU）に対応していません。
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={enabled ? handleDisable : () => setShowCaution(true)}
            className={`w-full rounded border px-3 py-1.5 text-left text-sm ${
              enabled
                ? 'border-mp-green/50 bg-mp-green/10 text-mp-green'
                : 'border-mp-border bg-mp-bg hover:bg-mp-surface-hover'
            }`}
          >
            {enabled ? '✓ 有効（クリックでオフ）' : 'AI作問サポートを有効にする'}
          </button>

          {showCaution && (
            <div className="mt-2 rounded border border-mp-orange bg-mp-orange/10 px-3 py-2 text-xs text-mp-orange">
              <p className="mb-2">
                有効にすると、初回利用時（問題編集画面で「生成する」を押したとき）にAIモデル（{aiAssistModelSizeLabel()}）をこのブラウザにダウンロードして保存します。回線によっては数分かかることがあります。ダウンロードしたデータはこのブラウザにのみ保存され、他の端末やアカウントには引き継がれません。不要になったら下の「削除」でいつでも消せます。
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleEnable}
                  className="rounded bg-mp-cyan px-3 py-1 text-xs font-bold text-mp-btn-fg hover:opacity-90"
                >
                  有効にする
                </button>
                <button
                  type="button"
                  onClick={() => setShowCaution(false)}
                  className="rounded border border-mp-border bg-mp-bg px-3 py-1 text-xs hover:bg-mp-surface-hover"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {enabled && !showCaution && (
            <div className="mt-2 space-y-1 text-xs text-mp-muted">
              <p>
                {usageBytes !== null
                  ? `このブラウザ（このサイト全体）の保存領域使用量: ${formatBytes(usageBytes)}（AIモデル以外の分も含む概算）`
                  : 'モデルは未取得です。問題編集画面で初めて生成を実行すると自動的にダウンロードされます。'}
              </p>
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(true)}
                className="rounded border border-mp-red/50 px-2 py-1 font-semibold text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
              >
                ダウンロード済みモデルを削除してオフにする
              </button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="AIモデルを削除"
        message="ダウンロード済みのAIモデルをこのブラウザから削除し、AI作問サポートをオフにします。次に有効化したときは再度ダウンロードが必要になります。よろしいですか？"
        confirmLabel={clearing ? '削除中...' : '削除する'}
        onConfirm={handleClearCache}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}

// Default export so UserDrawer can `React.lazy()` this — it (and everything
// it imports from ../ai/aiAssist, ultimately @mlc-ai/web-llm) is otherwise
// several MB of JS that would land in the shared main bundle every page —
// including student pages — since UserDrawer renders on all of them.
export default AiAssistSettings;
