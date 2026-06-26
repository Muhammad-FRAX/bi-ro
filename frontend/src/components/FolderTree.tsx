import { useState, useMemo, type CSSProperties } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FsTreeNode {
  id: string
  path: string
  type: 'dir' | 'file'
  size: number | null
  mtime: string | null
  linkedType: 'script' | 'app' | null
  linkedId: string | null
}

export interface FolderTreeProps {
  nodes: FsTreeNode[]
  snapshotId: string
  host?: string
  rootPath?: string
  onLinkNode?: (nodeId: string, linkedType: 'script' | 'app', linkedId: string) => void
}

// ── Internal tree structure ───────────────────────────────────────────────────

interface TreeEntry {
  node: FsTreeNode
  depth: number
  children: TreeEntry[]
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function parentPath(p: string): string {
  // Normalize: strip trailing slash except for root "/"
  const normalized = p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return normalized.slice(0, lastSlash)
}

function baseName(p: string): string {
  const normalized = p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash < 0) return normalized
  return normalized.slice(lastSlash + 1)
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatMtime(mtime: string | null): string {
  if (!mtime) return ''
  const d = new Date(mtime)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function buildTreeEntries(nodes: FsTreeNode[]): TreeEntry[] {
  if (nodes.length === 0) return []

  // Sort by path so parents always come before children
  const sorted = [...nodes].sort((a, b) => a.path.localeCompare(b.path))

  // Build path -> TreeEntry map
  const map = new Map<string, TreeEntry>()
  for (const node of sorted) {
    map.set(node.path, { node, depth: 0, children: [] })
  }

  // Determine roots: nodes whose parent path is not in the map
  const roots: TreeEntry[] = []
  for (const node of sorted) {
    const parent = parentPath(node.path)
    if (parent === node.path) {
      // This IS the root (e.g. "/" whose parent is "/")
      roots.push(map.get(node.path)!)
    } else {
      const parentEntry = map.get(parent)
      if (parentEntry) {
        parentEntry.children.push(map.get(node.path)!)
      } else {
        // Orphan node — treat as root
        roots.push(map.get(node.path)!)
      }
    }
  }

  // Assign depths recursively
  function assignDepths(entry: TreeEntry, depth: number) {
    entry.depth = depth
    for (const child of entry.children) {
      assignDepths(child, depth + 1)
    }
  }
  for (const root of roots) assignDepths(root, 0)

  return roots
}

// Flatten to a list of visible entries respecting collapsed state
function flattenVisible(
  entries: TreeEntry[],
  collapsed: Set<string>,
): TreeEntry[] {
  const result: TreeEntry[] = []
  function walk(list: TreeEntry[]) {
    for (const entry of list) {
      result.push(entry)
      if (entry.node.type === 'dir' && !collapsed.has(entry.node.path)) {
        walk(entry.children)
      }
    }
  }
  walk(entries)
  return result
}

// Collect all dir paths at depth <= maxDepth
function collectDirsAtDepth(entries: TreeEntry[], maxDepth: number): string[] {
  const result: string[] = []
  function walk(list: TreeEntry[]) {
    for (const entry of list) {
      if (entry.node.type === 'dir') {
        if (entry.depth <= maxDepth) result.push(entry.node.path)
        walk(entry.children)
      }
    }
  }
  walk(entries)
  return result
}

// For search: collect all entries matching query plus their ancestor paths
function filteredEntries(
  entries: TreeEntry[],
  query: string,
): { visible: TreeEntry[]; ancestorPaths: Set<string> } {
  const q = query.toLowerCase()
  const matching: TreeEntry[] = []

  function walk(list: TreeEntry[]) {
    for (const entry of list) {
      if (entry.node.path.toLowerCase().includes(q)) {
        matching.push(entry)
      }
      walk(entry.children)
    }
  }
  walk(entries)

  // For each match, collect all ancestor paths so we can show them
  const ancestorPaths = new Set<string>()
  for (const entry of matching) {
    let p = parentPath(entry.node.path)
    while (p !== entry.node.path) {
      ancestorPaths.add(p)
      const next = parentPath(p)
      if (next === p) break
      p = next
    }
  }

  // Build a flat list: ancestor dirs + matching nodes, deduplicated, sorted by path
  const allPaths = new Set<string>()
  const result: TreeEntry[] = []

  // We need to look up entries by path
  const byPath = new Map<string, TreeEntry>()
  function indexAll(list: TreeEntry[]) {
    for (const e of list) { byPath.set(e.node.path, e); indexAll(e.children) }
  }
  indexAll(entries)

  // Add ancestor dir entries first (in path order), then matching
  const combined = [
    ...[...ancestorPaths].map((p) => byPath.get(p)).filter((e): e is TreeEntry => !!e),
    ...matching,
  ]
  combined.sort((a, b) => a.node.path.localeCompare(b.node.path))

  for (const e of combined) {
    if (!allPaths.has(e.node.path)) {
      allPaths.add(e.node.path)
      result.push(e)
    }
  }

  return { visible: result, ancestorPaths }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FolderTree({ nodes, snapshotId: _snapshotId, host, rootPath, onLinkNode: _onLinkNode }: FolderTreeProps) {
  const treeEntries = useMemo(() => buildTreeEntries(nodes), [nodes])

  // Initially collapse dirs deeper than depth 2
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const all: string[] = []
    function walk(list: TreeEntry[]) {
      for (const e of list) {
        if (e.node.type === 'dir' && e.depth > 2) all.push(e.node.path)
        walk(e.children)
      }
    }
    walk(treeEntries)
    return new Set(all)
  })

  const [search, setSearch] = useState('')

  // Recompute collapsed when tree changes (new nodes prop)
  const initiallyCollapsedPaths = useMemo(() => {
    const paths: string[] = []
    function walk(list: TreeEntry[]) {
      for (const e of list) {
        if (e.node.type === 'dir' && e.depth > 2) paths.push(e.node.path)
        walk(e.children)
      }
    }
    walk(treeEntries)
    return new Set(paths)
  }, [treeEntries])

  // Keep collapsed state in sync when nodes change
  const effectiveCollapsed = collapsed.size > 0 ? collapsed : initiallyCollapsedPaths

  const visibleRows = useMemo(() => {
    const q = search.trim()
    if (!q) return flattenVisible(treeEntries, effectiveCollapsed)
    return filteredEntries(treeEntries, q).visible
  }, [treeEntries, effectiveCollapsed, search])

  function toggleDir(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function expandAll() {
    setCollapsed(new Set())
  }

  function collapseAll() {
    const allDirs = collectDirsAtDepth(treeEntries, Infinity)
    setCollapsed(new Set(allDirs))
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const containerStyle: CSSProperties = {
    background: 'var(--bg-elev)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
  }

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-elev-2)',
    flexWrap: 'wrap',
  }

  const pillStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-muted)',
    background: 'color-mix(in srgb, var(--border) 50%, transparent)',
    border: '1px solid var(--border)',
    fontFamily: 'var(--font-mono)',
    whiteSpace: 'nowrap',
  }

  const searchStyle: CSSProperties = {
    flex: '1 1 180px',
    height: 26,
    padding: '0 8px',
    background: 'var(--bg-elev)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text)',
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
    minWidth: 0,
  }

  const actionBtnStyle: CSSProperties = {
    height: 22,
    padding: '0 7px',
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-muted)',
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  const scrollAreaStyle: CSSProperties = {
    maxHeight: 480,
    overflowY: 'auto',
  }

  const emptyStyle: CSSProperties = {
    padding: '24px 0',
    textAlign: 'center',
    fontSize: 13,
    color: 'var(--text-muted)',
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (nodes.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={emptyStyle}>No nodes in this snapshot.</div>
      </div>
    )
  }

  const isSearching = search.trim().length > 0

  return (
    <div style={containerStyle}>
      {/* Header: info pill + search + actions */}
      <div style={headerStyle}>
        {(host || rootPath) && (
          <span style={pillStyle}>
            {host && <span>{host}</span>}
            {host && rootPath && <span style={{ color: 'var(--text-subtle)' }}>—</span>}
            {rootPath && <span>{rootPath}</span>}
            <span style={{ color: 'var(--text-subtle)' }}>—</span>
            <span>{nodes.length.toLocaleString()} items</span>
          </span>
        )}
        <input
          type="search"
          placeholder="Filter paths…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={searchStyle}
        />
        {!isSearching && (
          <>
            <button style={actionBtnStyle} onClick={expandAll} title="Expand all">&#9662; all</button>
            <button style={actionBtnStyle} onClick={collapseAll} title="Collapse all">&#9656; all</button>
          </>
        )}
      </div>

      {/* Tree rows */}
      <div style={scrollAreaStyle}>
        {visibleRows.length === 0 ? (
          <div style={emptyStyle}>No matching paths.</div>
        ) : (
          visibleRows.map((entry) => (
            <NodeRow
              key={entry.node.id}
              entry={entry}
              isCollapsed={effectiveCollapsed.has(entry.node.path)}
              isSearching={isSearching}
              searchQuery={search.trim()}
              onToggle={toggleDir}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── NodeRow ───────────────────────────────────────────────────────────────────

interface NodeRowProps {
  entry: TreeEntry
  isCollapsed: boolean
  isSearching: boolean
  searchQuery: string
  onToggle: (path: string) => void
}

function NodeRow({ entry, isCollapsed, isSearching, searchQuery, onToggle }: NodeRowProps) {
  const { node, depth } = entry
  const isDir = node.type === 'dir'
  const [hovered, setHovered] = useState(false)

  const indent = isSearching ? 0 : depth * 16

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    height: 'var(--btn-h)',
    paddingLeft: indent + 8,
    paddingRight: 10,
    gap: 4,
    cursor: isDir ? 'pointer' : 'default',
    background: hovered ? 'var(--accent-soft)' : 'transparent',
    userSelect: 'none',
    transition: 'background 80ms',
  }

  const iconStyle: CSSProperties = {
    width: 14,
    textAlign: 'center',
    flexShrink: 0,
    fontSize: 10,
    color: isDir ? 'var(--accent)' : 'var(--text-subtle)',
    fontFamily: 'var(--font-mono)',
  }

  const nameStyle: CSSProperties = {
    flex: '1 1 0',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    color: isDir ? 'var(--accent)' : 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  }

  const metaStyle: CSSProperties = {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontVariantNumeric: 'tabular-nums',
    flexShrink: 0,
    fontFamily: 'var(--font-mono)',
  }

  const badgeStyle: CSSProperties = {
    display: 'inline-block',
    padding: '0 5px',
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: node.linkedType === 'script' ? 'var(--warning)' : 'var(--accent)',
    background: node.linkedType === 'script'
      ? 'color-mix(in srgb, var(--warning) 12%, transparent)'
      : 'color-mix(in srgb, var(--accent) 12%, transparent)',
    border: node.linkedType === 'script'
      ? '1px solid color-mix(in srgb, var(--warning) 30%, transparent)'
      : '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
    marginLeft: 4,
    flexShrink: 0,
  }

  // Display: when searching show full path, otherwise show basename
  const displayName = isSearching ? node.path : baseName(node.path) || node.path

  // Highlight matching substring in search mode
  function renderName() {
    if (!isSearching || !searchQuery) return displayName
    const q = searchQuery.toLowerCase()
    const idx = displayName.toLowerCase().indexOf(q)
    if (idx < 0) return displayName
    return (
      <>
        {displayName.slice(0, idx)}
        <mark style={{ background: 'color-mix(in srgb, var(--accent) 30%, transparent)', color: 'var(--text)', borderRadius: 2, padding: '0 1px' }}>
          {displayName.slice(idx, idx + q.length)}
        </mark>
        {displayName.slice(idx + q.length)}
      </>
    )
  }

  // Use HTML entities for icons to avoid encoding issues
  const icon = isDir ? (isCollapsed ? '▸' : '▾') : '·'

  return (
    <div
      style={rowStyle}
      onClick={isDir ? () => onToggle(node.path) : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={node.path}
      role={isDir ? 'button' : undefined}
      aria-expanded={isDir ? !isCollapsed : undefined}
    >
      <span style={iconStyle}>{icon}</span>
      <span style={nameStyle}>{renderName()}</span>
      {node.linkedType && (
        <span style={badgeStyle}>{node.linkedType}</span>
      )}
      {node.size !== null && (
        <span style={{ ...metaStyle, marginLeft: 8, minWidth: 56, textAlign: 'right' }}>
          {formatSize(node.size)}
        </span>
      )}
      {node.mtime && (
        <span style={{ ...metaStyle, marginLeft: 8, minWidth: 76, textAlign: 'right' }}>
          {formatMtime(node.mtime)}
        </span>
      )}
    </div>
  )
}
