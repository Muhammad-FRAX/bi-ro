import { useTheme } from './ThemeProvider.tsx'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        height: 'var(--btn-h)',
        padding: '0 10px',
        background: 'var(--bg-elev-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: 12,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'inherit',
      }}
    >
      {/* Dark mode → show sun (click to go light); light mode → show moon (click to go dark) */}
      {theme === 'dark' ? '☀️' : '🌙'}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
