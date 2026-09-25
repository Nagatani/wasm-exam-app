import { useEffect, useState } from 'react';
import {
  aiAssistModelSizeLabel,
  clearAiAssistCache,
  estimateStorageUsageBytes,
  isWebGpuSupported,
} from '../ai/aiAssist';
import { isAiHintEnabled, setAiHintEnabled } from '../ai/aiHintSettings';
import { ConfirmDialog } from './ConfirmDialog';

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `約${(mb / 1024).toFixed(1)}GB` : `約${Math.round(mb)}MB`;
}

/**
 * Student-only settings section for the practice-mode AI hint feature
 * (PracticeTaskPage's HintPanel) — lives on SettingsPage (/settings),
 * mirroring AiAssistSettings.tsx's structure exactly (same caution-before-
 * enabling / storage-usage / delete-cache flow). Kept as its own component
 * rather than a parameterized shared one because the two features have
 * different opt-in flags (see aiHintSettings.ts) and different audiences
 * (SettingsPage shows this to STUDENT, AiAssistSettings to TEACHER) — the
 * model/cache underneath is shared (../ai/aiAssist), the opt-in isn't.
 */
export function AiHintSettings() {
  const [enabled, setEnabled] = useState(isAiHintEnabled);
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
    setAiHintEnabled(true);
    setEnabled(true);
    setShowCaution(false);
  }

  function handleDisable() {
    setAiHintEnabled(false);
    setEnabled(false);
  }

  async function handleClearCache() {
    setClearing(true);
    try {
      await clearAiAssistCache();
    } finally {
      setClearing(false);
      setAiHintEnabled(false);
      setEnabled(false);
      setUsageBytes(null);
      setDeleteConfirmOpen(false);
    }
  }

  return (
    <div className="mb-4">
      <p className="mb-1 text-xs font-bold text-mp-muted">AIヒント（演習モード）</p>

      {!supported ? (
        <p className="rounded border border-mp-border bg-mp-bg px-3 py-2 text-xs text-mp-muted">
          このブラウザはAIヒント（WebGPU）に対応していません。
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
            {enabled ? '✓ 有効（クリックでオフ）' : 'AIヒントを有効にする'}
          </button>

          {showCaution && (
            <div className="mt-2 rounded border border-mp-orange bg-mp-orange/10 px-3 py-2 text-xs text-mp-orange">
              <p className="mb-2">
                有効にすると、初回利用時（演習の問題ページで「ヒント」を押したとき）にAIモデル（{aiAssistModelSizeLabel()}）をこのブラウザにダウンロードして保存します。回線によっては数分かかることがあります。ダウンロードしたデータはこのブラウザにのみ保存され、他の端末やアカウントには引き継がれません。不要になったら下の「削除」でいつでも消せます。ヒントが使えるのは教師が許可した演習問題のみです。
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
                  : 'モデルは未取得です。演習の問題ページで初めてヒントを使うと自動的にダウンロードされます。'}
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
        message="ダウンロード済みのAIモデルをこのブラウザから削除し、AIヒントをオフにします。次に有効化したときは再度ダウンロードが必要になります。よろしいですか？"
        confirmLabel={clearing ? '削除中...' : '削除する'}
        onConfirm={handleClearCache}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}

// Default export so SettingsPage can `React.lazy()` this — same reasoning as
// AiAssistSettings.tsx (several MB of JS via ../ai/aiAssist that shouldn't
// land in the shared main bundle).
export default AiHintSettings;
