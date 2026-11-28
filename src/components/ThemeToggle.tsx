import { useTheme } from '../contexts/useTheme';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  const label = theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className="whitespace-nowrap rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
    >
      {theme === 'dark' ? (
        <>
          <span aria-hidden="true">☀️</span> ライト
        </>
      ) : (
        <>
          <span aria-hidden="true">🌙</span> ダーク
        </>
      )}
    </button>
  );
}
