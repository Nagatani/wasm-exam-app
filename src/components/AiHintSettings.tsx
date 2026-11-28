import { isAiHintEnabled, setAiHintEnabled } from '../ai/aiHintSettings';
import { WebLlmSettingsCard } from './WebLlmSettingsCard';

/**
 * Student-only settings section for the practice-mode AI hint feature
 * (PracticeTaskPage's HintPanel) — lives on SettingsPage (/settings). Keeps
 * its own localStorage opt-in flag (aiHintSettings.ts) separate from the
 * teacher authoring assist while reusing WebLlmSettingsCard.
 */
export function AiHintSettings() {
  return (
    <WebLlmSettingsCard
      sectionTitle="AIヒント（演習モード）"
      enableButtonLabel="AIヒントを有効にする"
      unsupportedMessage="このブラウザはAIヒント（WebGPU）に対応していません。"
      cautionMessage={(sizeLabel) =>
        `有効にすると、初回利用時（演習の問題ページで「ヒント」を押したとき）にAIモデル（${sizeLabel}）をこのブラウザにダウンロードして保存します。回線によっては数分かかることがあります。ダウンロードしたデータはこのブラウザにのみ保存され、他の端末やアカウントには引き継がれません。不要になったら下の「削除」でいつでも消せます。ヒントが使えるのは教師が許可した演習問題のみです。`
      }
      notDownloadedMessage="モデルは未取得です。演習の問題ページで初めてヒントを使うと自動的にダウンロードされます。"
      deleteConfirmMessage="ダウンロード済みのAIモデルをこのブラウザから削除し、AIヒントをオフにします。次に有効化したときは再度ダウンロードが必要になります。よろしいですか？"
      isFeatureEnabled={isAiHintEnabled}
      setFeatureEnabled={setAiHintEnabled}
    />
  );
}

// Default export so SettingsPage can `React.lazy()` this — same reasoning as
// AiAssistSettings.tsx (several MB of JS via ../ai/webllmEngine that must
// stay out of the main bundle).
export default AiHintSettings;
