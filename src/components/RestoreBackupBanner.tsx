import type { LocalBackup } from '../lib/localBackup';

function formatTime(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString('ja-JP', {
    ...(sameDay ? {} : { month: 'numeric', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Offer to restore editor code recovered from useCodeBackup. */
export function RestoreBackupBanner({
  backup,
  savedLabel,
  onRestore,
  onDiscard,
}: {
  backup: LocalBackup;
  // What the server copy is called on this page ("下書き" / "初期コード").
  savedLabel: string;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 border-b border-mp-orange bg-mp-orange/10 px-4 py-2 text-sm text-mp-orange"
    >
      <span className="flex-1">
        このブラウザに、保存されていない編集内容が残っています（{formatTime(backup.savedAt)} 時点）。
        復元しますか？ 復元しない場合は{savedLabel}が表示されたままになります。
      </span>
      <button
        type="button"
        onClick={onRestore}
        className="rounded bg-mp-orange px-3 py-1 text-xs font-bold text-mp-btn-fg hover:opacity-90"
      >
        復元する
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="rounded border border-mp-orange/60 px-3 py-1 text-xs hover:bg-mp-orange/20"
      >
        破棄する
      </button>
    </div>
  );
}
