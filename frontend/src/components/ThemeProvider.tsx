import { createContext, useContext, useState } from 'react'
import type { Theme } from '../lib/theme.ts'
import { applyTheme, getStoredTheme } from '../lib/theme.ts'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializer: reads localStorage and applies the attribute synchronously
  // on first render, eliminating the FOUC that a useEffect would cause.
  const [theme, setTheme] = useState<Theme>(() => {
    const t = getStoredTheme()
    applyTheme(t)
    return t
  })

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
