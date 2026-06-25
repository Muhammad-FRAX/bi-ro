export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'biro-theme'

export function getStoredTheme(): Theme {
  try {
    return (localStorage.getItem(STORAGE_KEY) as Theme) ?? 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // storage unavailable — still apply visually
  }
}
