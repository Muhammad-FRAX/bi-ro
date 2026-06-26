import { useState, useEffect, useCallback, useRef, Fragment, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { Button } from '../components/ui/Button.tsx'
import { RevealDialog } from '../components/RevealDialog.tsx'
import { api, ApiError } from '../lib/api.ts'
import { FolderTree } from '../components/FolderTree.tsx'
import type { FsTreeNode } from '../components/FolderTree.tsx'

interface Tag { id: string; name: string; color: string }
interface AppInstance {
  id: string; serverId: string; appId: string
  version: string | null; notes: string | null
  app: { name: string; category: string | null; logoUrl: string | null }
}
interface Port {
  id: string; serverId: string; appInstanceId: string | null
  number: number; protocol: string; appLabel: string | null
  exposure: string; status: string; description: string | null
  appName: string | null
}
interface Connection {
  id: string; fromAppInstanceId: string; toAppInstanceId: string
  label: string | null; protocol: string | null; notes: string | null
  from: { appName: string; serverHostname: string }
  to: { appName: string; serverHostname: string }
}
interface Server {
  id: string; hostname: string; environment: string; os: string | null
  location: string | null; cpuRamDisk: string | null; status: string
  ips: string[]; aliases: string[]; notes: string | null
  createdAt: string; updatedAt: string; tags: Tag[]
}

type Tab = 'overview' | 'ports' | 'connections' | 'filesystem' | 'credentials' | 'docs'

interface ServerSecret {
  id: string; vault_id: string; type: string; title: string
  username: string | null; host_url: string | null; days_remaining: number | null
  last_changed_at: string
}

interface Props {
  serverId: string
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

const BADGE: CSSProperties = {
  display: 'inline-block', padding: '2px 7px', borderRadius: 99,
  fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
}

function StatusBadge({ status }: { status: string }) {
  const c = status === 'active' ? 'var(--success)' : status === 'decommissioned' ? 'var(--text-subtle)' : 'var(--warning)'
  return (
    <span style={{ ...BADGE, color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 30%, transparent)` }}>
      {status}
    </span>
  )
}

function EnvBadge({ env }: { env: string }) {
  const c = env === 'prod' ? 'var(--danger)' : env === 'staging' ? 'var(--warning)' : env === 'dev' ? 'var(--success)' : 'var(--text-subtle)'
  return (
    <span style={{ ...BADGE, color: c, background: `color-mix(in srgb, ${c} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 25%, transparent)`, textTransform: 'uppercase', borderRadius: 4 }}>
      {env}
    </span>
  )
}

function ExposureBadge({ exposure }: { exposure: string }) {
  const c = exposure === 'external' ? 'var(--warning)' : exposure === 'localhost' ? 'var(--text-subtle)' : 'var(--accent)'
  return (
    <span style={{ ...BADGE, color: c, background: `color-mix(in srgb, ${c} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 25%, transparent)`, borderRadius: 4 }}>
      {exposure}
    </span>
  )
}

const FIELD_LABEL: CSSProperties = { fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 2 }
const FIELD_VALUE: CSSProperties = { fontSize: 13, color: 'var(--text)', fontFamily: 'inherit' }
const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 12 }

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p style={FIELD_LABEL}>{label}</p>
      <p style={FIELD_VALUE}>{children}</p>
    </div>
  )
}

export function ServerDetailPage({ serverId, user, appTitle, onNavigate, onLogout }: Props) {
  const [server, setServer] = useState<Server | null>(null)
  const [ports, setPorts] = useState<Port[]>([])
  const [instances, setInstances] = useState<AppInstance[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<ServerSecret[]>([])
  const [credsLoading, setCredsLoading] = useState(false)
  const [revealTarget, setRevealTarget] = useState<{ id: string; title: string } | null>(null)

  const canWrite = user.permissions.includes('servers.write')
  const canReveal = user.permissions.includes('secrets.reveal')
  const canViewSecrets = user.permissions.includes('secrets.view')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [srvData, portsData, instancesData] = await Promise.all([
        api.get<{ server: Server }>(`/servers/${serverId}`),
        api.get<{ ports: Port[] }>(`/servers/${serverId}/ports`),
        api.get<{ instances: AppInstance[] }>(`/servers/${serverId}/app-instances`),
      ])
      setServer(srvData.server)
      setPorts(portsData.ports)
      setInstances(instancesData.instances)

      // Fetch connections for all instances
      if (instancesData.instances.length > 0) {
        const connResults = await Promise.all(
          instancesData.instances.map((inst) =>
            api.get<{ connections: Connection[] }>(`/app-instances/${inst.id}/connections`),
          ),
        )
        const seen = new Set<string>()
        const unique: Connection[] = []
        for (const r of connResults) {
          for (const c of r.connections) {
            if (!seen.has(c.id)) { seen.add(c.id); unique.push(c) }
          }
        }
        setConnections(unique)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load server')
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => { void fetchAll() }, [fetchAll])

  async function loadCredentials() {
    if (!serverId) return
    setCredsLoading(true)
    try {
      // Fetch secrets linked to this server
      const data = await api.get<ServerSecret[]>(`/servers/${serverId}/secrets`)
      setCredentials(data)
    } catch {
      // Viewer without secrets.view will get 403 — silently ignore
    } finally {
      setCredsLoading(false)
    }
  }

  const TAB_STYLE = (active: boolean): CSSProperties => ({
    height: 34, padding: '0 14px', background: 'none',
    border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer',
    fontFamily: 'inherit', transition: 'color 120ms, border-color 120ms',
  })

  if (loading) {
    return (
      <AppShell title={appTitle} currentPath="/servers" onNavigate={onNavigate} user={user} onLogout={onLogout}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[120, 80, 60, 100].map((w, i) => (
            <div key={i} style={{ height: 16, width: `${w}%`, maxWidth: w * 6, background: 'var(--bg-elev)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }`}</style>
      </AppShell>
    )
  }

  if (error || !server) {
    return (
      <AppShell title={appTitle} currentPath="/servers" onNavigate={onNavigate} user={user} onLogout={onLogout}>
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <p style={{ color: 'var(--danger)', fontSize: 14 }}>{error ?? 'Server not found'}</p>
          <button onClick={() => void fetchAll()} style={{ marginTop: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 14px', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
            Retry
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title={appTitle} currentPath="/servers" onNavigate={onNavigate} user={user} onLogout={onLogout}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => onNavigate?.('/servers')}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
          >
            Servers
          </button>
          <span style={{ color: 'var(--text-subtle)', fontSize: 13 }}>/</span>
          <span style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{server.hostname}</span>
          <EnvBadge env={server.environment} />
          <StatusBadge status={server.status} />
        </div>

        {/* Tab bar */}
        <div style={{ borderBottom: '1px solid var(--border)', display: 'flex', gap: 0 }}>
          <button style={TAB_STYLE(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
          <button style={TAB_STYLE(tab === 'ports')} onClick={() => setTab('ports')}>
            Ports &amp; Apps{ports.length > 0 ? ` (${ports.length})` : ''}
          </button>
          <button style={TAB_STYLE(tab === 'connections')} onClick={() => setTab('connections')}>
            Connections{connections.length > 0 ? ` (${connections.length})` : ''}
          </button>
          <button style={TAB_STYLE(tab === 'filesystem')} onClick={() => setTab('filesystem')}>
            Filesystem
          </button>
          {canViewSecrets && (
            <button style={TAB_STYLE(tab === 'credentials')} onClick={() => {
              setTab('credentials')
              void loadCredentials()
            }}>
              Credentials{credentials.length > 0 ? ` (${credentials.length})` : ''}
            </button>
          )}
          <button style={TAB_STYLE(tab === 'docs')} onClick={() => setTab('docs')}>
            Docs
          </button>
        </div>

        {/* Overview tab */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: 20,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 16,
              }}
            >
              <Field label="Hostname">
                <span style={MONO}>{server.hostname}</span>
              </Field>
              <Field label="OS">{server.os ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}</Field>
              <Field label="Location">{server.location ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}</Field>
              {server.cpuRamDisk && (
                <Field label="Specs">{server.cpuRamDisk}</Field>
              )}
              {server.ips.length > 0 && (
                <Field label="IPs">
                  {server.ips.map((ip) => <span key={ip} style={{ ...MONO, display: 'block' }}>{ip}</span>)}
                </Field>
              )}
              {server.aliases.length > 0 && (
                <Field label="Aliases">
                  {server.aliases.map((a) => <span key={a} style={{ ...MONO, display: 'block' }}>{a}</span>)}
                </Field>
              )}
              {server.tags.length > 0 && (
                <Field label="Tags">
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {server.tags.map((t) => (
                      <span
                        key={t.id}
                        style={{
                          padding: '1px 6px', borderRadius: 4, fontSize: 11,
                          color: t.color, background: `color-mix(in srgb, ${t.color} 12%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${t.color} 30%, transparent)`,
                        }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </Field>
              )}
            </div>
            {server.notes && (
              <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 20px' }}>
                <p style={{ ...FIELD_LABEL, marginBottom: 6 }}>Notes</p>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{server.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Ports & Apps tab */}
        {tab === 'ports' && (
          <PortsTab
            serverId={serverId}
            ports={ports}
            instances={instances}
            canWrite={canWrite}
            onRefresh={fetchAll}
          />
        )}

        {/* Connections tab */}
        {tab === 'connections' && (
          <ConnectionsTab
            connections={connections}
            instances={instances}
            canWrite={canWrite}
            onRefresh={fetchAll}
            onNavigate={onNavigate}
          />
        )}

        {/* Filesystem tab */}
        {tab === 'filesystem' && (
          <FilesystemTab serverId={serverId} canWrite={canWrite} />
        )}

        {/* Credentials tab — §4.4 server detail "credentials" tab */}
        {tab === 'credentials' && canViewSecrets && (
          <CredentialsTab
            credentials={credentials}
            loading={credsLoading}
            canReveal={canReveal}
            onReveal={(id, title) => setRevealTarget({ id, title })}
            onNavigate={onNavigate}
          />
        )}

        {/* Docs tab */}
        {tab === 'docs' && (
          <DocsTab serverId={serverId} canWrite={canWrite} />
        )}

        {revealTarget && (
          <RevealDialog
            secretId={revealTarget.id}
            secretTitle={revealTarget.title}
            onClose={() => setRevealTarget(null)}
          />
        )}
      </div>
    </AppShell>
  )
}

// ── Filesystem tab ────────────────────────────────────────────────────────────

interface FsSnapshot {
  id: string
  serverId: string
  rootPath: string
  maxDepth: number
  host: string
  generatedAt: string
  createdAt: string
  nodeCount: number
}

interface FsNode {
  id: string
  path: string
  type: 'dir' | 'file'
  size: number | null
  mtime: string | null
  linkedType: string | null
  linkedId: string | null
}

interface FilesystemTabProps {
  serverId: string
  canWrite: boolean
}

function FilesystemTab({ serverId, canWrite }: FilesystemTabProps) {
  // Generate script state
  const [genRoot, setGenRoot] = useState('/')
  const [genDepth, setGenDepth] = useState('3')
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [bash, setBash] = useState<string | null>(null)
  const [ps1, setPs1] = useState<string | null>(null)

  // Import state
  const [importJson, setImportJson] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<FsSnapshot | null>(null)

  // Snapshots list state
  const [snapshots, setSnapshots] = useState<FsSnapshot[] | null>(null)
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [selectedSnapshot, setSelectedSnapshot] = useState<{ snapshot: FsSnapshot; nodes: FsNode[] } | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  const INPUT: CSSProperties = {
    height: 28, padding: '0 8px', background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none',
  }
  const SECTION: CSSProperties = {
    background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16,
  }

  async function handleGenerate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setGenError(null)
    setBash(null)
    setPs1(null)
    setGenLoading(true)
    try {
      const data = await api.post<{ bash: string; ps1: string }>(
        `/servers/${serverId}/fs/generate-script`,
        { root: genRoot, maxDepth: parseInt(genDepth, 10) },
      )
      setBash(data.bash)
      setPs1(data.ps1)
    } catch (err) {
      setGenError(err instanceof ApiError ? err.message : 'Failed to generate script')
    } finally {
      setGenLoading(false)
    }
  }

  const loadSnapshots = useCallback(async () => {
    setSnapshotsLoading(true)
    try {
      const data = await api.get<{ snapshots: FsSnapshot[] }>(`/servers/${serverId}/fs/snapshots`)
      setSnapshots(data.snapshots)
    } catch {
      // silently fail
    } finally {
      setSnapshotsLoading(false)
    }
  }, [serverId])

  useEffect(() => { void loadSnapshots() }, [loadSnapshots])

  async function handleImport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setImportError(null)
    setImportResult(null)
    setImportLoading(true)
    try {
      const data = await api.post<{ snapshot: FsSnapshot }>(
        `/servers/${serverId}/fs/import`,
        { json: importJson },
      )
      setImportResult(data.snapshot)
      setImportJson('')
      // Refresh snapshots list
      void loadSnapshots()
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : 'Import failed')
    } finally {
      setImportLoading(false)
    }
  }

  async function handleSelectSnapshot(snap: FsSnapshot) {
    if (selectedSnapshot?.snapshot.id === snap.id) {
      setSelectedSnapshot(null)
      return
    }
    setSnapshotLoading(true)
    try {
      const data = await api.get<{ snapshot: FsSnapshot; nodes: FsNode[] }>(
        `/servers/${serverId}/fs/snapshots/${snap.id}`,
      )
      setSelectedSnapshot(data)
    } catch {
      // silently fail
    } finally {
      setSnapshotLoading(false)
    }
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text)
  }

  const TR: CSSProperties = { height: 32, borderBottom: '1px solid var(--border)' }
  const TD: CSSProperties = { padding: '0 10px', fontSize: 12, color: 'var(--text)' }
  const TH: CSSProperties = { ...TD, fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Generate Script */}
      <div style={SECTION}>
        <p style={{ ...FIELD_LABEL, marginBottom: 10 }}>Generate Collection Script</p>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          Run this script on the target server to collect its filesystem tree and paste the output below.
        </p>
        <form onSubmit={(e) => { void handleGenerate(e) }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {genError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{genError}</p>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', flex: '1 1 200px' }}>
              Root path
              <input
                value={genRoot}
                onChange={(e) => setGenRoot(e.target.value)}
                placeholder="/"
                required
                style={INPUT}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', flex: '0 0 100px' }}>
              Max depth
              <input
                type="number" min={1} max={20}
                value={genDepth}
                onChange={(e) => setGenDepth(e.target.value)}
                style={INPUT}
              />
            </label>
            <button
              type="submit"
              disabled={genLoading}
              style={{ height: 28, padding: '0 12px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: genLoading ? 0.6 : 1 }}
            >
              {genLoading ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </form>

        {bash && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Bash (Linux/macOS)</span>
                <button onClick={() => copyToClipboard(bash!)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', padding: '2px 8px', fontFamily: 'inherit' }}>Copy</button>
              </div>
              <textarea
                readOnly
                value={bash}
                rows={6}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: 8, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>PowerShell (Windows)</span>
                <button onClick={() => copyToClipboard(ps1!)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', padding: '2px 8px', fontFamily: 'inherit' }}>Copy</button>
              </div>
              <textarea
                readOnly
                value={ps1!}
                rows={6}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: 8, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Import Snapshot */}
      {canWrite && (
        <div style={SECTION}>
          <p style={{ ...FIELD_LABEL, marginBottom: 10 }}>Import Snapshot</p>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            Paste the JSON output from the collection script here and click Import.
          </p>
          <form onSubmit={(e) => { void handleImport(e) }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {importError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{importError}</p>}
            {importResult && (
              <div style={{ padding: '8px 10px', background: 'color-mix(in srgb, var(--success) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--success)' }}>
                Imported snapshot <span style={{ fontFamily: 'var(--font-mono)' }}>{importResult.id.slice(0, 8)}…</span> with {importResult.nodeCount} nodes.
              </div>
            )}
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder={'Paste JSON output here…\n{"schema":"bi-ro.fstree.v1", ...}'}
              rows={8}
              required
              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-elev-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: 8, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={importLoading || !importJson.trim()}
                style={{ height: 28, padding: '0 12px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: (importLoading || !importJson.trim()) ? 0.6 : 1 }}
              >
                {importLoading ? 'Importing…' : 'Import'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Snapshots list */}
      <div style={SECTION}>
        <p style={{ ...FIELD_LABEL, marginBottom: 10 }}>Snapshots</p>
        {snapshotsLoading && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>}
        {snapshots !== null && snapshots.length === 0 && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No snapshots yet. Generate and import a script to capture this server's filesystem.</p>
        )}
        {snapshots !== null && snapshots.length > 0 && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={TH}>Root path</th>
                  <th style={TH}>Host</th>
                  <th style={TH}>Depth</th>
                  <th style={TH}>Nodes</th>
                  <th style={TH}>Generated</th>
                  <th style={TH} />
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snap) => (
                  <Fragment key={snap.id}>
                    <tr
                      style={{ ...TR, cursor: 'pointer', background: selectedSnapshot?.snapshot.id === snap.id ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : undefined }}
                      onClick={() => { void handleSelectSnapshot(snap) }}
                    >
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{snap.rootPath}</td>
                      <td style={{ ...TD, color: 'var(--text-muted)' }}>{snap.host}</td>
                      <td style={{ ...TD, color: 'var(--text-muted)' }}>{snap.maxDepth}</td>
                      <td style={{ ...TD, color: 'var(--text-muted)' }}>{snap.nodeCount.toLocaleString()}</td>
                      <td style={{ ...TD, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{new Date(snap.generatedAt).toLocaleString()}</td>
                      <td style={{ ...TD, color: 'var(--accent)', fontSize: 11 }}>
                        {selectedSnapshot?.snapshot.id === snap.id ? 'Collapse' : 'View'}
                      </td>
                    </tr>
                    {selectedSnapshot?.snapshot.id === snap.id && (
                      <tr key={`${snap.id}-detail`}>
                        <td colSpan={6} style={{ padding: '8px 10px', background: 'var(--bg-elev)' }}>
                          {snapshotLoading ? (
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Loading nodes…</p>
                          ) : (
                            <FolderTree
                              nodes={selectedSnapshot.nodes as FsTreeNode[]}
                              snapshotId={selectedSnapshot.snapshot.id}
                              host={selectedSnapshot.snapshot.host}
                              rootPath={selectedSnapshot.snapshot.rootPath}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Ports tab ──────────────────────────────────────────────────────────────────

interface PortsTabProps {
  serverId: string
  ports: Port[]
  instances: AppInstance[]
  canWrite: boolean
  onRefresh: () => void
}

function PortsTab({ serverId, ports, instances, canWrite, onRefresh }: PortsTabProps) {
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const INPUT: CSSProperties = {
    height: 28, padding: '0 8px', background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none',
  }
  const SELECT: CSSProperties = { ...INPUT, cursor: 'pointer' }

  async function handleAddPort(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    const fd = new FormData(e.currentTarget)
    try {
      await api.post(`/servers/${serverId}/ports`, {
        number: parseInt(fd.get('number') as string, 10),
        protocol: fd.get('protocol') as string,
        appLabel: (fd.get('appLabel') as string).trim() || undefined,
        exposure: fd.get('exposure') as string,
        description: (fd.get('description') as string).trim() || undefined,
        appInstanceId: (fd.get('appInstanceId') as string) || undefined,
      })
      setShowForm(false)
      onRefresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to add port')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeletePort(portId: string) {
    try { await api.delete(`/ports/${portId}`); onRefresh() } catch { /* handled by refresh */ }
  }

  const TR: CSSProperties = { height: 34, borderBottom: '1px solid var(--border)' }
  const TD: CSSProperties = { padding: '0 10px', fontSize: 13, color: 'var(--text)' }
  const TH: CSSProperties = { ...TD, fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          {ports.length} port{ports.length !== 1 ? 's' : ''} configured
        </p>
        {canWrite && (
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{ height: 28, padding: '0 10px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {showForm ? 'Cancel' : '+ Add port'}
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { void handleAddPort(e) }}
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {formError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{formError}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              Port number *
              <input name="number" type="number" min={1} max={65535} required placeholder="5432" style={INPUT} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              Protocol
              <select name="protocol" defaultValue="tcp" style={SELECT}>
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              Exposure
              <select name="exposure" defaultValue="internal" style={SELECT}>
                <option value="internal">internal</option>
                <option value="external">external</option>
                <option value="localhost">localhost</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              App label
              <input name="appLabel" placeholder="PostgreSQL" style={INPUT} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              App instance
              <select name="appInstanceId" style={SELECT}>
                <option value="">— none —</option>
                {instances.map((inst) => (
                  <option key={inst.id} value={inst.id}>{inst.app.name}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
              Description
              <input name="description" placeholder="What runs on this port" style={INPUT} />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="submit"
              disabled={submitting}
              style={{ height: 28, padding: '0 12px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: submitting ? 0.6 : 1 }}
            >
              {submitting ? 'Adding…' : 'Add port'}
            </button>
          </div>
        </form>
      )}

      {ports.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>No ports configured.</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Add a port to document what services run on this server.</p>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={TH}>Port</th>
                <th style={TH}>Proto</th>
                <th style={TH}>App / Label</th>
                <th style={TH}>Exposure</th>
                <th style={TH}>Description</th>
                {canWrite && <th style={TH} />}
              </tr>
            </thead>
            <tbody>
              {ports.map((p) => (
                <tr key={p.id} style={TR}>
                  <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--accent)' }}>{p.number}</td>
                  <td style={{ ...TD, color: 'var(--text-muted)' }}>{p.protocol}</td>
                  <td style={TD}>{p.appName ?? p.appLabel ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                  <td style={TD}><ExposureBadge exposure={p.exposure} /></td>
                  <td style={{ ...TD, color: 'var(--text-muted)' }}>{p.description ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                  {canWrite && (
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <button
                        onClick={() => { void handleDeletePort(p.id) }}
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 6px' }}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Connections tab ────────────────────────────────────────────────────────────

interface ConnectionsTabProps {
  connections: Connection[]
  instances: AppInstance[]
  canWrite: boolean
  onRefresh: () => void
  onNavigate?: (path: string) => void
}

function ConnectionsTab({ connections, instances, canWrite, onRefresh, onNavigate: _onNavigate }: ConnectionsTabProps) {
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const INPUT: CSSProperties = {
    height: 28, padding: '0 8px', background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none',
  }

  async function handleAddConnection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    const fd = new FormData(e.currentTarget)
    try {
      await api.post('/connections', {
        fromAppInstanceId: fd.get('fromAppInstanceId') as string,
        toAppInstanceId: fd.get('toAppInstanceId') as string,
        label: (fd.get('label') as string).trim() || undefined,
        protocol: (fd.get('protocol') as string).trim() || undefined,
        notes: (fd.get('notes') as string).trim() || undefined,
      })
      setShowForm(false)
      onRefresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to add connection')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteConnection(connId: string) {
    try { await api.delete(`/connections/${connId}`); onRefresh() } catch { /* handled by refresh */ }
  }

  const TR: CSSProperties = { height: 34, borderBottom: '1px solid var(--border)' }
  const TD: CSSProperties = { padding: '0 10px', fontSize: 13, color: 'var(--text)' }
  const TH: CSSProperties = { ...TD, fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          {connections.length} connection{connections.length !== 1 ? 's' : ''}
        </p>
        {canWrite && instances.length >= 1 && (
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{ height: 28, padding: '0 10px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {showForm ? 'Cancel' : '+ Add connection'}
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { void handleAddConnection(e) }}
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {formError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{formError}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              From app instance *
              <select name="fromAppInstanceId" required style={{ ...INPUT, cursor: 'pointer' }}>
                <option value="">Select…</option>
                {instances.map((i) => <option key={i.id} value={i.id}>{i.app.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              To (enter app-instance ID)
              <input name="toAppInstanceId" required placeholder="app-instance UUID" style={INPUT} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              Label
              <input name="label" placeholder="reads from / JDBC" style={INPUT} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              Protocol
              <input name="protocol" placeholder="HTTPS / JDBC / SMTP" style={INPUT} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
              Notes
              <input name="notes" placeholder="Optional notes" style={INPUT} />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={submitting}
              style={{ height: 28, padding: '0 12px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: submitting ? 0.6 : 1 }}
            >
              {submitting ? 'Adding…' : 'Add connection'}
            </button>
          </div>
        </form>
      )}

      {connections.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>No connections documented.</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Add app instances first, then document how they connect to other services.</p>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={TH}>From</th>
                <th style={TH}>→</th>
                <th style={TH}>To</th>
                <th style={TH}>Label</th>
                <th style={TH}>Protocol</th>
                {canWrite && <th style={TH} />}
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id} style={TR}>
                  <td style={TD}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>{c.from.appName}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'block' }}>{c.from.serverHostname}</span>
                  </td>
                  <td style={{ ...TD, color: 'var(--text-subtle)' }}>→</td>
                  <td style={TD}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>{c.to.appName}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'block' }}>{c.to.serverHostname}</span>
                  </td>
                  <td style={{ ...TD, color: 'var(--text-muted)' }}>{c.label ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                  <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.protocol ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                  {canWrite && (
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <button
                        onClick={() => { void handleDeleteConnection(c.id) }}
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 6px' }}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Credentials tab ───────────────────────────────────────────────────────────

interface CredentialsTabProps {
  credentials: ServerSecret[]
  loading: boolean
  canReveal: boolean
  onReveal: (id: string, title: string) => void
  onNavigate?: (path: string) => void
}

const BADGE_CREDS: CSSProperties = {
  display: 'inline-block', padding: '2px 7px', borderRadius: 99,
  fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
}

function DaysRemainingBadgeCreds({ days }: { days: number | null }) {
  if (days === null) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
  const c = days < 0 ? 'var(--danger)' : days <= 7 ? 'var(--warning)' : 'var(--success)'
  return (
    <span style={{ ...BADGE_CREDS, color: c, background: `color-mix(in srgb, ${c} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 25%, transparent)`, fontVariantNumeric: 'tabular-nums' }}>
      {days < 0 ? `${Math.abs(Math.round(days))}d overdue` : `${Math.round(days)}d`}
    </span>
  )
}

function CredentialsTab({ credentials, loading, canReveal, onReveal, onNavigate }: CredentialsTabProps) {
  const TR: CSSProperties = { height: 34, borderBottom: '1px solid var(--border)' }
  const TD: CSSProperties = { padding: '0 10px', fontSize: 13, color: 'var(--text)' }
  const TH: CSSProperties = { ...TD, fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }

  if (loading) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '16px 0' }}>Loading credentials…</div>
  }

  if (credentials.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>
        No credentials linked to this server. Add a secret in a vault and link it to this server.
      </div>
    )
  }

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={TH}>Title</th>
            <th style={TH}>Type</th>
            <th style={TH}>Username</th>
            <th style={TH}>Last changed</th>
            <th style={TH}>Expires in</th>
            <th style={TH} />
          </tr>
        </thead>
        <tbody>
          {credentials.map((s) => (
            <tr key={s.id} style={TR}>
              <td style={TD}>
                <button
                  onClick={() => onNavigate?.(`/secrets/${s.id}`)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontFamily: 'inherit', padding: 0 }}
                >
                  {s.title}
                </button>
              </td>
              <td style={{ ...TD, fontSize: 12, color: 'var(--text-muted)' }}>{s.type.replace('_', ' ')}</td>
              <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{s.username ?? '—'}</td>
              <td style={{ ...TD, fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {new Date(s.last_changed_at).toLocaleDateString()}
              </td>
              <td style={TD}><DaysRemainingBadgeCreds days={s.days_remaining} /></td>
              <td style={{ ...TD, textAlign: 'right' }}>
                {canReveal && (
                  <Button size="sm" intent="secondary" onClick={() => onReveal(s.id, s.title)}>
                    Reveal
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Docs tab ──────────────────────────────────────────────────────────────────

interface DocRecord {
  id: string
  filename: string
  mime: string
  size: number
  uploaded_at: string
}

const ALLOWED_MIME_LABELS_SD: Record<string, string> = {
  'text/plain': 'TXT', 'text/markdown': 'MD', 'text/x-markdown': 'MD',
  'application/pdf': 'PDF', 'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/gif': 'GIF',
  'image/webp': 'WEBP', 'image/svg+xml': 'SVG',
}

function formatBytesSD(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DocsTab({ serverId, canWrite }: { serverId: string; canWrite: boolean }) {
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const data = await api.get<DocRecord[]>(`/documents?linkedType=server&linkedId=${serverId}`)
      setDocs(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [serverId])

  async function handleUpload(e: FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) { setUploadError('Select a file first'); return }
    setUploading(true); setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('linkedType', 'server')
      form.append('linkedId', serverId)
      const res = await fetch('/api/documents', { method: 'POST', credentials: 'same-origin', body: form })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const TH: CSSProperties = { padding: '0 10px', fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, textAlign: 'left' }
  const TD: CSSProperties = { padding: '0 10px', fontSize: 13, color: 'var(--text)', height: 34 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canWrite && (
        <form onSubmit={(e) => void handleUpload(e)}
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input ref={fileRef} type="file"
              accept=".txt,.md,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg"
              style={{ color: 'var(--text)', fontSize: 13 }} />
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-subtle)' }}>
              txt, md, pdf, doc, docx, png, jpg · Max 10 MB
            </p>
          </div>
          <button type="submit" disabled={uploading}
            style={{ height: 28, padding: '0 12px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: uploading ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : 'Attach'}
          </button>
          {uploadError && <p style={{ width: '100%', margin: 0, fontSize: 12, color: 'var(--danger)' }}>{uploadError}</p>}
        </form>
      )}

      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
      {loading && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>}
      {!loading && docs.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          No documents attached. {canWrite ? 'Upload one above.' : ''}
        </p>
      )}
      {!loading && docs.length > 0 && (
        <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={TH}>Filename</th>
                <th style={TH}>Type</th>
                <th style={TH}>Size</th>
                <th style={TH}>Uploaded</th>
                <th style={TH} />
              </tr>
            </thead>
            <tbody>
              {docs.map(doc => (
                <tr key={doc.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={TD}>
                    <a href={`/api/documents/${doc.id}/view`} target="_blank" rel="noreferrer"
                      style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {doc.filename}
                    </a>
                  </td>
                  <td style={{ ...TD, fontSize: 12, color: 'var(--text-muted)' }}>
                    {ALLOWED_MIME_LABELS_SD[doc.mime] ?? doc.mime.split('/')[1]?.toUpperCase()}
                  </td>
                  <td style={{ ...TD, fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatBytesSD(doc.size)}
                  </td>
                  <td style={{ ...TD, fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(doc.uploaded_at).toLocaleDateString()}
                  </td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    <a href={`/api/documents/${doc.id}/download`} download={doc.filename}
                      style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                      ↓
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
