import { useState, type FormEvent } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { Button } from '../components/ui/Button.tsx'
import { api, ApiError } from '../lib/api.ts'

interface Props {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

interface KekRotationResult {
  ok: boolean
  rotated: number
}

interface BackupResult {
  backup: string
}

export function BackupPage({ user, appTitle, onNavigate, onLogout }: Props) {
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [backupSuccess, setBackupSuccess] = useState(false)

  const [restoreData, setRestoreData] = useState('')
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoreSuccess, setRestoreSuccess] = useState<Record<string, number> | null>(null)

  const [newKek, setNewKek] = useState('')
  const [kekLoading, setKekLoading] = useState(false)
  const [kekError, setKekError] = useState<string | null>(null)
  const [kekResult, setKekResult] = useState<KekRotationResult | null>(null)

  const isAdmin = user.permissions.includes('users.manage')

  async function handleBackup() {
    setBackupLoading(true)
    setBackupError(null)
    setBackupSuccess(false)
    try {
      const data = await api.post<BackupResult>('/admin/backup', {})
      // Download as file
      const blob = new Blob([data.backup], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `bi-ro-backup-${new Date().toISOString().slice(0, 10)}.bak`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setBackupSuccess(true)
    } catch (err) {
      setBackupError(err instanceof ApiError ? err.message : 'Backup failed')
    } finally {
      setBackupLoading(false)
    }
  }

  async function handleRestore(e: FormEvent) {
    e.preventDefault()
    if (!restoreData.trim()) return
    setRestoreLoading(true)
    setRestoreError(null)
    setRestoreSuccess(null)
    try {
      const data = await api.post<{ ok: boolean; counts: Record<string, number> }>(
        '/admin/restore',
        { backup: restoreData.trim() },
      )
      setRestoreSuccess(data.counts)
      setRestoreData('')
    } catch (err) {
      setRestoreError(err instanceof ApiError ? err.message : 'Restore failed')
    } finally {
      setRestoreLoading(false)
    }
  }

  async function handleKekRotation(e: FormEvent) {
    e.preventDefault()
    if (!newKek.trim()) return
    setKekLoading(true)
    setKekError(null)
    setKekResult(null)
    try {
      const data = await api.post<KekRotationResult>('/admin/kek-rotation', { newKek: newKek.trim() })
      setKekResult(data)
      setNewKek('')
    } catch (err) {
      setKekError(err instanceof ApiError ? err.message : 'KEK rotation failed')
    } finally {
      setKekLoading(false)
    }
  }

  if (!isAdmin) {
    return (
      <AppShell
        title={appTitle ?? 'BI Root'}
        currentPath="/backup"
        onNavigate={onNavigate}
        user={user}
        onLogout={onLogout}
      >
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Administrator access required.
        </div>
      </AppShell>
    )
  }

  const cardStyle = {
    background: 'var(--bg-elev)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '20px 24px',
    marginBottom: 20,
  }

  const sectionTitle = {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text)',
    marginBottom: 6,
  }

  const sectionDesc = {
    fontSize: 13,
    color: 'var(--text-muted)',
    marginBottom: 16,
  }

  const errorStyle = {
    padding: '10px 14px',
    background: 'color-mix(in srgb, var(--danger, #f87171) 10%, transparent)',
    border: '1px solid color-mix(in srgb, var(--danger, #f87171) 30%, transparent)',
    borderRadius: 6,
    color: 'var(--danger, #f87171)',
    fontSize: 13,
    marginTop: 12,
  }

  const successStyle = {
    padding: '10px 14px',
    background: 'color-mix(in srgb, var(--success, #34d399) 10%, transparent)',
    border: '1px solid color-mix(in srgb, var(--success, #34d399) 30%, transparent)',
    borderRadius: 6,
    color: 'var(--success, #34d399)',
    fontSize: 13,
    marginTop: 12,
  }

