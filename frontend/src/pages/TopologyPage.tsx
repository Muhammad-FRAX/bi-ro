import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { TopologyCanvas, type TopologyNode, type TopologyEdge, type PortInfo } from '../components/TopologyCanvas.tsx'
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

interface ServerPanel {
  nodeId: string
  serverId: string
  label: string
  environment: string
  status: string
  ports: PortInfo[]
  apps: string[]
}

const PANEL_STYLE: CSSProperties = {
  width: 280,
  flexShrink: 0,
  background: 'var(--bg-elev)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

export function TopologyPage({ user, appTitle, onNavigate, onLogout }: TopologyPageProps) {
  const [data, setData] = useState<TopologyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [accessibilityMode, setAccessibilityMode] = useState(false)
  const [serverPanel, setServerPanel] = useState<ServerPanel | null>(null)

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

  // Blast radius: selected node + all directly connected nodes
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

  function handleNodeClick(id: string, type: 'server' | 'app_instance') {
    if (type === 'server' && data) {
      // Toggle: clicking the same server again closes the panel
      if (serverPanel?.nodeId === id) {
        setServerPanel(null)
        setSelectedNodeId(null)
        return
      }

      const node = data.nodes.find((n) => n.id === id)
      if (!node) return

      // Find all app instances running on this server
      const apps = data.nodes
        .filter((n) => n.type === 'app_instance' && n.data.serverId === node.data.serverId)
        .map((n) => n.data.label)

      setServerPanel({
        nodeId: id,
        serverId: node.data.serverId ?? '',
        label: node.data.label,
        environment: node.data.environment ?? '',
        status: node.data.status ?? '',
        ports: node.data.ports ?? [],
        apps,
      })
    } else {
      setServerPanel(null)
    }
    setSelectedNodeId((prev) => (prev === id ? null : id))
  }

  const envColor = (env: string) =>
    env === 'prod' ? 'var(--danger)' :
    env === 'staging' ? 'var(--warning)' :
    env === 'dev' ? 'var(--success)' :
    'var(--text-muted)'

  const statusDotColor = (s: string) =>
    s === 'active' ? 'var(--success)' :
    s === 'decommissioned' ? 'var(--text-subtle)' :
    'var(--warning)'

  const exposureColor = (exp: string) =>
    exp === 'external' ? 'var(--danger)' :
    exp === 'vpn' ? 'var(--warning)' :
    'var(--text-subtle)'

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Topology</h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selectedNodeId && (
              <button
                onClick={() => { setSelectedNodeId(null); setServerPanel(null) }}
                style={{ height: 30, padding: '0 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Clear selection
              </button>
            )}
            <button
              onClick={() => setAccessibilityMode((v) => !v)}
              aria-pressed={accessibilityMode}
              style={{ height: 30, padding: '0 12px', background: accessibilityMode ? 'var(--accent-soft)' : 'none', border: `1px solid ${accessibilityMode ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', color: accessibilityMode ? 'var(--accent)' : 'var(--text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {accessibilityMode ? 'Table view (on)' : 'Table view'}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div role="alert" style={{ padding: '10px 14px', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: 'var(--danger)' }}>
            {error}
            <button onClick={() => { void fetchTopology() }} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textDecoration: 'underline' }}>Retry</button>
          </div>
        )}

        {/* Canvas + server detail panel */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TopologyCanvas
              nodes={data?.nodes ?? []}
              edges={data?.edges ?? []}
              loading={loading}
              blastRadius={blastRadius}
              accessibilityMode={accessibilityMode}
              onNodeClick={handleNodeClick}
            />
          </div>

          {serverPanel && (
            <div style={PANEL_STYLE}>
              {/* Panel header */}
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 3 }}>Server</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {serverPanel.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDotColor(serverPanel.status), display: 'block', flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{serverPanel.status}</span>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: envColor(serverPanel.environment), background: `color-mix(in srgb, ${envColor(serverPanel.environment)} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${envColor(serverPanel.environment)} 25%, transparent)`, borderRadius: 3, padding: '1px 5px' }}>
                      {serverPanel.environment}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => { setServerPanel(null); setSelectedNodeId(null) }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}
                  aria-label="Close panel"
                >×</button>
              </div>

              {/* Scrollable body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Apps */}
                <section>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 6 }}>
                    Apps running · {serverPanel.apps.length}
                  </div>
                  {serverPanel.apps.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>No app instances</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {serverPanel.apps.map((app, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 8px', background: 'var(--bg-elev-2)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text)' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, display: 'block' }} />
                          {app}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Ports */}
                <section>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 6 }}>
                    Ports · {serverPanel.ports.length}
                  </div>
                  {serverPanel.ports.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>No ports configured</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {serverPanel.ports.map((p) => {
                        const ec = exposureColor(p.exposure)
                        return (
                          <div
                            key={p.number}
                            style={{ display: 'grid', gridTemplateColumns: '46px 34px 1fr auto', alignItems: 'center', gap: 6, padding: '6px 4px', borderBottom: '1px solid var(--border)' }}
                          >
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>:{p.number}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.protocol}</span>
                            <span style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.appLabel ?? '—'}</span>
                            <span style={{ fontSize: 10, color: ec, background: `color-mix(in srgb, ${ec} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${ec} 30%, transparent)`, borderRadius: 3, padding: '1px 4px', whiteSpace: 'nowrap' }}>
                              {p.exposure}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              </div>

              {/* Footer */}
              <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-subtle)' }}>
                {serverPanel.ports.length} port{serverPanel.ports.length !== 1 ? 's' : ''} · {serverPanel.apps.length} app{serverPanel.apps.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        {data && !loading && (
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>{data.nodes.filter((n) => n.type === 'server').length} server{data.nodes.filter((n) => n.type === 'server').length !== 1 ? 's' : ''}</span>
            <span>{data.nodes.filter((n) => n.type === 'app_instance').length} app instance{data.nodes.filter((n) => n.type === 'app_instance').length !== 1 ? 's' : ''}</span>
            <span>{data.edges.length} connection{data.edges.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </AppShell>
  )
}
