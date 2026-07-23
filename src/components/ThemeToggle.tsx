import { useTheme } from '../contexts/ThemeContext';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
      className="whitespace-nowrap rounded bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
    >
      {theme === 'dark' ? '☀️ ライト' : '🌙 ダーク'}
    </button>
  );
}
