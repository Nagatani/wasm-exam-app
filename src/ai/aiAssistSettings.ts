// Whether this browser has opted into AI作問サポート (see aiAssist.ts) — a
// plain localStorage flag, same pattern as ThemeContext's STORAGE_KEY,
// deliberately *not* an account-level server setting: the thing being opted
// into is "download a multi-hundred-MB-to-multi-GB model into this
// browser's cache", which is inherently per-device and can't be synced
// across a teacher's machines anyway (each one would need to redownload the
// model regardless of what a server-side flag said). Only referenced from
// UserDrawer (the toggle) and TaskEditorPage (the AiAssistPanel gate).
const STORAGE_KEY = 'wasm-exam-ai-assist-enabled';

// localStorage writes don't fire a same-tab `storage` event (only other
// tabs see those), so UserDrawer's toggle and TaskEditorPage's gate — both
// live on the same page when the drawer is open over the editor — need
// their own signal to stay in sync without a full reload.
const CHANGE_EVENT = 'wasm-exam-ai-assist-settings-changed';

export function isAiAssistEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setAiAssistEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onAiAssistSettingsChanged(handler: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
