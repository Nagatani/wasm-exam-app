import { useEffect, useState } from 'react';
import {
  clearWebLlmModelCache,
  estimateStorageUsageBytes,
  getWebLlmModelSizeLabel,
  isWebGpuSupported,
} from '../ai/webllmEngine';
import { ConfirmDialog } from './ConfirmDialog';

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `約${(mb / 1024).toFixed(1)}GB` : `約${Math.round(mb)}MB`;
}

export interface WebLlmSettingsCardProps {
  sectionTitle: string;
  enableButtonLabel: string;
  unsupportedMessage: string;
  cautionMessage: (modelSizeLabel: string) => string;
  notDownloadedMessage: string;
  deleteConfirmMessage: string;
  isFeatureEnabled: () => boolean;
  setFeatureEnabled: (enabled: boolean) => void;
}

/**
 * Shared opt-in / storage-usage / cache-deletion UI for WebLLM-backed
 * features (AiAssistSettings for teachers, AiHintSettings for students).
 *
 * Each caller keeps its own separate localStorage opt-in key while sharing
 * the underlying model cache and engine lifecycle. Only ever imported from
 * React.lazy-loaded settings wrappers so @mlc-ai/web-llm never enters the
 * main bundle.
 */
export function WebLlmSettingsCard({
  sectionTitle,
  enableButtonLabel,
  unsupportedMessage,
  cautionMessage,
  notDownloadedMessage,
  deleteConfirmMessage,
  isFeatureEnabled,
  setFeatureEnabled,
}: WebLlmSettingsCardProps) {
  const [enabled, setEnabled] = useState(isFeatureEnabled);
  const [showCaution, setShowCaution] = useState(false);
  const [usageBytes, setUsageBytes] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const supported = isWebGpuSupported();
  const modelSizeLabel = getWebLlmModelSizeLabel();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    estimateStorageUsageBytes().then((bytes) => {
      if (!cancelled) setUsageBytes(bytes);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  function handleEnable() {
    setFeatureEnabled(true);
    setEnabled(true);
    setShowCaution(false);
  }

  function handleDisable() {
    setFeatureEnabled(false);
    setEnabled(false);
  }

  async function handleClearCache() {
    setClearing(true);
    try {
      await clearWebLlmModelCache();
    } finally {
      setClearing(false);
      setFeatureEnabled(false);
      setEnabled(false);
      setUsageBytes(null);
      setDeleteConfirmOpen(false);
    }
  }

  return (
    <div className="mb-4">
      <p className="mb-1 text-xs font-bold text-mp-muted">{sectionTitle}</p>

      {!supported ? (
        <p className="rounded border border-mp-border bg-mp-bg px-3 py-2 text-xs text-mp-muted">
          {unsupportedMessage}
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
            {enabled ? '✓ 有効（クリックでオフ）' : enableButtonLabel}
          </button>

          {showCaution && (
            <div className="mt-2 rounded border border-mp-orange bg-mp-orange/10 px-3 py-2 text-xs text-mp-orange">
              <p className="mb-2">{cautionMessage(modelSizeLabel)}</p>
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
                  : notDownloadedMessage}
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
        message={deleteConfirmMessage}
        confirmLabel={clearing ? '削除中...' : '削除する'}
        onConfirm={handleClearCache}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}
