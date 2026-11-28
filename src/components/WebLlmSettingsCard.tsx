import { useCallback, useEffect, useState } from 'react';
import {
  formatByteSize,
  getModelPreset,
  getSelectedModelTier,
  MODEL_PRESETS,
  setSelectedModelTier,
  type ModelTier,
} from '../ai/aiModelConfig';
import {
  clearAllPresetModelCaches,
  clearTierModelCache,
  diagnoseWebGpu,
  isWebGpuSupported,
  type WebGpuDiagnostics,
} from '../ai/webllmEngine';
import { ConfirmDialog } from './ConfirmDialog';

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
 * Shared opt-in / model-preset / WebGPU-diagnostics / cache-deletion UI for
 * WebLLM-backed features (AiAssistSettings for teachers, AiHintSettings for
 * students).
 *
 * Each caller keeps its own separate localStorage opt-in key while sharing
 * the underlying model tier selection, model cache, and engine lifecycle.
 * Only ever imported from React.lazy-loaded settings wrappers so
 * @mlc-ai/web-llm never enters the main bundle.
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
  const [selectedTier, setSelectedTierState] = useState<ModelTier>(getSelectedModelTier);
  const [previousCachedTier, setPreviousCachedTier] = useState<ModelTier | null>(null);
  const [clearingPrevTier, setClearingPrevTier] = useState(false);
  const [showCaution, setShowCaution] = useState(false);
  const [diagnostics, setDiagnostics] = useState<WebGpuDiagnostics | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const supported = isWebGpuSupported();
  const activePreset = getModelPreset(selectedTier);

  const runDiagnostics = useCallback(async (tier: ModelTier) => {
    setDiagnosing(true);
    try {
      const result = await diagnoseWebGpu(tier);
      setDiagnostics(result);
    } finally {
      setDiagnosing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDiagnosing(true);
    diagnoseWebGpu(selectedTier)
      .then((result) => {
        if (!cancelled) setDiagnostics(result);
      })
      .finally(() => {
        if (!cancelled) setDiagnosing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTier, enabled]);

  function handleEnable() {
    setFeatureEnabled(true);
    setEnabled(true);
    setShowCaution(false);
  }

  function handleDisable() {
    setFeatureEnabled(false);
    setEnabled(false);
  }

  function handleSelectTier(nextTier: ModelTier) {
    if (nextTier === selectedTier) return;
    const prevTier = selectedTier;
    setSelectedModelTier(nextTier);
    setSelectedTierState(nextTier);
    if (diagnostics?.cachedByTier[prevTier]) {
      setPreviousCachedTier(prevTier);
    } else {
      setPreviousCachedTier(null);
    }
  }

  async function handleClearPreviousTierCache() {
    if (!previousCachedTier) return;
    setClearingPrevTier(true);
    try {
      await clearTierModelCache(previousCachedTier);
      setPreviousCachedTier(null);
      await runDiagnostics(selectedTier);
    } finally {
      setClearingPrevTier(false);
    }
  }

  async function handleClearCache() {
    setClearing(true);
    try {
      await clearAllPresetModelCaches();
    } finally {
      setClearing(false);
      setFeatureEnabled(false);
      setEnabled(false);
      setPreviousCachedTier(null);
      setDeleteConfirmOpen(false);
      await runDiagnostics(selectedTier);
    }
  }

  const lowStorageWarning =
    diagnostics !== null &&
    diagnostics.storageAvailableBytes !== null &&
    !diagnostics.cachedByTier[selectedTier] &&
    diagnostics.storageAvailableBytes < activePreset.approxSizeBytes;

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
              <p className="mb-2">{cautionMessage(activePreset.approxSizeLabel)}</p>
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

          {/* Model tier selector */}
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-bold text-mp-muted">使用モデル（プリセット）</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {MODEL_PRESETS.map((preset) => {
                const isSelected = preset.tier === selectedTier;
                const isCached = diagnostics?.cachedByTier[preset.tier] ?? false;
                return (
                  <button
                    key={preset.tier}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => handleSelectTier(preset.tier)}
                    className={`rounded border px-2.5 py-2 text-left text-xs transition-colors ${
                      isSelected
                        ? 'border-mp-cyan bg-mp-cyan/10 text-mp-fg'
                        : 'border-mp-border bg-mp-bg text-mp-muted hover:bg-mp-surface-hover'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-mp-fg">{preset.label}</span>
                      <span className="text-[11px] text-mp-muted">{preset.approxSizeLabel}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-mp-muted">{preset.description}</p>
                    <p className="mt-1 text-[11px]">
                      {isCached ? (
                        <span className="font-semibold text-mp-green">● キャッシュ済み</span>
                      ) : (
                        <span className="text-mp-muted">○ 未取得</span>
                      )}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {previousCachedTier && (
            <div className="mt-2 rounded border border-mp-orange bg-mp-orange/10 px-3 py-2 text-xs text-mp-orange">
              <p className="mb-2">
                前に選択していたモデル（{getModelPreset(previousCachedTier).label}
                ）のキャッシュがこのブラウザに残っています。空き容量を確保するために削除しますか？
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={clearingPrevTier}
                  onClick={() => void handleClearPreviousTierCache()}
                  className="rounded bg-mp-orange px-2.5 py-1 text-xs font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                >
                  {clearingPrevTier ? '削除中...' : '旧キャッシュを削除'}
                </button>
                <button
                  type="button"
                  disabled={clearingPrevTier}
                  onClick={() => setPreviousCachedTier(null)}
                  className="rounded border border-mp-border bg-mp-bg px-2.5 py-1 text-xs text-mp-fg hover:bg-mp-surface-hover"
                >
                  残しておく
                </button>
              </div>
            </div>
          )}

          {/* WebGPU & storage diagnostics */}
          <div className="mt-3 rounded border border-mp-border bg-mp-bg px-3 py-2 text-xs text-mp-muted">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-bold text-mp-fg">WebGPU・キャッシュ診断</span>
              <button
                type="button"
                disabled={diagnosing}
                onClick={() => void runDiagnostics(selectedTier)}
                className="rounded border border-mp-border bg-mp-surface px-2 py-0.5 text-[11px] text-mp-fg hover:bg-mp-surface-hover disabled:opacity-50"
              >
                {diagnosing ? '診断中...' : '再診断'}
              </button>
            </div>
            {diagnostics ? (
              <dl className="space-y-1">
                <div className="flex justify-between gap-2">
                  <dt>WebGPU アダプタ</dt>
                  <dd className={diagnostics.hasAdapter ? 'text-mp-green' : 'text-mp-red'}>
                    {diagnostics.hasAdapter ? '利用可能' : '取得できませんでした'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>shader-f16</dt>
                  <dd className={diagnostics.supportsShaderF16 ? 'text-mp-green' : 'text-mp-orange'}>
                    {diagnostics.supportsShaderF16
                      ? '対応（q4f16_1）'
                      : '非対応（q4f32_1 へ自動フォールバック）'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>最大ストレージバッファ</dt>
                  <dd className="text-mp-fg">
                    {diagnostics.maxStorageBufferBindingSize !== null
                      ? formatByteSize(diagnostics.maxStorageBufferBindingSize)
                      : '不明'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>ブラウザ空き容量（概算）</dt>
                  <dd className={lowStorageWarning ? 'font-semibold text-mp-orange' : 'text-mp-fg'}>
                    {diagnostics.storageAvailableBytes !== null
                      ? `${formatByteSize(diagnostics.storageAvailableBytes)}（使用量: ${
                          diagnostics.storageUsageBytes !== null
                            ? formatByteSize(diagnostics.storageUsageBytes)
                            : '不明'
                        }）`
                      : '取得できませんでした'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>選択中モデル</dt>
                  <dd className="truncate font-mono text-[11px] text-mp-fg" title={diagnostics.resolvedModelId}>
                    {diagnostics.resolvedModelId}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>キャッシュ状態</dt>
                  <dd
                    className={
                      diagnostics.cachedByTier[selectedTier] ? 'text-mp-green' : 'text-mp-muted'
                    }
                  >
                    {diagnostics.cachedByTier[selectedTier] ? 'キャッシュ済み' : '未取得'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p>診断情報を取得しています...</p>
            )}
            {lowStorageWarning && (
              <p className="mt-1.5 text-mp-orange">
                ⚠️ 空き容量が選択中モデル（{activePreset.approxSizeLabel}
                ）より少ない可能性があります。軽量モデル（1.5B）の利用をご検討ください。
              </p>
            )}
          </div>

          {enabled && !showCaution && (
            <div className="mt-2 space-y-1 text-xs text-mp-muted">
              {!diagnostics?.cachedByTier[selectedTier] && <p>{notDownloadedMessage}</p>}
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
