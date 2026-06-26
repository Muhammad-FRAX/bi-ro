import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { TopologyCanvas, type TopologyNode, type TopologyEdge } from '../components/TopologyCanvas.tsx'
import { api, ApiError } from '../lib/api.ts'

interface TopologyPageProps {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

interface TopologyData {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

export function TopologyPage({ user, appTitle, onNavigate, onLogout }: TopologyPageProps) {
  const [data, setData] = useState<TopologyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [accessibilityMode, setAccessibilityMode] = useState(false)

  const fetchTopology = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.get<TopologyData>('/topology')
      setData(result)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load topology')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchTopology() }, [fetchTopology])

  // Compute blast radius: selected node + all directly connected nodes via edges
  const blastRadius = (() => {
    if (!selectedNodeId || !data) return []
    const ids = new Set<string>([selectedNodeId])
    for (const edge of data.edges) {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        ids.add(edge.source)
        ids.add(edge.target)
      }
    }
    return Array.from(ids)
  })()

  function handleNodeClick(id: string, _type: 'server' | 'app_instance') {
    setSelectedNodeId((prev) => (prev === id ? null : id))
  }

  return (
    <AppShell
      title={appTitle}
      currentPath="/topology"
      onNavigate={onNavigate}
      user={user}
      onLogout={onLogout}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
            Topology
          </h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selectedNodeId && (
              <button
                onClick={() => setSelectedNodeId(null)}
                style={{
                  height: 30,
                  padding: '0 12px',
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Clear selection
              </button>
            )}
            <button
              onClick={() => setAccessibilityMode((v) => !v)}
              aria-pressed={accessibilityMode}
              style={{
                height: 30,
                padding: '0 12px',
                background: accessibilityMode ? 'var(--accent-soft)' : 'none',
                border: `1px solid ${accessibilityMode ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-sm)',
                color: accessibilityMode ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {accessibilityMode ? 'Table view (on)' : 'Table view'}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 13,
              color: 'var(--danger)',
            }}
          >
            {error}
            <button
              onClick={() => { void fetchTopology() }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--danger)',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'inherit',
                textDecoration: 'underline',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Selected node info */}
        {selectedNodeId && data && (
          <div
            style={{
              padding: '8px 14px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ color: 'var(--text-muted)' }}>Selected:</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{selectedNodeId}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
              — {blastRadius.length} node{blastRadius.length !== 1 ? 's' : ''} highlighted
            </span>
          </div>
        )}

        {/* Canvas */}
        <TopologyCanvas
          nodes={data?.nodes ?? []}
          edges={data?.edges ?? []}
          loading={loading}
          blastRadius={blastRadius}
          accessibilityMode={accessibilityMode}
          onNodeClick={handleNodeClick}
        />

        {/* Stats */}
        {data && !loading && (
          <div
            style={{
              display: 'flex',
              gap: 16,
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            <span>
              {data.nodes.filter((n) => n.type === 'server').length} server
              {data.nodes.filter((n) => n.type === 'server').length !== 1 ? 's' : ''}
            </span>
            <span>
              {data.nodes.filter((n) => n.type === 'app_instance').length} app instance
              {data.nodes.filter((n) => n.type === 'app_instance').length !== 1 ? 's' : ''}
            </span>
            <span>
              {data.edges.length} connection
              {data.edges.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>
    </AppShell>
  )
}
