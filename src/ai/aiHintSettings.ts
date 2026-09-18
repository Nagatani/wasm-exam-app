// Whether this browser has opted into the practice-mode AI hint feature (see
// aiHint.ts) — same localStorage-flag pattern as aiAssistSettings.ts, but a
// deliberately SEPARATE key/event: aiAssistSettings.ts's flag gates the
// teacher-only "AI作問サポート" authoring aid, and reusing it here would mean
// a teacher opting into authoring assist on some browser silently also
// enables the student hint feature for anyone who later logs in as a
// student on that same browser (or vice versa) — two different features
// opted into by two different roles for two different reasons. Both happen
// to share the same underlying downloaded model/cache (see aiHint.ts), but
// the opt-in itself is per-feature.
const STORAGE_KEY = 'wasm-exam-ai-hint-enabled';
const CHANGE_EVENT = 'wasm-exam-ai-hint-settings-changed';

export function isAiHintEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setAiHintEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onAiHintSettingsChanged(handler: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
