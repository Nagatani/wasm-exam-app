import { isAiAssistEnabled, setAiAssistEnabled } from '../ai/aiAssistSettings';
import { WebLlmSettingsCard } from './WebLlmSettingsCard';

/**
 * Teacher-only settings section for AI作問サポート (TaskEditorPage's
 * AiAssistPanel) — lives on SettingsPage (/settings). Keeps its own
 * localStorage opt-in flag (aiAssistSettings.ts) separate from the student
 * hint feature while reusing WebLlmSettingsCard.
 */
export function AiAssistSettings() {
  return (
    <WebLlmSettingsCard
      sectionTitle="AI作問サポート（問題編集画面）"
      enableButtonLabel="AI作問サポートを有効にする"
      unsupportedMessage="このブラウザはAI作問サポート（WebGPU）に対応していません。"
      cautionMessage={(sizeLabel) =>
        `有効にすると、初回利用時（問題編集画面で「生成する」を押したとき）にAIモデル（${sizeLabel}）をこのブラウザにダウンロードして保存します。回線によっては数分かかることがあります。ダウンロードしたデータはこのブラウザにのみ保存され、他の端末やアカウントには引き継がれません。不要になったら下の「削除」でいつでも消せます。`
      }
      notDownloadedMessage="モデルは未取得です。問題編集画面で初めて生成を実行すると自動的にダウンロードされます。"
      deleteConfirmMessage="ダウンロード済みのAIモデルをこのブラウザから削除し、AI作問サポートをオフにします。次に有効化したときは再度ダウンロードが必要になります。よろしいですか？"
      isFeatureEnabled={isAiAssistEnabled}
      setFeatureEnabled={setAiAssistEnabled}
    />
  );
}

// Default export so SettingsPage can `React.lazy()` this — it (and everything
// WebLlmSettingsCard imports from ../ai/webllmEngine, ultimately
// @mlc-ai/web-llm) is several MB of JS that must stay out of the main bundle.
export default AiAssistSettings;
