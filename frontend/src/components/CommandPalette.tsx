import { useState, useEffect, useRef, type KeyboardEvent } from 'react'
import { api, ApiError } from '../lib/api.ts'

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle: string
  url: string
}

interface Props {
  onNavigate?: (path: string) => void
  onClose: () => void
}

const TYPE_ICON: Record<string, string> = {
  server: 'S',
  app: 'A',
  document: 'D',
  secret: 'K',
}

const TYPE_COLOR: Record<string, string> = {
  server: 'var(--accent)',
  app: 'var(--success, #34d399)',
  document: 'var(--warning, #fbbf24)',
  secret: 'var(--danger, #f87171)',
}

export function CommandPalette({ onNavigate, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setResults([])
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(() => {
      api.get<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query.trim())}`)
        .then((data) => {
          setResults(data.results)
          setActiveIdx(0)
          setError(null)
        })
        .catch((err) => {
          setError(err instanceof ApiError ? err.message : 'Search failed')
          setResults([])
        })
        .finally(() => setLoading(false))
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const item = results[activeIdx]
      if (item) {
        onNavigate?.(item.url)
        onClose()
      }
    }
  }

  function handleSelect(url: string) {
    onNavigate?.(url)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 80,
        zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          width: '100%',
          maxWidth: 560,
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            gap: 10,
          }}
        >
          <span style={{ color: 'var(--text-muted)', fontSize: 16, flexShrink: 0 }}>
            &#128269;
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search servers, apps, documents, secrets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 15,
              color: 'var(--text)',
              fontFamily: 'inherit',
            }}
            aria-label="Search"
            autoComplete="off"
          />
          {loading && (
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                border: '2px solid var(--border)',
                borderTopColor: 'var(--accent)',
                animation: 'spin 600ms linear infinite',
                flexShrink: 0,
              }}
            />
          )}
          <kbd
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              background: 'var(--bg-elev-2)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '1px 5px',
              flexShrink: 0,
            }}
          >
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {error && (
            <div style={{ padding: '12px 16px', color: 'var(--danger, #f87171)', fontSize: 13 }}>
              {error}
            </div>
          )}

          {!error && !loading && query.trim() && results.length === 0 && (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {!error && !query.trim() && (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              Type to search across servers, apps, documents, and secrets
            </div>
          )}

          {results.map((item, idx) => {
            const active = idx === activeIdx
            const color = TYPE_COLOR[item.type] ?? 'var(--text-muted)'
            const icon = TYPE_ICON[item.type] ?? '?'
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.url)}
                onMouseEnter={() => setActiveIdx(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '10px 16px',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  border: 'none',
                  borderLeft: active ? `2px solid ${color}` : '2px solid transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
                aria-selected={active}
              >
                {/* Type badge */}
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: `color-mix(in srgb, ${color} 15%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    color,
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  {icon}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.subtitle}
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 10,
                    color: color,
                    background: `color-mix(in srgb, ${color} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
                    borderRadius: 4,
                    padding: '1px 5px',
                    flexShrink: 0,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                  }}
                >
                  {item.type}
                </span>
              </button>
            )
          })}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div
            style={{
              padding: '8px 16px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: 12,
              fontSize: 11,
              color: 'var(--text-muted)',
            }}
          >
            <span><kbd style={{ fontSize: 10 }}>↑↓</kbd> navigate</span>
            <span><kbd style={{ fontSize: 10 }}>↵</kbd> open</span>
            <span><kbd style={{ fontSize: 10 }}>Esc</kbd> close</span>
          </div>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )
}