  return (
    <AppShell
      title={appTitle ?? 'BI Root'}
      currentPath="/backup"
      onNavigate={onNavigate}
      user={user}
      onLogout={onLogout}
    >
      <div style={{ maxWidth: 680 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
          Backup &amp; Restore
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 28 }}>
          Export an encrypted backup or restore from a previous one. Backups are AES-256-GCM
          encrypted with the current KEK.
        </p>

        {/* Backup */}
        <div style={cardStyle}>
          <div style={sectionTitle}>Export Backup</div>
          <div style={sectionDesc}>
            Downloads an encrypted backup file. The same KEK must be present on the target instance
            to restore. Secrets are exported encrypted — no plaintext is ever written to disk.
          </div>
          <Button onClick={() => void handleBackup()} disabled={backupLoading}>
            {backupLoading ? 'Exporting…' : 'Download Backup'}
          </Button>
          {backupError && <div style={errorStyle}>{backupError}</div>}
          {backupSuccess && <div style={successStyle}>Backup downloaded successfully.</div>}
        </div>

        {/* Restore */}
        <div style={cardStyle}>
          <div style={sectionTitle}>Restore from Backup</div>
          <div style={sectionDesc}>
            Paste the base64-encoded backup string below. The current KEK must match the one used
            when the backup was created. Existing records are upserted; passwords are NOT restored
            (users must reset them).
          </div>
          <form onSubmit={(e) => void handleRestore(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea
              placeholder="Paste base64 backup string here…"
              value={restoreData}
              onChange={(e) => setRestoreData(e.target.value)}
              rows={5}
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '10px 12px',
                fontSize: 12,
                color: 'var(--text)',
                fontFamily: 'monospace',
                resize: 'vertical',
              }}
            />
            <div>
              <Button type="submit" disabled={restoreLoading || !restoreData.trim()}>
                {restoreLoading ? 'Restoring…' : 'Restore'}
              </Button>
            </div>
          </form>
          {restoreError && <div style={errorStyle}>{restoreError}</div>}
          {restoreSuccess && (
            <div style={successStyle}>
              Restore complete.{' '}
              {Object.entries(restoreSuccess)
                .map(([k, v]) => `${v} ${k}`)
                .join(', ')}{' '}
              imported.
            </div>
          )}
        </div>

        {/* KEK Rotation */}
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--warning, #fbbf24) 40%, var(--border))' }}>
          <div style={{ ...sectionTitle, color: 'var(--warning, #fbbf24)' }}>
            KEK Rotation
          </div>
          <div style={sectionDesc}>
            Re-wraps all secret DEKs under a new Key Encryption Key. The actual encrypted
            ciphertext is NOT re-encrypted — only the DEK wrapper changes. After rotation, update
            BIRO_MASTER_KEK in your environment and restart the service.
          </div>
          <div
            style={{
              padding: '10px 14px',
              background: 'color-mix(in srgb, var(--warning, #fbbf24) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--warning, #fbbf24) 30%, transparent)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--warning, #fbbf24)',
              marginBottom: 16,
            }}
          >
            Warning: After rotation, update BIRO_MASTER_KEK immediately and restart. If you lose
            the new KEK before updating, secrets will be unrecoverable.
          </div>
          <form onSubmit={(e) => void handleKekRotation(e)} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6,
                }}
              >
                New KEK (base64, 32 bytes)
              </label>
              <input
                type="password"
                placeholder="base64-encoded 32-byte key"
                value={newKek}
                onChange={(e) => setNewKek(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 13,
                  color: 'var(--text)',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <Button type="submit" disabled={kekLoading || !newKek.trim()}>
              {kekLoading ? 'Rotating…' : 'Rotate KEK'}
            </Button>
          </form>
          {kekError && <div style={errorStyle}>{kekError}</div>}
          {kekResult && (
            <div style={successStyle}>
              KEK rotation complete. {kekResult.rotated} secret(s) re-wrapped. Update
              BIRO_MASTER_KEK and restart now.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
