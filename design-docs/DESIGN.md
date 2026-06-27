# BI Root (BI-Ro) — Design Document

> Internal knowledge base + secrets vault for the BI Team. It documents the
> infrastructure (servers, ports, apps, services, connections), the scripts that
> run on it (what they do, where they live, what they touch), the folder layout
> of each machine, and the credentials that keep it all alive — with password
> expiry tracking, notifications, email alerts, document storage, and a per-user
> personal vault. Title is env-configurable (`APP_TITLE`, default `BI Root`).

- **Status:** In progress — core features implemented through Phase 9. See §24 for as-built notes on what diverges from this design doc.
- **Owner:** Mohamed Ali (BI Team).
- **Stack:** React 19 + Vite + TypeScript (frontend), Node.js + Express 5 (backend), PostgreSQL, Docker.
- **Image / container:** `bi-ro:v1` / `bi-ro`.
- **Audience for this doc:** the engineer(s) building it, and future maintainers.

---

## Table of contents

1. [Purpose & vision](#1-purpose--vision)
2. [Locked architecture decisions](#2-locked-architecture-decisions)
3. [Personas & roles](#3-personas--roles)
4. [Feature domains](#4-feature-domains)
5. [Suggested additional features](#5-suggested-additional-features-value-adds)
6. [Security architecture](#6-security-architecture)
7. [Authentication & authorization](#7-authentication--authorization)
8. [Data model](#8-data-model-postgres)
9. [API design](#9-api-design)
10. [Frontend design system](#10-frontend-design-system)
11. [Visualizations](#11-visualizations)
12. [Folder structure (repo)](#12-folder-structure-repo)
13. [Docker & deployment](#13-docker--deployment)
14. [Phased delivery plan](#14-phased-delivery-plan)
15. [Alternatives considered](#15-alternatives-considered)
16. [Risks & mitigations](#16-risks--mitigations)
17. [Non-goals (v1)](#17-non-goals-v1)
18. [Open questions](#18-open-questions)

---

## 1. Purpose & vision

The BI Team runs a fleet of servers, scripts, and apps. Today that knowledge
lives in people's heads, scattered spreadsheets, and chat history. When a server
moves, a password expires, or the person who wrote a script leaves, recovery is
painful.

**BI-Ro is the single source of truth** for:

- **What we run** — servers, the apps/services living on them, which app owns
  which port, and how those apps connect to each other.
- **What runs it** — scripts: where the file lives, what it does, what it
  connects to, who last touched it and when.
- **What it looks like** — the folder layout of each machine, captured without
  giving the app live access to the fleet.
- **What unlocks it** — credentials, with expiry tracking so a password never
  silently dies in production again.
- **The paperwork** — runbooks, PDFs, Word docs, notes attached to any of the above.

The experience target: **modern, dense, fast, professional.** Dark by default,
purple accent, small controls, tabular numerals everywhere, no decorative noise.
It should feel like a well-built internal tool that engineers actually enjoy
opening. Visualizations (server topology, port maps, folder trees) are
first-class, not afterthoughts.

### Guiding principles

- **Documentation first, automation later.** v1 never holds live access to the
  fleet (see §2). It is a store you feed, not an agent that reaches out.
- **The vault is the crown jewel.** Everything about secrets — crypto, reveal,
  audit — is designed for the day someone asks "who saw this password and when?"
- **Subtraction by default.** Every UI element earns its pixels. Hierarchy over
  decoration. (Design system in §10.)
- **Pluggable seams.** Auth, secret storage, and data collection are interfaces,
  so we can swap self-auth → Keycloak, or paste-based → SSH-agent, without a
  rewrite.

---

## 2. Locked architecture decisions

These were decided up front and constrain everything below.

| # | Decision | Choice | Consequence |
|---|----------|--------|-------------|
| D1 | **Vault crypto** | Envelope encryption: per-secret AES-256-GCM data key (DEK), wrapped by a master key (KEK) from env / secret-store (KMS-ready). | Uniform across all 3 auth modes. Admin-recoverable. "Re-enter to reveal" is a **step-up auth + audit gate**, not a crypto unlock. Server *can* decrypt at rest (accepted trade-off for a small internal tool). |
| D2 | **App ↔ fleet connectivity** | **Passive in v1.** Documentation store fed by manual entry + pasting the output of app-generated scripts. Only outbound connection is SMTP for email. | Minimal attack surface; the app is not a fleet-wide access target. A `Collector` interface is defined so SSH/agent/probe collectors can be added later with no rework. |
| D3 | **Scale & deployment** | Internal-only, ≤ ~25 users, behind corporate network/VPN. Single app container + single Postgres + a volume. | No HA, no horizontal scaling, no WAF in v1. Effort goes to vault + UX, not infra resilience. |
| D4 | **Auth mode selection** | Chosen via `AUTH_MODE` env + confirmed in a first-launch setup wizard. **Immutable per deployment.** | Reveal step-up resolves per mode: self → password recheck; Keycloak → OIDC step-up / fresh token; LDAP → re-bind with entered password. No mid-life mode switching to design around. |

---

## 3. Personas & roles

### Personas

- **Admin / BI lead** — configures the instance, manages users, sees everything,
  manages SMTP and integrations.
- **BI engineer** — documents servers/scripts, manages team credentials they own,
  reveals secrets they're entitled to, uploads runbooks.
- **Read-only stakeholder** — browses infra docs and topology, cannot see secrets.
- **External system** — a script or service hitting the API with an API key
  (read-mostly, scoped).

### Role model

Roles are **bundles of permission flags**. Built-in roles ship as presets; admins
can create custom roles. Per-user overrides are allowed on top of the role.

Built-in roles:

| Role | Summary |
|------|---------|
| `admin` | All permissions, including user/role/settings management. |
| `editor` | Manage servers/scripts/docs; create/edit secrets in vaults they're granted; reveal allowed. |
| `viewer_secrets` | Read infra; view + reveal secrets they're granted; cannot edit. |
| `viewer` | Read infra docs and topology only; **no secret access**. |

Granular permission flags (role = a set of these):

```
infra.read            servers.write        scripts.write       docs.read
docs.write            secrets.view         secrets.reveal      secrets.create
secrets.edit          secrets.delete       vault.manage_access users.manage
roles.manage          settings.manage      api_keys.manage     audit.read
```

- `secrets.view` = see that a credential exists + metadata (username, expiry).
- `secrets.reveal` = decrypt + copy the actual value (always step-up + audited).
- Access is further scoped by **vault/collection membership** and **server
  ownership** (a user with `secrets.reveal` still only reveals secrets in vaults
  they're a member of).
- The **personal vault** is always private to its owner — no role can read another
  user's personal vault. Not even `admin` (admin can delete it, never read it).

---

## 4. Feature domains

### 4.1 Infrastructure documentation

**Servers.** Each server record holds: hostname, aliases, IP(s), a short
**description** (one-line "what this box is for"), environment
(`prod` / `staging` / `dev` / `other`), OS + version, location/datacenter/cloud,
provider, CPU/RAM/disk notes, owner, **criticality** (`critical` / `high` /
`normal` / `low`), status (`active` / `decommissioned` / `maintenance`), a quick
free-text note, tags, and relationships to ports, apps, users/credentials,
folder trees, and documents.

**Notes tab.** Beyond the one-line description and the quick note, each server
detail page has a dedicated **Notes tab** — a running log of **dated, authored,
markdown** entries (gotchas, change history, "don't reboot during ETL", contacts,
etc.). Entries are listed newest-first with author + timestamp; anyone with edit
rights can add one, and they are never silently overwritten (each is its own row).
The same notes pattern is available on apps and scripts.

**Tags.** Free-form, color-coded labels (e.g. `etl`, `reporting`, `legacy`,
`pci`). Filterable everywhere. Tags are first-class entities so renames propagate.

**Ports & the apps on them.** For a server, a list of ports: number, protocol
(tcp/udp), bound app/service name, app logo, version, exposure
(`internal` / `external` / `localhost`), status, description. This answers
"what lives on port 5432 of `etl-01`?" instantly.

**Apps / services.** An app/service is its own entity (logo, description,
category, vendor, docs link, version) so the same app (e.g. Postgres, n8n,
NetBox, Airflow) can appear on many servers/ports and be tracked consistently.
Optional **EOL/version tracking** (see §5).

**Apps ownership model.** Apps have two modes governed by `vault_id` and `owner_id`:

- **Personal apps** (`vault_id IS NULL`, `owner_id = creator`) — visible **only** to the user who created them. Any authenticated user can create personal apps without any special permission.
- **Vault apps** (`vault_id IS NOT NULL`) — visible to all members of the linked vault. The creator assigns it to a vault they're a member of; all vault members then see it.

A `canEdit` boolean is computed server-side per app and returned in `GET /apps`:
- Admin → can edit any app.
- Personal app → only the creator can edit it.
- Vault app → requires `access = 'manage'` in `vault_members`.

The Apps page (`/apps`) is accessible to **all authenticated users** regardless of permissions; each user sees only their own personal apps plus apps belonging to vaults they're a member of.

**Connections.** Directed edges: "app A on server X talks to app B on server Y"
with a label (protocol/purpose, e.g. `JDBC`, `HTTPS`, `reads from`). These drive
the topology graph (§11) and the blast-radius view (§5).

### 4.2 Scripts registry

A script record documents an automation asset:

- Name, description (**what it does**), language (bash/python/sql/powershell/…).
- **Location:** which server(s) it lives on + absolute file path + optional repo
  URL / branch.
- **Connects to:** the servers, databases, apps, and external services it touches
  when it runs (drives a dependency view).
- Schedule (cron expression / "manual" / "triggered by X").
- Owner, `last_edited_at`, `last_edited_by`, change notes.
- Tags, attached documents (runbook, sample output), linked notifications.

This is documentation only — BI-Ro does not execute scripts (D2). It records and
visualizes them.

### 4.3 Filesystem / folder mapping (generate-script → paste-output)

Because the app is passive (D2), folder structure is captured like this:

1. User opens a server → "Map filesystem" → picks a **root path** (e.g. `/`,
   `/home/user`, `C:\apps`) and a **max depth**.
2. App **generates a script** (bash *and* PowerShell variants) that walks the
   tree to the chosen depth and prints a **stable JSON document** to stdout. The
   script is read-only, self-contained, and shows exactly what it will do (user
   can audit it before running).
3. User runs it on the server and **pastes the JSON output** back into the app.
4. App parses, validates, and stores the tree as a versioned snapshot, then
   renders it as an interactive tree (§11). It can also flag "this is where
   script X lives" / "this is where app Y's code is" by linking tree nodes to
   script/app records.

Defined output contract (the generated script must emit this):

```json
{
  "schema": "bi-ro.fstree.v1",
  "root": "/home/user",
  "host": "etl-01",
  "generated_at": "2026-06-25T10:00:00Z",
  "max_depth": 3,
  "nodes": [
    { "path": "/home/user/etl", "type": "dir", "size": null, "mtime": "..." },
    { "path": "/home/user/etl/run.sh", "type": "file", "size": 2048, "mtime": "..." }
  ]
}
```

Snapshots are versioned so you can see how a machine's layout changed over time.

### 4.4 Password / secrets vault (team)

The core. A **secret** belongs to a **vault (collection)** and optionally links to
a server, app, or script. Types: `server_login`, `db_credential`, `api_key`,
`ssh_key`, `certificate`, `generic`.

Per secret:

- Title, type, username/identity, the secret value (encrypted, §6), URL/host,
  notes, tags, links (server/app/script).
- **Rotation policy:** `rotation_period` (e.g. 90 days / 6 months) **or** explicit
  `expires_at`; plus `last_changed_at`. From these the app computes
  `days_remaining`.
- **History:** every change writes an encrypted prior-value record with
  `changed_at`, `changed_by`, and an optional reason. Lets you answer "what was the
  password before the rotation on the 12th?" and supports rollback.
- **Reveal flow** (the "enter your password again" requirement): see §6.4. Always
  step-up auth → permission check → **audit write** → decrypt → clipboard copy with
  auto-clear timer.

"Check a server → see its users + each password + when it last changed" is a
saved view: a server detail tab listing its linked `server_login` secrets with
username, `last_changed_at`, and `days_remaining` badges.

### 4.5 Expiry tracking, notifications & email

- A **daily local countdown engine** (node-cron) reads **only BI-Ro's own
  database** — never any server — and computes days-to-expiry for each tracked
  credential (and certificates, §5) from its `last_changed_at` + period. It makes
  **no outbound connection of any kind except SMTP**. "Worker" here means an
  in-process timer that counts down dates already stored locally; it does not
  discover, probe, or connect to anything on your fleet.
- **Thresholds** (configurable, defaults 7 days, 2 days, and at/after expiry)
  generate **in-app notifications** and **emails**.
- **Dashboard** shows an "Expiring soon" widget (sorted by urgency) and a count
  of overdue items.
- **Notification center** (`/notifications`): filterable list, per-item detail,
  delivery status (in-app / email sent / failed), retry.
- **Email** via configurable SMTP (host, port, TLS, auth, from-address) set in
  Settings, with a "send test email" button. Templated, plain + HTML bodies.
- De-duplication: a given (secret, threshold) fires once; re-arms after the secret
  is rotated.

**Manual rotation cycle — no server access (CEO review F8.1).** BI-Ro never
touches your fleet. The cycle is entirely manual and passive: per server you can
track **multiple users' credentials**, each with its own settable expiry period
(`rotation_period_days`) or explicit `expires_at`. When someone changes a
password **on the server itself**, they come to BI-Ro and enter the new value.
**Saving a new secret value requires step-up re-auth — the user re-enters their
credentials per the active auth mode (self → password recheck, Keycloak → OIDC
step-up, LDAP → re-bind), exactly like reveal (§6.4)** — and the change is audited.
On a confirmed save the app **restarts that credential's cycle**: resets
`last_changed_at`, recomputes the next-due date from the period the app user chose,
writes an encrypted history entry, and re-arms the 7/2/0 warnings. From that point
the countdown engine simply decrements days-remaining locally and alerts when few
days remain. The engine only reads BI-Ro's own database; it makes no outbound
connection except SMTP. The expiry period is **per credential** and **set by the
BI-Ro user** (multiple users/credentials per server, each on its own timer).

**Local worker heartbeat (folded recommendation).** The worker writes
`last_successful_scan_at`; the dashboard surfaces it and an admin alert fires if
it is stale (> ~25h). This monitors only BI-Ro's *own* scanner — so a silently
dead worker (which would let passwords expire unwarned) becomes visible. It
involves nothing on your servers.

### 4.6 Document store

- Upload `txt`, `pdf`, `doc/docx`, `md`, images. Attach to any entity (server,
  script, app, secret, or standalone).
- Stored on a Docker **volume** (path in DB) — not in Postgres — with metadata:
  filename, mime, size, uploaded_by, uploaded_at, checksum, linked entity.
- **In-app viewers:** PDF via PDF.js; text/markdown rendered inline; `docx`
  rendered to HTML via `mammoth` (fallback: download). Everything is downloadable.
- Allowed-mime allowlist + max size enforced server-side. Optional AV-scan hook
  (no-op stub in v1).

### 4.7 Personal vault

Every user gets a private vault for their own credentials — both **registered
apps** (pick from the apps catalog: n8n, NetBox, etc.) and **ad-hoc entries**
(any app/email/login they want). Each entry can carry a **URL** and a **custom
logo** (uploaded, or auto-suggested from the catalog/favicon) so the personal
vault reads like a tidy launcher. Same crypto and reveal flow as the team vault,
but scoped strictly to the owner (§3). Useful so people stop keeping personal
work passwords in browsers and notes.

**Privacy is cryptographic, not just an ACL (CEO review F3.2).** Personal-vault
entries are encrypted with a **per-user key** (derived from the user's credential
in self mode, or a per-user key unlocked at step-up), so even an admin with DB +
KEK access cannot read another user's personal vault. Trade-off: personal entries
are **not** admin-recoverable (acceptable — they're personal). Team vaults keep
the admin-recoverable KEK envelope scheme (§6.2).

**Linking personal entries to personal apps.** A personal vault entry can optionally be
linked to one of the user's personal apps via `app_id`. When a user expands a personal
app on the Apps page they see all personal vault entries linked to it, with the same
10-second reveal flow (inline vault-password prompt → countdown → clipboard copy with
auto-clear). The app picker appears in both the "add entry" and "edit entry" forms on
the Personal vault page. Only the entry's owner can link or unlink it; the target app
must be a personal app owned by the same user (`vault_id IS NULL AND owner_id = userId`).

### 4.8 API & API keys (external use)

- Admins create **API clients**: name, scopes (mostly read), rate limit. The key
  is shown **once** at creation and stored only as a hash (§6).
- `X-API-Key` auth middleware for programmatic endpoints (e.g. another internal
  tool querying "list servers tagged `etl`").
- **Secrets are NOT exposed over the API key surface by default** — reveal stays
  human + step-up. (A future, explicitly opt-in, narrowly-scoped machine-reveal
  path can be designed later if needed.)
- **Webhooks** (optional, later phase): POST events (secret expiring, server
  changed) to a configured URL.

---

## 5. Suggested additional features (value-adds)

Beyond the brief — each serves the core purpose. Tagged by suggested phase.

- **Password generator** (length/charset/pronounceable) when creating/rotating a
  secret. *(P4)*
- **Strength + reuse check** — warn if a secret is weak or reused across entries
  (hash-compare locally, never send anywhere). *(P4)*
- **Certificate / SSL expiry tracking** — same engine as password expiry, for
  TLS certs and domains. High value, near-zero extra cost. *(P5)*
- **Blast-radius / dependency view** — "if `db-01` goes down, what breaks?" by
  traversing the connections + scripts graph. *(P3)*
- **Environment grouping & filters** — prod/staging/dev lanes across all views. *(P2)*
- **Global command palette** (`Ctrl/Cmd-K`) — jump to any server/script/secret,
  run actions. Big UX win for a dense tool. *(P9)*
- **Global search** across servers, scripts, apps, docs, secret *metadata* (never
  secret values). *(P9)*
- **App version & EOL tracking** — record installed versions; flag end-of-life
  software (manual or seeded EOL data). *(P5)*
- **Secret check-out / break-glass** — optional exclusive checkout, and an
  audited "emergency access" path with mandatory reason. *(later)*
- **Access-request workflow** — a user requests reveal access to a vault; owner
  approves; logged. *(later)*
- **Soft-delete + recycle bin** for all entities, with restore. *(P9)*
- **Audit log UI** — searchable, filterable; the answer to "who did what". *(P4/P9)*
- **Scheduled digest email** — weekly "state of the fleet + expiring items". *(P5)*
- **Import** — CSV import for servers; optional NetBox sync (read) later. *(later)*
- **Backup/export** — encrypted export of the DB + vault for DR; restore path. *(P9)*
- **TOTP/2FA for self-auth login** (and as a step-up factor). *(P7)*
- **Theming** — dark/light (per brief) + accent override via env. *(P1)*
- **10-second reveal window** — value auto-re-masks 10s after step-up confirm;
  clipboard auto-clear + "copied" toast. *(P4)*

---

## 6. Security architecture

### 6.1 Threat model (scope)

In scope: an authenticated user seeing secrets they shouldn't; lost audit trail;
secrets readable in DB backups; weak transport; API-key leakage. Out of scope for
v1: a fully compromised host with the running process + env (D1 accepts the server
can decrypt at rest); DoS (D3, internal/VPN only).

### 6.2 Envelope encryption (D1)

```
MASTER_KEK            from env (BIRO_MASTER_KEK) — 256-bit, base64.
                      KMS-ready: swap to AWS/GCP/Azure KMS or Vault transit later.
   │  wraps
   ▼
DEK (per secret)      random 256-bit, generated on create.
   │  AES-256-GCM
   ▼
ciphertext + iv(nonce) + auth_tag      stored in DB
```

Each secret row stores: `ciphertext`, `iv`, `auth_tag`, `wrapped_dek`,
`key_version`. To decrypt: unwrap DEK with KEK → AES-256-GCM decrypt.

- **KEK rotation** is cheap: re-wrap each `wrapped_dek` under the new KEK; payload
  ciphertext is untouched. Support a two-key window (`key_version`) during
  rotation.
- **Optional per-vault key** layer (KEK → vault key → DEK) can be added if we ever
  want per-vault key isolation; schema leaves room (`vault.key_id`).
- KEK is **never** written to the DB or logs. Provided via env/secret-store; in
  managed environments, fetched from KMS at boot.

### 6.3 Hashing & other crypto

- **App-local user passwords** (self-auth mode only): Argon2id.
- **API keys:** random 256-bit, returned once, stored as SHA-256 (or Argon2id)
  hash; compared by hash on each request.
- **Transport:** HTTPS terminated at the reverse proxy / ingress (out of app
  scope but required for deployment). `helmet` already in the backend.

### 6.4 Reveal flow ("enter your password again")

```
User clicks "Reveal" on a secret
  └─> Frontend opens step-up modal
        ├─ self-auth:  re-enter app password  → backend verifies (Argon2id)
        ├─ keycloak:   OIDC step-up (max_age / acr) → fresh token verified
        └─ ldap:       re-enter password → backend re-binds to LDAP
  └─> Backend: verify step-up  →  check secrets.reveal + vault membership
  └─> Write AUDIT event (user, secret_id, action=reveal, ts, ip, ua)
  └─> Decrypt (unwrap DEK → AES-GCM) → return value
  └─> Value displayed for **10 seconds only**, then auto-hidden again
  └─> Optional copy-to-clipboard also auto-clears
```

**Every reveal requires its own re-enter + confirm** — there is no long-lived
"keep revealed" session. After the user re-authenticates and confirms, the secret
value is shown for **10 seconds**, then the field automatically re-masks. Viewing
it again means re-entering the password again. Every individual reveal is audited
regardless.

**Write-ahead audit, fail-closed (CEO review F2.1).** The audit row is committed
**before** the plaintext is returned. If the audit write fails, the reveal is
**blocked** and the user sees an error — there is no code path that returns a
secret value without a committed audit record. Order is strict: step-up → authz
(role + vault membership) → **audit commit** → decrypt → return. The brute-force
guard (rate-limit + temporary lockout) on login and step-up ships **with the
reveal endpoint in P4**, not later (F3.1).

**Writing a secret value is also step-up-gated.** Creating or changing a stored
secret value (the manual rotation in §4.5) requires the same fresh re-auth as a
reveal and is audited. Metadata-only edits (title, tags, notes, period) do not
require step-up; only operations that touch the plaintext value do.

### 6.5 Audit log

Append-only table capturing security-relevant events: logins, reveals, secret
create/edit/delete, access-grant changes, settings changes, API-key
create/revoke. Each row: actor, action, target type+id, timestamp, IP, user-agent,
result. Surfaced in the Audit UI (§5), filterable, read-only, never editable from
the app.

### 6.6 Other controls

- Rate-limit auth + reveal endpoints (even internal — stops credential-stuffing
  from a compromised laptop).
- Secret values never logged, never in error messages, never in API responses
  except the explicit reveal endpoint.
- CSP, secure cookies (httpOnly, sameSite, secure), CSRF protection for
  cookie-based sessions.
- Sensitive fields excluded from the standard serializers by default (opt-in
  decrypt only).

---

## 7. Authentication & authorization

### 7.1 Mode selection (D4)

`AUTH_MODE` ∈ `{ self | keycloak | ldap }`, set in env and confirmed in the
**first-launch setup wizard** (which also seeds the first admin, sets `APP_TITLE`,
accent, SMTP, and the KEK presence check). Mode is immutable afterwards.

**Mode-specific connection details come from env, and the app prompts when they
are missing.** The mode itself (`AUTH_MODE`) and the KEK are hard requirements —
the app refuses to start without them. But the per-mode *connection details*
(Keycloak issuer/client/secret/redirect; LDAP host/baseDN/bindDN/filter) are read
from env first and, **if any required value for the active mode is absent or
fails its validation check**, the app does **not** crash: it boots into a
**"configuration required" state** where the setup wizard asks an admin to enter
the missing details. The wizard validates them live (OIDC discovery for Keycloak,
a test bind for LDAP) before activating the mode, and persists them to settings.
`.env.example` documents every key so the env-only path stays the happy path.

An **`AuthProvider` interface** abstracts the three modes:

```
authenticate(credentials)      -> session/identity
stepUp(user, credentials)      -> boolean   (for reveal)
resolveRoles(identity)         -> roles      (group/claim mapping)
```

### 7.2 Self mode

- Local `users` table; passwords Argon2id.
- **Create a user:** admin adds name + email + role (+ optional per-user permission
  overrides); user gets an invite link to set their password (or admin sets a
  temp password, force-change on first login). Optional TOTP enrollment.
- Step-up: re-verify password.

### 7.3 Keycloak mode

- **BI-Ro integrates with an already-running Keycloak — it does not run its own.**
  The app compose file does **not** include a Keycloak service; integration is
  purely **connection details in env** (issuer/realm URL, client ID, client
  secret, redirect URI, group/role claim names). We assume an external Keycloak
  the org already operates.
- A **separate, standalone test compose file** (`keycloak.test.compose.yaml`) is
  shipped for local testing only — it spins up a throwaway Keycloak so a developer
  can exercise the OIDC flow. It is never part of the production `bi-ro` stack.
- App is a **confidential OIDC client**; login via Authorization Code + PKCE.
- **Create a user:** the user must exist in Keycloak. In BI-Ro the admin either
  (a) pre-registers them by email/UPN and the account links on first login, or
  (b) enables **auto-provision on first login** with a default low role, then the
  admin elevates. Roles map from **Keycloak groups/realm roles → BI-Ro roles**
  (configurable mapping in Settings).
- Step-up: OIDC re-authentication using `max_age=0` / an `acr` step-up, validating
  a fresh token before reveal.

### 7.4 LDAP mode

- Bind/search against the directory (host, baseDN, bindDN, filter in env/settings).
- **Create a user:** admin adds the user by LDAP username/DN; the account
  activates on first successful bind. Roles map from **LDAP groups → BI-Ro roles**.
- Step-up: re-bind with the password the user re-enters.

### 7.5 Authorization

After authentication, every request carries an identity with resolved roles →
permission flags (§3). Middleware enforces flags per route; service layer enforces
vault membership + ownership for secret access. The personal vault bypass is
explicit and owner-only.

---

## 8. Data model (Postgres)

IDs are ULIDs (`text`/`uuid`). Timestamps are `timestamptz`. Soft-delete via
`deleted_at` on user-facing entities (P9). Sketch (not exhaustive):

```
-- identity & access
users(id, auth_mode, external_id, email, display_name, password_hash?,
      totp_secret?, status, created_at, last_login_at, deleted_at)
roles(id, name, description, is_builtin)
role_permissions(role_id, permission)            -- flag strings
user_roles(user_id, role_id)
user_permission_overrides(user_id, permission, allow)

-- infra
servers(id, hostname, ips jsonb, description, environment, os, location,
        provider, criticality, owner_id, status, notes, created_at,
        updated_at, deleted_at)
   -- description: one-line summary; notes: quick free-text; criticality: critical|high|normal|low
server_notes(id, server_id, body, author_id, created_at, updated_at)
   -- the Notes tab: dated, authored, markdown entries (newest-first), one row each
tags(id, name, color)
server_tags(server_id, tag_id)
apps(id, name, category, vendor, version, eol_date?, logo_url, docs_url, notes,
     vault_id?, owner_id?, created_at, updated_at, deleted_at)
   -- vault_id NULL + owner_id set  → personal app, visible only to its owner
   -- vault_id NOT NULL             → vault/team app, visible to all vault members
   -- vault_id NULL + owner_id NULL → legacy/orphaned (admin-only fallback)
app_instances(id, server_id, app_id, version?, notes)   -- "app A running on server X" (CEO review F1.3)
   -- first-class addressable node for topology + connections
ports(id, server_id, app_instance_id?, number, protocol, app_label, exposure,
      status, description)
connections(id, from_app_instance_id, to_app_instance_id, label, protocol, notes)
   -- both endpoints reference app_instances(id) — real nodes, not loose pairs

-- scripts
scripts(id, name, description, language, repo_url, schedule, owner_id,
        last_edited_at, last_edited_by, notes, created_at, deleted_at)
script_locations(id, script_id, server_id, file_path)
script_connections(id, script_id, target_type, target_id, label)  -- server/app/db/external

-- filesystem snapshots
fs_snapshots(id, server_id, root_path, max_depth, host, generated_at,
             created_by, created_at)
fs_nodes(id, snapshot_id, path, type, size, mtime, linked_type?, linked_id?)

-- vault
vaults(id, name, type, owner_id?, key_id?, created_at)   -- type: team|personal
   -- team vaults: KEK envelope (admin-recoverable). Only admins create vaults.
   -- GET /vaults returns my_access per vault ('manage'|'reveal'|'view') so the
   --   frontend knows the calling user's permission level for that vault
vault_members(vault_id, user_id, access)                 -- view|reveal|manage
secrets(id, vault_id, type, title, username, host_url, logo_url?, notes,
        ciphertext, iv, auth_tag, wrapped_dek, key_version,
        rotation_period_days?, expires_at?, last_changed_at,
        server_id?, app_id?, script_id?, created_by, created_at,
        updated_at, deleted_at)
        -- app_id links a team-vault secret to an app; shown in the app's credential section
secret_history(id, secret_id, ciphertext, iv, auth_tag, wrapped_dek,
               key_version, changed_at, changed_by, reason)
secret_tags(secret_id, tag_id)

-- personal vault (separate per-user encrypted store, not using the KEK envelope)
-- (stored in users table + personal_entries, NOT in vaults/secrets)
-- users: personal_vault_key_salt BYTEA, personal_vault_key_cipher BYTEA
personal_entries(id, owner_id, title, url?, username?, logo_url?, notes?,
                 app_id?,            -- links entry to a personal app (vault_id IS NULL)
                 ciphertext, iv, auth_tag,
                 notes_cipher?, notes_iv?, notes_auth_tag?,
                 created_at, updated_at, deleted_at)
   -- app_id REFERENCES apps(id) ON DELETE SET NULL
   -- encrypted with per-user PVK (AES-256-GCM); admin cannot read

-- documents
documents(id, filename, mime, size, checksum, storage_path,
          linked_type?, linked_id?, uploaded_by, uploaded_at, deleted_at)

-- notifications & email
notifications(id, type, severity, title, body, target_type?, target_id?,
              created_at, read_at?)
notification_deliveries(id, notification_id, channel, recipient,
                        status, error?, sent_at)
notification_rules(id, kind, threshold_days, enabled)   -- e.g. expiry@7,2,0

-- api & audit
api_clients(id, name, key_hash, scopes jsonb, rate_limit, created_at, revoked_at?)
audit_log(id, actor_id?, actor_api_client_id?, action, target_type, target_id,
          ip, user_agent, result, ts, detail jsonb)

-- system
settings(key, value jsonb)            -- title, accent, smtp, mappings, thresholds
setup_state(initialized boolean, auth_mode, initialized_at)
```

---

## 9. API design

REST under `/api`. Two auth surfaces: **session/JWT** (humans, admin UI) and
**`X-API-Key`** (machines, scoped, read-mostly).

Representative routes:

```
# public/bootstrap
GET    /api/health
GET    /api/setup/state
POST   /api/setup/initialize          -- first-launch wizard (once)

# auth
POST   /api/auth/login                -- self/ldap; keycloak via OIDC redirect
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/step-up              -- returns short-lived reveal grant

# infra
GET/POST/PATCH/DELETE  /api/servers[/:id]
GET    /api/servers/:id/topology      -- nodes + edges for the graph
GET/POST  /api/servers/:id/ports
GET/POST/PATCH/DELETE  /api/apps[/:id]
  -- GET /apps: requireAuth only (no permission gate); returns only apps
  --   the caller owns (personal) or is a vault member of (vault apps).
  --   Each app row includes: vaultId, vaultName, ownerId, canEdit (bool).
GET    /api/apps/:id/instances        -- app_instances for this app
GET    /api/apps/:id/secrets          -- team-vault credentials linked to this app
  --   requires secrets.view; filters by vault membership
GET/POST/PATCH/DELETE  /api/connections[/:id]
GET/POST  /api/tags

# scripts
GET/POST/PATCH/DELETE  /api/scripts[/:id]

# filesystem
POST   /api/servers/:id/fs/generate-script   -- returns bash + ps1 text
POST   /api/servers/:id/fs/import            -- parse pasted JSON -> snapshot
GET    /api/servers/:id/fs/snapshots[/:sid]

# vault
GET/POST/PATCH/DELETE  /api/vaults[/:id]
  -- GET /vaults: returns my_access ('manage'|'reveal'|'view') per vault;
  --   admins always get 'manage'. Only admins can POST (create vaults).
GET    /api/vault/users?q=            -- user search for vault member management
                                      -- requires vault.manage_access; LIMIT 50
POST/DELETE  /api/vaults/:id/members  -- add/remove members + set access level
GET/POST/PATCH/DELETE  /api/secrets[/:id]          -- never returns value
POST   /api/secrets/:id/reveal                     -- requires reveal grant; audited
GET    /api/secrets/:id/history
GET    /api/vaults/:id/secrets        -- secrets for a vault (includes server_hostname,
                                      --   app_name via LEFT JOINs)

# personal vault (per-user AES-256-GCM key, separate from KEK envelope)
GET    /api/personal-vault/status
POST   /api/personal-vault/initialize
GET    /api/personal-vault/entries[?appId=]   -- optional appId filter for Apps page
POST   /api/personal-vault/entries
  --   accepts: title, url, username, value, password (vault pw), appId?
  --   appId must be a personal app owned by the caller (vault_id IS NULL)
GET    /api/personal-vault/entries/:id
PATCH  /api/personal-vault/entries/:id
  --   accepts: title, url, username, appId (or null to unlink)
  --   newValue + password required only if rotating the secret value
DELETE /api/personal-vault/entries/:id
POST   /api/personal-vault/entries/:id/reveal

# documents
POST   /api/documents (multipart)
GET    /api/documents/:id            -- metadata
GET    /api/documents/:id/download
GET    /api/documents/:id/view       -- inline render where supported

# notifications & admin
GET    /api/notifications[/:id]
GET/POST  /api/admin/users  /api/admin/roles  /api/admin/settings
GET/POST/DELETE  /api/admin/api-clients
GET    /api/admin/audit
```

Controllers stay thin (validate → service → respond). Services hold the engine
logic. Repositories wrap raw SQL behind named functions.

---

## 10. Frontend design system

Per the brief: **modern, smooth, professional. Dark by default, light available,
purple accent, small controls, readable but not chunky.**

**As-built stack** (differs from original Tailwind + shadcn plan):
- **Plain inline CSS** with CSS custom properties (no Tailwind, no shadcn/ui, no class-variance-authority). All design tokens are CSS variables set in `ThemeProvider` via a `<style>` tag; dark/light toggle swaps the token set.
- **Custom component library** in `frontend/src/components/ui/` — `Button`, `Input`, `Card` — written as thin wrappers around HTML elements with inline styles referencing the token variables.
- **Icons:** inline SVG paths where needed (no lucide-react or other icon library). Emojis avoided; SVG used for action icons.
- **SPA routing:** custom `if/else` path-matching in `App.tsx` — no react-router. `window.history.pushState` for navigation; `popstate` listener for back/forward.

**Tokens (dark root):**

```
--bg #0b0b10   --bg-elev #131320   --bg-elev-2 #1a1a2a
--border rgba(255,255,255,0.08)
--text #e7e7ee  --text-muted #9a9aa8  --text-subtle #6e6e7e
--accent #a78bfa  --accent-strong #8b5cf6  --accent-soft rgba(167,139,250,0.12)
--success #34d399  --warning #fbbf24  --danger #f87171
--radius-sm 6px  --radius 8px  --radius-lg 12px
--font-sans "Inter", system-ui, sans-serif
--font-mono "JetBrains Mono", ui-monospace, monospace
--text-xs 12/16  --text-sm 13/18 (base UI)  --text-base 14/20
--text-lg 16/22  --text-xl 18/24
--btn-h-sm 26  --btn-h 30 (default)  --btn-h-lg 34  --input-h 30
```

Light mode swaps `--bg/--bg-elev*/--text*/--border`, keeps the accent. Accent
overridable via env.

**Vibe.** Compact table rows, single-pixel borders, no heavy shadows. Hover =
subtle `--accent-soft` tint, not glow. Focus = 2px `--accent-strong` ring, 2px
offset. Motion 120–180ms, never > 220ms, no bounce. Inter at the sizes above;
code/IDs/JSON in JetBrains Mono; `tabular-nums` on every count, port, and
timestamp.

**Layout.** Persistent left sidebar (220px, collapses to icons), top bar with
current-user chip + theme toggle, content max-width ~1280px.

**Component inventory (build order):** ThemeProvider/Toggle → AppShell →
Button/IconButton (3 sizes, 4 intents) → Input/Textarea/Select/Checkbox/Switch/
Label/FieldRow → Card/Section/Divider → DataTable (sort, paginate, row actions) →
Badge (status pills) → Dialog/DropdownMenu/Toast/Tooltip → JsonViewer →
CodeEditor (Monaco, for generated scripts + JSON paste) → EmptyState/Skeleton/
Spinner → **TopologyCanvas** and **FolderTree** (see §11).

**Pages.**

```
/                          Dashboard      totals, expiring secrets, recent audit/notifications
/servers                   Servers        table + filters (env, tags, status)
/servers/:id               Server detail  overview, ports/apps, credentials, fs tree, docs, connections
/apps                      Apps catalog   list + logos + versions/EOL
/topology                  Topology       full fleet graph
/scripts                   Scripts        table
/scripts/:id               Script detail  what/where/connects-to + docs
/vault                     Team vaults    collections + secrets table
/vault/:id                 Vault detail   members + secrets
/secrets/:id               Secret detail  metadata, reveal, history
/personal                  Personal vault private to user
/documents                 Documents      library + viewer
/notifications[/:id]       Notifications  list + detail + deliveries
/audit                     Audit log      filterable (admin)
/settings                  Settings       title/accent/theme, SMTP, auth mappings, thresholds, API clients, users/roles
/setup                     First-launch wizard
```

A live design exploration (font/color/layout variants) should be produced before
P2 UI work using the team's design tooling, constrained to the tokens above.

---

## 11. Visualizations

- **Topology graph** (`/topology` and per-server): nodes = servers / apps / ports;
  edges = connections with protocol labels and app logos. Built on **React Flow
  (@xyflow/react)** — pan/zoom, auto-layout (dagre/elk), group by environment,
  click a node to open its detail. Edge highlighting powers the blast-radius view.
- **Port map**: per-server compact visual of ports → apps with logos and exposure
  color-coding.
- **Folder tree** (`FolderTree`): virtualized tree (e.g. `react-arborist`) from
  `fs_snapshots`, with file/dir icons, size, mtime, search/filter, and badges on
  nodes linked to a script or app. Snapshot version switcher.
- **Dashboard charts**: small, restrained — counts by environment, expiring-soon
  timeline, secrets-by-type. No decorative gradients.

---

## 12. Folder structure (repo)

Builds on the existing scaffold (`backend/` Express ESM, `frontend/` Vite React).
TypeScript is added incrementally on the frontend (`npm i -D typescript
@types/node`, rename files as touched — no big-bang conversion).

```
bi-ro/
  backend/
    src/
      server.ts                 bootstraps express, wires routes, starts workers
      db/ pool.ts  migrate.ts
      middleware/ session.ts  rbac.ts  errorHandler.ts
      routes/ health.ts  auth.ts  servers.ts  apps.ts  vault.ts  personalVault.ts
              topology.ts  scripts.ts  documents.ts  notifications.ts  recycle.ts
              audit.ts  backup.ts  settings.ts  admin/(users.ts, setup.ts)
      crypto/                   envelope.ts (KEK/DEK), personalVault.ts
    migrations/
      0001_init.sql … 0017_personal_entries_app.sql   (append-only, auto-applied on boot)
    .env.example
    package.json
  frontend/
    src/
      main.tsx
      App.tsx                   SPA routing (if/else path matching, no react-router)
      lib/ api.ts               fetch wrapper with typed responses
      components/
        ui/ Button.tsx  Input.tsx  Card.tsx
        AppShell.tsx             sidebar (220px) + topbar + nav permission filter
        ThemeProvider.tsx        CSS token injection; dark/light toggle
        ThemeToggle.tsx
        RevealDialog.tsx         10-second reveal modal for team-vault secrets
        ConfirmDialog.tsx        generic confirmation modal
        CommandPalette.tsx       Ctrl/Cmd-K global search
        DataTable.tsx            generic sortable table component
      pages/
        DashboardPage.tsx
        ServersPage.tsx  ServerDetailPage.tsx
        AppsPage.tsx             personal + vault apps; inline personal-vault reveal
        TopologyPage.tsx
        ScriptsPage.tsx
        VaultListPage.tsx  VaultDetailPage.tsx  SecretDetailPage.tsx
        PersonalPage.tsx         per-user AES-256-GCM vault; app-linking picker
        DocumentsPage.tsx
        NotificationsPage.tsx
        AuditPage.tsx
        BackupPage.tsx
        RecycleBinPage.tsx
        SettingsPage.tsx
        SetupPage.tsx            first-launch wizard
        LoginPage.tsx            logo + "BI Root" + "Sign in" centered form
    vite.config.ts  index.html  package.json
  design-docs/ DESIGN.md  PROGRESS.md
  Dockerfile                     multi-stage: build frontend, install backend, non-root
  docker-compose.yaml            app + postgres + volumes (NO keycloak)
  keycloak.test.compose.yaml     test-only: throwaway Keycloak + db for OIDC testing
  .dockerignore  .env.example  README.md
```

---

## 13. Docker & deployment

- **Multi-stage Dockerfile:** build the frontend → install backend prod deps →
  copy frontend build into the backend's static dir → run as non-root.
- **Image / container names:** `bi-ro:v1` / `bi-ro` (fully named, per brief).
- **docker-compose (`docker-compose.yaml`):** services `bi-ro` (app) + `bi-ro-db`
  (postgres:16) with named volumes: `bi-ro-db-data`, `bi-ro-uploads` (documents).
  All containers named. **Keycloak is NOT here** — BI-Ro connects to an external,
  already-running Keycloak via env (issuer URL, client ID/secret, redirect URI).
- **Separate test stack (`keycloak.test.compose.yaml`):** a standalone,
  developer-only compose that runs a throwaway Keycloak + its DB for testing the
  OIDC flow. Documented in the README as "test only", never deployed with the app.
- **Env (`.env.example`):** `APP_TITLE`, `APP_ACCENT`, `AUTH_MODE`,
  `BIRO_MASTER_KEK`, `DATABASE_URL`, `JWT_SECRET`, SMTP_* , Keycloak_* / LDAP_*
  (mode-dependent), `EXPIRY_THRESHOLDS`.
- **Boot checks:** app refuses to start if `BIRO_MASTER_KEK` is missing/short or
  `AUTH_MODE` is invalid (hard requirements). If the active mode's **connection
  details** (Keycloak/LDAP) are missing or fail validation, the app still boots but
  enters a **"configuration required"** state and the setup wizard collects +
  validates them (§7.1) before login is enabled — it does not crash. Runs
  migrations on start (idempotent).
- **TLS:** terminate at a reverse proxy in front (documented in README); app sets
  secure-cookie + HSTS behind it.
- Single host (D3); no orchestration/HA in v1.
- **Port exposure policy:** only the app port (5000) is published to the host. The database (`bi-ro-db`) is reachable by the app container via the internal Docker network only — its port is **never** published to the host in the production compose file. If a developer needs direct DB access locally, they should run a temporary `docker compose run` or connect via `docker exec`, not by adding a host port mapping to the shared compose file.

---

## 14. Phased delivery plan

Each phase is independently shippable and demoable. "Done" = the acceptance bullets
pass.

### Phase 0 — Foundations
- This DESIGN.md; finalize env contract; add TypeScript to frontend; wire Tailwind
  + tokens + base `ui/` components; set up `db/pool` + migration runner; logger,
  errorHandler, requestId; empty Dockerfile/compose filled in.
- **Done:** `docker compose up` brings up app + empty Postgres; health check green;
  themed AppShell renders with sidebar/topbar/theme toggle.

### Phase 1 — Core platform & setup
- `AuthProvider` interface + **self-auth** implementation (Argon2id, JWT/session,
  RBAC middleware). First-launch **setup wizard** (title, accent, auth mode lock,
  first admin, KEK check). Users/roles tables + minimal admin UI.
- **Done:** fresh instance walks the wizard, creates an admin, logs in, sees an
  empty dashboard; RBAC blocks an unauthorized route.

### Phase 2 — Infrastructure documentation
- Servers CRUD (description/criticality/provider) + tags + environments; apps
  catalog; ports + app-on-port; basic connections. DataTable list views + server
  detail page (overview/ports/apps/**notes**/docs tabs, notes = dated authored
  markdown entries). Filters by env/tag/status.
- **Done:** can document a server end-to-end with ports, apps, tags, and dated
  notes; list filters work; viewer role sees infra but no secrets.

### Phase 3 — Visualizations & filesystem mapping
- TopologyCanvas (React Flow) for fleet + per-server; port map; blast-radius
  highlight. FS **script generator** (bash + ps1) + **paste-import** parser +
  versioned snapshots + FolderTree viewer; link tree nodes to scripts/apps.
- **Done:** generate a folder-scan script, paste its JSON, see the tree; topology
  graph renders servers/apps/connections and is navigable.

### Phase 4 — Vault core
- Envelope crypto layer (KEK/DEK, AES-256-GCM); secrets CRUD (value never
  returned on read); **reveal flow** with step-up + reveal-grant + **audit log**;
  secret history; expiry fields + `days_remaining`; password generator; clipboard
  auto-clear; audit UI (basic).
- **Done:** create a credential, reveal it after re-auth, see the audit entry;
  rotate it and view history; days-remaining computed.

### Phase 5 — Notifications, email & expiry engine
- node-cron daily scanner; thresholds (7/2/0, configurable); in-app notification
  center + dashboard "expiring soon" widget; SMTP integration + test-send;
  certificate expiry tracking; weekly digest.
- **Done:** a near-expiry secret produces an in-app notification and an email at
  the right threshold, once, and re-arms after rotation.

### Phase 6 — Documents
- Upload/store on volume; metadata; attach to entities; in-app PDF/text/markdown/
  docx viewing + download; allowlist + size limits.
- **Done:** attach a runbook PDF to a script and view it inline; download works;
  disallowed type rejected.

### Phase 7 — Keycloak & LDAP modes + 2FA
- Keycloak OIDC provider (login + group→role mapping + OIDC step-up); LDAP
  provider (bind/search + group→role mapping + re-bind step-up); per-mode user
  creation flows; TOTP for self-auth.
- **Done:** an instance set to each mode can log a mapped user in and perform a
  reveal step-up appropriate to that mode.

### Phase 8 — Personal vault, API & webhooks
- Personal vault (owner-only); API clients + `X-API-Key` middleware + scopes +
  rate limit; read endpoints for external use; optional webhooks for expiry/change
  events.
- **Done:** a user manages personal secrets; an API client lists servers by tag
  with a scoped key; key shown once and stored hashed.

### Phase 9 — Polish & hardening
- Command palette + global search; recycle bin (soft-delete/restore); full audit
  UI; encrypted backup/export + restore; KEK rotation tooling; rate limiting +
  CSP/cookie hardening; light theme pass; empty/error/loading states everywhere;
  README + ops docs; Docker hardening (non-root, healthcheck, resource limits).
- **Done:** security checklist passes; backup→restore verified; UX states audited;
  KEK rotation runbook tested.

---

## 15. Alternatives considered

- **Vault crypto (D1).** Considered per-user zero-knowledge derived keys (max
  privacy) and delegating to HashiCorp Vault/OpenBao. Rejected for v1: ZK breaks
  shared team secrets, SSO/LDAP (no raw password), and admin recovery; external
  Vault adds heavy ops for a ≤25-user internal tool. Envelope encryption gives
  strong-enough protection, uniform multi-mode behavior, and a clean KMS upgrade
  path. *(chosen)*
- **Connectivity (D2).** Considered active SSH/agent collection from day one
  (less manual). Rejected: makes the app a fleet-wide access target and balloons
  security/network scope. Passive + paste, with a `Collector` seam for later, fits
  the brief and minimizes attack surface. *(chosen)*
- **Secret storage location.** Considered Postgres `pgcrypto` column encryption.
  Rejected in favor of app-side envelope encryption for key-rotation flexibility
  and KMS portability.
- **Topology rendering.** Considered hand-rolled SVG / D3. React Flow chosen for
  built-in pan/zoom/handles and faster delivery.

---

## 16. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| KEK loss = total vault loss | Document KEK backup/escrow in ops runbook; KMS option; never store KEK in DB. |
| Server can decrypt at rest (D1 trade-off) | Accept for internal scope; isolate host; restrict DB/backup access; KMS later. |
| Pasted FS output is large / malformed | Strict schema validation, size cap, depth cap; clear parse errors. |
| Auth-mode misconfig at first launch | Setup wizard validates config (test LDAP bind / OIDC discovery) before locking. |
| Email deliverability | Test-send button; delivery status + retry; failures visible in notifications. |
| Scope creep into "active agent" | Hold the line on D2 for v1; collectors are a named future phase only. |
| Clipboard leaves secrets around | Auto-clear timer + masked display + audit. |

---

## 17. Non-goals (v1)

- No outbound connections to the fleet (no SSH, port probing, or auto-discovery).
- No HA / clustering / multi-tenant.
- No public internet exposure or third-party-facing surface beyond internal API
  keys.
- No machine reveal of secret *values* over the API by default.
- No automated script execution or scheduling engine (BI-Ro documents schedules,
  it does not run them).

---

## 18. Open questions

1. **KEK custody** — env var for v1, or wire a KMS/Vault-transit provider now?
   (Affects P0 `kms.js` stub vs real.)
2. **Document storage** — volume on the host is assumed; any requirement for
   object storage (S3/MinIO) instead?
3. **LDAP/Keycloak specifics** — directory flavor (AD vs OpenLDAP), Keycloak realm
   + client details, and the exact group→role mapping you want seeded.
4. **Backup ownership** — does the BI team want BI-Ro to manage encrypted backups,
   or rely on existing Postgres backup infrastructure?
5. **App logos** — curated catalog with bundled logos, or user-uploaded per app?

---

---

## 19. Agent execution playbook (ordered, chunked, context-safe)

This section is written **for an AI/automation agent** that will implement BI-Ro.
Follow it top to bottom. Do **not** jump ahead. Each chunk is sized to fit in one
working session, ends in a **verifiable gate**, and lists exactly what to read so
you never lose context.

### 19.0 Operating rules (read once, obey throughout)

1. **One chunk at a time, in order.** A chunk is complete only when its **Gate**
   passes. Do not start the next chunk until the current Gate is green.
2. **Re-read before you build.** At the start of each chunk, re-read the
   DESIGN.md sections listed in its **Read** line. Treat DESIGN.md as the source
   of truth; if reality forces a deviation, update DESIGN.md in the same chunk and
   note it.
3. **Keep a running `PROGRESS.md`** at the repo root. After each chunk append:
   chunk id, what was built, files touched, decisions/deviations, and the Gate
   result. This is how context survives across sessions — read it first when
   resuming.
4. **Commit per chunk.** One commit per completed chunk, message
   `feat(<area>): <chunk-id> <summary>`. Never commit a red Gate. (Commit only;
   do not push unless asked. The repo currently has no git — `git init` first.)
5. **Migrations are append-only.** Every schema change is a new numbered migration;
   never edit a shipped one. The DB must be reproducible from `migrate` on an empty
   Postgres.
6. **Never log, return, or print secret values, the KEK, or unwrapped DEKs.**
   The only endpoint that returns a secret value is `POST /api/secrets/:id/reveal`.
7. **Stop and ask** if a chunk needs one of the §18 open questions answered and it
   is still open. Do not guess on crypto custody (Q1) or directory specifics (Q3).
8. **Definition of done per chunk** = code + migration (if any) + minimal test or
   manual verification described in the Gate + `PROGRESS.md` entry + commit.

### 19.1 Build order at a glance

```
P0  Foundations      → C0.1 repo+env  C0.2 db+migrate  C0.3 backend skeleton  C0.4 frontend shell
P1  Core+setup       → C1.1 schema(users/roles)  C1.2 self-auth+rbac  C1.3 setup wizard  C1.4 admin users/roles UI
P2  Infra docs       → C2.1 schema(servers/tags/apps/ports/conns)  C2.2 servers+tags API/UI  C2.3 apps+ports  C2.4 connections
P3  Viz + filesystem → C3.1 topology graph  C3.2 fs script generator  C3.3 fs paste-import+snapshots  C3.4 folder tree UI
P4  Vault core       → C4.1 crypto layer  C4.2 vaults+secrets schema/API  C4.3 reveal step-up+10s+audit  C4.4 history+generator+vault UI
P5  Notify + email   → C5.1 notif schema+center  C5.2 expiry scanner worker  C5.3 SMTP+test send  C5.4 cert expiry+digest
P6  Documents        → C6.1 upload+storage+metadata  C6.2 viewers (pdf/text/md/docx)+download
P7  Auth modes       → C7.1 AuthProvider refactor  C7.2 keycloak(+test compose)  C7.3 ldap  C7.4 TOTP
P8  Personal+API     → C8.1 personal vault(url+logo)  C8.2 api clients+X-API-Key  C8.3 read endpoints+webhooks
P9  Polish+harden    → C9.1 search+command palette  C9.2 soft-delete+recycle  C9.3 audit UI  C9.4 backup/restore+KEK rotation  C9.5 hardening+docs  C9.6 docker-e2e
```

### 19.2 Chunk detail

> Format per chunk — **Read** (sections to reload), **Build**, **Gate** (must pass).

**C0.1 — Repo & env contract**
- Read: §2, §13. Build: `git init`; write `.env.example` (all keys from §13);
  `backend/src/config.js` (frozen config, validates `AUTH_MODE`, `BIRO_MASTER_KEK`
  presence/length, `DATABASE_URL`); `.dockerignore`; start `PROGRESS.md`.
- Gate: `node -e "require('./backend/src/config.js')"` fails fast with a clear
  message when KEK/AUTH_MODE missing, succeeds when present.

**C0.2 — DB pool + migration runner**
- Read: §8. Build: `db/pool.js`, `db/migrate.js`, migration `0001_init` (extensions
  only). Compose `bi-ro-db` (postgres:16) + volume.
- Gate: `docker compose up bi-ro-db` healthy; `migrate` runs clean on empty DB and
  is idempotent on re-run.

**C0.3 — Backend skeleton**
- Read: §9, §12. Build: `server.js` (express 5, helmet, cors, requestId,
  errorHandler), `routes/health`, logger. Wire static-serve placeholder for
  frontend build.
- Gate: `GET /api/health` returns 200 JSON; errorHandler returns shaped JSON on a
  thrown error.

**C0.4 — Frontend shell + design tokens**
- Read: §10. Build: add TypeScript to frontend; Tailwind + `globals.css` tokens;
  ThemeProvider/Toggle; AppShell (sidebar 220px + topbar + content); base `ui/`
  (Button, Input, Card). `lib/api.ts` fetch wrapper.
- Gate: `npm run build` (frontend) succeeds; dev server renders themed AppShell;
  dark/light toggle works; controls match token sizes (btn 30px).

**C1.1 — Identity schema**
- Read: §3, §8. Build: migration for `users, roles, role_permissions, user_roles,
  user_permission_overrides, settings, setup_state`; seed built-in roles + flags.
- Gate: migrate applies; built-in roles present with correct flag sets.

**C1.2 — Self-auth + RBAC**
- Read: §6.3, §7.1–7.2. Build: `AuthProvider` interface + `auth/self.js`
  (Argon2id), session/JWT, `middleware/session.js` + `middleware/rbac.js`;
  `/api/auth/login|logout|me`.
- Gate: login issues session; an RBAC-guarded route 403s without the flag, 200s
  with it; passwords stored only as Argon2id hashes.

**C1.3 — First-launch setup wizard**
- Read: §7.1, §13. Build: `/api/setup/state` + `/api/setup/initialize` (one-time:
  sets title/accent, confirms AUTH_MODE, creates first admin, verifies KEK);
  frontend `/setup`. Block all app routes until initialized.
- Gate: fresh DB → wizard runs once, creates admin, logs in; re-running
  initialize is rejected.

**C1.4 — Admin users/roles UI**
- Read: §3, §10. Build: DataTable; `/api/admin/users`, `/api/admin/roles`;
  Settings shell page.
- Gate: admin creates a user + assigns a role via UI; non-admin cannot reach the
  admin pages.

**C2.1 — Infra schema**
- Read: §4.1, §8. Build: migration `servers, server_notes, tags, server_tags,
  apps, ports, connections` (servers include description/criticality/provider).
- Gate: migrate applies; FKs and enums (environment/exposure/status/criticality)
  enforced.

**C2.2 — Servers + tags (API + UI)**
- Read: §4.1, §10. Build: servers CRUD (description/criticality/provider + quick
  note) + tags CRUD; `server_notes` CRUD; servers list (filters: env, tag, status)
  + server detail with **overview** and **Notes** tabs (dated, authored, markdown
  entries, newest-first).
- Gate: document a server end-to-end incl. adding a couple of dated notes; filters
  work; `viewer` sees it, no secrets anywhere yet.

**C2.3 — Apps catalog + ports**
- Read: §4.1. Build: apps CRUD (logo, version, EOL); ports CRUD bound to
  server+app; server detail "ports/apps" tab.
- Gate: add app to a port; "what's on port N of server X" answerable in UI.

**C2.4 — Connections**
- Read: §4.1. Build: connections CRUD (from app-instance → to app-instance, label).
- Gate: create a connection; it appears under both endpoints' detail.

**C3.1 — Topology graph**
- Read: §11. Build: `/api/servers/:id/topology` + fleet topology; `TopologyCanvas`
  (React Flow) with pan/zoom, env grouping, node click → detail; blast-radius
  highlight.
- Gate: graph renders servers/apps/connections; clicking a node navigates;
  highlight traces dependents.

**C3.2 — Filesystem script generator**
- Read: §4.3. Build: `util/fsScript` generating bash + ps1 that emit the
  `bi-ro.fstree.v1` JSON; `POST /api/servers/:id/fs/generate-script`; UI shows the
  script (Monaco, read-only) with copy.
- Gate: generated bash + ps1 each run on a sample dir and produce schema-valid
  JSON for the chosen root + depth.

**C3.3 — Paste-import + snapshots**
- Read: §4.3, §8, §16. Build: `fs_snapshots, fs_nodes`; `POST .../fs/import`
  (strict schema + size/depth validation); versioned snapshots.
- Gate: pasting valid JSON stores a snapshot; malformed/oversized input is
  rejected with a clear error.

**C3.4 — Folder tree UI**
- Read: §11. Build: `FolderTree` (virtualized) with icons/size/mtime, search,
  snapshot switcher, link nodes → script/app.
- Gate: large tree renders smoothly; search filters; node→script link works.

**C4.1 — Crypto layer**
- Read: §6.2–6.3, §18 Q1. Build: `crypto/envelope.js` (KEK load, DEK gen,
  AES-256-GCM encrypt/decrypt, wrap/unwrap, `key_version`); `kms.js` stub behind
  the same interface. **Confirm Q1 (KEK custody) is answered first.**
- Gate: unit test: encrypt→decrypt round-trips; wrong KEK fails auth-tag; KEK
  re-wrap leaves payload ciphertext unchanged.

**C4.2 — Vaults + secrets**
- Read: §4.4, §8. Build: `vaults, vault_members, secrets, secret_tags`; secrets
  CRUD where **read never returns the value**; vault membership enforced.
- Gate: create a secret; GET returns metadata only (no ciphertext/value); a
  non-member is denied.

**C4.3 — Reveal: step-up + 10s + audit**
- Read: §6.4, §6.5. Build: `middleware/stepUp.js` (self mode now);
  `POST /api/secrets/:id/reveal` (re-auth required **every** time → permission +
  membership check → audit write → decrypt); `audit_log` + write path; frontend
  `RevealDialog` that shows the value for **exactly 10 seconds then re-masks**,
  with clipboard auto-clear.
- Gate: reveal requires re-enter+confirm each time; value visible 10s then hides;
  one audit row per reveal with actor/ip/ts.

**C4.4 — History + generator + vault UI**
- Read: §4.4, §4.5, §5, §6.4. Build: `secret_history` (encrypted prior values on
  change); **secret value create/update gated by the same step-up + audit as reveal**
  (metadata-only edits are not gated); saving a new value resets `last_changed_at`,
  recomputes next-due, re-arms warnings; password generator; vault list/detail +
  secret detail pages; server detail "credentials" tab showing `last_changed_at` +
  `days_remaining`.
- Gate: changing a secret value requires step-up + writes one audit row + writes
  history + resets the countdown; a metadata-only edit does not require step-up;
  generator produces to policy; server tab lists its credentials with expiry badges.

**C5.1 — Notification center**
- Read: §4.5, §8. Build: `notifications, notification_deliveries,
  notification_rules`; `/api/notifications`; in-app center + dashboard "expiring
  soon" widget.
- Gate: a manually created notification appears in center + dashboard; mark-read
  works.

**C5.2 — Expiry scanner worker**
- Read: §4.5. Build: `services/expiry.worker` (node-cron daily) computing
  days-to-expiry, firing rules at thresholds (7/2/0, configurable), with
  de-dup + re-arm on rotation.
- Gate: a near-expiry secret produces exactly one in-app notification at the right
  threshold; rotating re-arms it.

**C5.3 — SMTP + test send**
- Read: §4.5. Build: `integrations/smtp.js`; Settings SMTP config + "send test
  email"; email delivery for notifications (delivery status + retry).
- Gate: test email sends; an expiry notification also emails; failure shows in
  delivery status.

**C5.4 — Certificate expiry + digest**
- Read: §5. Build: certificate-type tracking through the same engine; weekly
  digest email.
- Gate: a cert near expiry notifies; digest renders current fleet + expiring items.

**C6.1 — Document upload & storage**
- Read: §4.6, §8. Build: `documents`; multipart upload to the `bi-ro-uploads`
  volume; mime allowlist + size limit; attach to any entity; checksum.
- Gate: attach a PDF to a script; disallowed type/oversize rejected; metadata
  stored, file on volume.

**C6.2 — Viewers + download**
- Read: §4.6. Build: PDF.js viewer, text/markdown inline, docx→HTML (mammoth,
  fallback download), download endpoint.
- Gate: PDF + text + docx each render or cleanly fall back; download works.

**C7.1 — AuthProvider refactor checkpoint**
- Read: §7. Build: ensure self-auth fully sits behind `AuthProvider`;
  `resolveRoles` + `stepUp` are provider methods; mapping config in Settings.
- Gate: self mode still fully works through the interface only (no direct calls).

**C7.2 — Keycloak mode + test compose**
- Read: §7.1, §7.3, §13, §18 Q3. Build: `auth/keycloak.js` (OIDC code+PKCE,
  group/role→role mapping, OIDC step-up for reveal); env-first connection (no
  Keycloak in app compose) with the **"configuration required" wizard fallback**
  (§7.1): if Keycloak env vars are missing/invalid, boot into the wizard, collect +
  validate via OIDC discovery, persist; ship `keycloak.test.compose.yaml` for local
  testing. **Confirm Q3 details first.**
- Gate: with `AUTH_MODE=keycloak` against the test Keycloak, a mapped user logs in
  and a reveal performs an OIDC step-up; with Keycloak vars unset, the app boots
  into the config wizard instead of crashing.

**C7.3 — LDAP mode**
- Read: §7.1, §7.4, §18 Q3. Build: `auth/ldap.js` (bind/search, group→role mapping,
  re-bind step-up); env-first config with the same **"configuration required"
  wizard fallback** (validate via a test bind, persist).
- Gate: with `AUTH_MODE=ldap`, a directory user logs in and reveal re-binds; with
  LDAP vars unset, the app boots into the config wizard instead of crashing.

**C7.4 — TOTP (self mode)**
- Read: §5, §7.2. Build: TOTP enrollment + verification at login and as a step-up
  factor.
- Gate: enroll TOTP; login requires it; step-up can use it.

**C8.1 — Personal vault**
- Read: §4.7, §8. Build: owner-only personal vault; entries with **URL + logo**
  (upload or favicon/catalog suggestion); same crypto + 10s reveal; launcher-style
  UI.
- Gate: a user manages personal entries with url+logo; another user (even admin)
  cannot read them.

**C8.2 — API clients + X-API-Key**
- Read: §4.8, §6.3. Build: `api_clients`; `middleware/apiKey.js` (hash compare,
  scopes, rate limit); admin UI showing the key **once** at creation.
- Gate: scoped key authenticates a read endpoint; key stored only as hash; revoked
  key rejected.

**C8.3 — Read endpoints + webhooks**
- Read: §4.8. Build: scoped read API (e.g. servers by tag); **no secret values**;
  optional webhooks for expiry/change events.
- Gate: external key lists servers by tag; secret values never returned; webhook
  fires on an expiry event.

**C9.1 — Search + command palette**
- Read: §5. Build: global search (servers/scripts/apps/docs/secret metadata, never
  values); `Ctrl/Cmd-K` palette.
- Gate: palette jumps to entities; search never surfaces secret values.

**C9.2 — Soft-delete + recycle bin**
- Read: §5, §8. Build: `deleted_at` everywhere user-facing; recycle bin + restore.
- Gate: delete→appears in bin→restore returns it; lists hide deleted by default.

**C9.3 — Audit UI**
- Read: §6.5. Build: filterable, read-only audit log page (admin).
- Gate: reveals/logins/changes appear; log not editable from the app.

**C9.4 — Backup/restore + KEK rotation**
- Read: §6.2, §16, §18 Q4. Build: encrypted export + restore path; KEK rotation
  tool (re-wrap DEKs under new `key_version`).
- Gate: backup→restore on a clean instance reproduces data; KEK rotation succeeds
  with no payload re-encryption and secrets still decrypt.

**C9.5 — Hardening + docs**
- Read: §6.6, §13. Build: rate limiting (auth/reveal), CSP, secure cookies, CSRF;
  empty/error/loading states audit; non-root Docker + healthcheck + resource
  limits; README + ops runbook (incl. KEK custody/backup).
- Gate: security checklist passes; `docker compose up` runs the hardened image;
  README lets a new operator deploy from scratch.

**C9.6 — Docker end-to-end validation**
- Read: §13, §19.0. Build: write a docker-e2e test script (or GitHub Actions job)
  that: (1) runs `docker compose build`, (2) `docker compose up -d`, (3) waits for
  `bi-ro` healthcheck to go green, (4) hits `GET /api/health` from the host and
  confirms 200 JSON, (5) confirms the database port is NOT reachable on the host
  (connection refused on 5432/5433), (6) runs `docker compose down -v`. Also verify
  the full first-run flow: env-seeded admin login, one server create, one reveal,
  check audit log entry — all inside the container stack with no external services
  needed. Document the test run in `PROGRESS.md` and in the ops runbook.
- Gate: the e2e script exits 0 on a clean machine from a cold start; the db port
  is confirmed unexposed; the app healthcheck passes; first-run flow succeeds end-to-end.

### 19.3 Resuming after a context reset

When starting fresh (new session / compaction): (1) read `PROGRESS.md` to find the
last green Gate; (2) read the **Read** sections for the next chunk; (3) verify the
last chunk's Gate still passes before continuing. Never assume prior chunks work —
re-run their Gate if in doubt.

---

---

## 20. CEO review — decisions & hardening (HOLD SCOPE)

A `/plan-ceo-review` was run on this design. Build approach chosen: **full build,
all features complete in v1, custom envelope crypto (D1) kept.** Review posture:
**HOLD SCOPE — maximum rigor** (no scope added; make the committed scope
bulletproof, vault first). Decisions below are binding and override any earlier
wording they touch.

### Binding decisions

| # | Finding | Decision | Where it lands |
|---|---------|----------|----------------|
| F2.1 | Reveal could return a value if the audit write failed | **Write-ahead audit, fail-closed** — audit committed before plaintext; audit failure blocks reveal | §6.4, P4 / C4.3 |
| F1.2 | KEK loss = total, unrecoverable vault loss; escrow was P9 | **KEK escrow is a P0 deliverable**; DB + KEK backup/restore drill **verified before P4** stores any real secret | §13, §16, P0 / C0.1 + pre-P4 gate |
| F3.2 | "Admin can't read personal vault" was ACL-only, not crypto | **Per-user key for personal vault**; team vaults keep recoverable KEK envelope | §4.7, §6.2, §8 |
| F1.3 | Topology/connections had no node to reference | **Add `app_instances` table**; ports + connections reference it | §8, §4.1 |
| F3.1 | Brute-force guard was parked in P9, reveal ships P4 | **Rate-limit + lockout on login/step-up ship with P4** | §6.6, P4 / C4.3 |
| F6.1 | No test strategy for a secrets vault | **Add Testing strategy (§21) + per-chunk test gates** | §21, §19 gates |
| F8.1 | Silently dead expiry worker hides the headline feature | **Manual rotation cycle made explicit (no server access)** + **local worker heartbeat** | §4.5 |
| F4.1 | Concurrent edits silently clobber a rotation | **Accepted risk: last-write-wins** (user decision) — not a gap | see Accepted risks |

### Folded recommendations (low-risk, incorporate during the relevant chunk)

- **Parameterized SQL everywhere** in repositories — no string interpolation (F5.1).
- **IDOR enforcement on every secret endpoint**, including `/secrets/:id/history`,
  not just reveal — check vault membership uniformly (F3.3).
- **Escape/parameterize LDAP filter input** on bind/search (F3.4).
- **Constant-time compare** for API-key hash checks (F3.2-api).
- **Worker crash isolation** — wrap each scan tick; the worker can never crash the
  web process (F1.1).
- **Setup wizard is single-shot + transactional** — no first-admin race on a fresh
  DB (F4.2).
- **Index `fs_nodes(snapshot_id)`**; batch the topology query to avoid N+1 (F7).
- **Migrate-on-boot rollback note** — a failed boot migration must have a defined
  recovery; document it (F9.1).
- **Clipboard auto-clear is best-effort** — state this honestly; the 10s re-mask is
  the real guarantee, clipboard clearing is unreliable cross-OS (F3.5).
- **Topology a11y fallback** — provide a table/list view of nodes+connections for
  keyboard/screen-reader users (F11.2).
- **Trim template cruft** — `util/mustache`, `util/eventPattern` came from a
  different project; drop if unused (F5.2).
- **Per-page interaction states** (loading/empty/error/partial) mapped as each page
  is built, not deferred to P9 (F11.1).

### Accepted risks

- **Last-write-wins on secret edits (F4.1).** Concurrent rotation of the same
  credential can silently overwrite the earlier save. Accepted by owner; revisit
  if shared-credential editing becomes common.
- **Server can decrypt team-vault secrets at rest (D1).** Accepted in office-hours;
  unchanged. Personal vaults are now exempt via per-user keys (F3.2).

### Phase impacts (apply on top of §14 / §19)

- **P0 / C0.1:** add KEK generation + escrow + a tested restore drill; add a gate
  before P4 that DB + KEK backup/restore is proven.
- **P2:** schema includes `app_instances`; ports/connections reference it.
- **P4 / C4.3:** reveal ships with write-ahead-audit-fail-closed **and**
  rate-limit + lockout; per-chunk gates cite the required tests (§21).
- **P8 / C8.1:** personal vault uses per-user keys, not the KEK envelope.

## 21. Testing strategy (CEO review F6.1)

Test pyramid: many unit, fewer integration, few E2E. Tests are part of each §19
chunk's Gate, not a later phase. Non-negotiable vault suites:

- **Crypto (C4.1):** encrypt→decrypt round-trip; wrong KEK / tampered ciphertext
  fails the auth tag; KEK re-wrap leaves payload ciphertext unchanged; per-user
  personal-vault key cannot be decrypted with the team KEK.
- **Reveal authz matrix (C4.3):** every (role × vault-membership) combination;
  non-member denied; viewer-without-reveal denied.
- **Audit-before-plaintext (C4.3):** simulate an audit-write failure → reveal is
  blocked and no value is returned.
- **Step-up per auth mode (C4.3, C7.x):** self password recheck, Keycloak OIDC
  step-up, LDAP re-bind; IdP/dir-down → fail closed.
- **Brute-force guard (C4.3):** rate-limit + lockout trip after N bad step-ups.
- **IDOR attempts:** access another vault's secret + history by ID → denied.
- **Expiry cycle (C5.2):** threshold firing at 7/2/0, de-dup once, **re-arm after
  manual rotation**, worker per-row isolation (one bad row doesn't abort the scan),
  heartbeat staleness alert.
- **fs import (C3.3):** valid JSON stored; malformed/oversized rejected.

Flakiness guard: no test depends on wall-clock, randomness, or external services
(inject clock + fakes). E2E covers the setup wizard, a full document→reveal flow,
and one topology render.

## Error & Rescue Registry (from Section 2)

```
METHOD/CODEPATH            | FAILURE                  | EXCEPTION         | RESCUED | ACTION                          | USER SEES
---------------------------|--------------------------|-------------------|---------|----------------------------------|---------------------------
secrets.reveal             | step-up auth fails       | AuthFailed        | Y       | 401, audit "denied"              | "Re-authentication failed"
secrets.reveal             | not member / no reveal    | Forbidden         | Y       | 403, audit "denied"              | "Not authorized"
secrets.reveal             | audit write fails        | AuditWriteError   | Y       | BLOCK reveal (fail-closed)       | "Could not record access; try again"
secrets.reveal             | auth-tag mismatch        | DecryptError      | Y       | 500 + admin alert (tamper/key)   | "Unable to decrypt"
step-up (kc/ldap)          | IdP / directory down     | UpstreamAuthError | Y       | fail closed                      | "Auth service unavailable"
expiry.worker tick         | one malformed secret row | RowScanError      | Y       | skip row, log, continue scan     | (nothing; logged + metric)
expiry.worker              | worker died / no run     | (heartbeat stale) | Y       | dashboard flag + admin email     | "Expiry scanner stale" banner
fs.import                  | malformed/oversized JSON | ValidationError   | Y       | 422 with detail                  | "Invalid/too-large output"
smtp.send                  | relay down / auth fail   | SmtpError         | Y       | delivery=failed, retry           | delivery status "failed"
repositories.*             | DB down / pool exhausted | DBError           | Y       | 503                              | "Service temporarily unavailable"
auth.login/step-up         | too many attempts        | RateLimited       | Y       | 429 + temporary lockout          | "Too many attempts, wait"
```

## Failure Modes Registry

```
CODEPATH            | FAILURE MODE              | RESCUED | TEST | USER SEES        | LOGGED
--------------------|---------------------------|---------|------|------------------|-------
reveal              | un-audited reveal         | Y       | Y    | error (blocked)  | Y
reveal              | tampered ciphertext       | Y       | Y    | error + alert    | Y
expiry.worker       | silent death              | Y       | Y    | dashboard+email  | Y
expiry.worker       | one bad row aborts scan   | Y       | Y    | nothing (skips)  | Y
secret edit         | concurrent clobber        | N*      | N*   | nothing          | partial
setup               | double first-admin        | Y       | Y    | second blocked   | Y
ldap step-up        | filter injection          | Y       | Y    | denied           | Y
personal vault      | admin reads another's     | Y(crypto)| Y   | impossible       | n/a
```
\* `secret edit` concurrent clobber is the one **accepted-risk** row (F4.1,
last-write-wins). No other row is a CRITICAL GAP after the decisions above.

## Required outputs

### NOT in scope (explicitly deferred)
- Active/agent server access (SSH, probes, auto-discovery) — D2, future collector phase.
- Optimistic concurrency on secret edits — F4.1, accepted last-write-wins instead.
- External/managed secret vault (HashiCorp/OpenBao) — D1 kept custom; reversal cost noted (§10).
- HA / clustering / public internet exposure — D3.
- Machine reveal of secret values over API — §17.

### What already exists
- Repo is an empty scaffold (React 19 + Vite JS, Express 5 ESM, empty Docker
  files). Nothing internal to reuse — fully greenfield.
- External Layer-2 building blocks already chosen well: React Flow, react-arborist,
  PDF.js, mammoth, node crypto. NetBox/Vaultwarden noted as the "buy" alternatives
  the owner chose **not** to take (full custom build).

### Dream-state delta
This plan reaches the passive single-pane (infra + scripts + vault + topology, fed
manually). The 12-month ideal adds active collectors auto-syncing the fleet (D2
future). The build-vs-buy split (embedding a vault engine) was offered and declined
— custom vault stands, with the F2.1/F3.1/F3.2/F6.1 hardening making it defensible.

## 22. Eng review — decisions (HOLD SCOPE)

A `/plan-eng-review` was run on this design. Decisions below are binding and
override any earlier wording they touch.

### Binding decisions

| # | Finding | Decision | Where it lands |
|---|---------|----------|----------------|
| E1 | Auth mixed cookie-session + Bearer-JWT signals | **Single httpOnly cookie session** (SameSite + Secure + CSRF) for all 3 human-auth modes; `X-API-Key` for machines. **Drop Bearer-JWT for humans** (remove `util/jwt` for human auth). | §6.6, §7, §9 |
| E6 | Security-critical backend was plain JS | **Whole backend in TypeScript** (build via tsx/tsup). Types guard the audit-before-reveal, key-handling, and authz paths. | §12 |
| E3 | Custom migration runner + interactive first-admin | **Fully automated first run:** a proven runner (node-pg-migrate, or Drizzle Kit if Drizzle is adopted) **auto-applies migrations on boot**; the **first admin is seeded from env** (`BIRO_ADMIN_EMAIL` + `BIRO_ADMIN_PASSWORD`, force-change on first login, env var removable after). `AUTH_MODE` + title/accent from env. Setup wizard becomes optional (non-secret config only). | §7.1, §13, §19 C0.2/C1.3 |

**E3 supersedes** the interactive first-admin creation in §7.1/§7.2 and the C1.3
wizard-creates-admin step, and **resolves CEO finding F4.2** (no setup race — env
seeding is idempotent). Subsequent users are still created by an admin (§7.2).

### Folded recommendations (incorporate during the relevant chunk)

- **Test stack: Vitest + Supertest** (Vitest matches the Vite frontend).
- **Add 3 E2E flows to §21:** first-run init idempotency, document attach→view,
  topology render.
- **Validate `settings` JSONB with a zod schema** on read/write (E8) — no silent
  misconfig of SMTP/auth-mappings.
- **Optional type-safe query layer** (Kysely or Drizzle) now that the backend is
  TS; otherwise parameterized `pg` (still the explicit default).
- **Env-seeded admin password hygiene:** force-change on first login; document that
  `BIRO_ADMIN_PASSWORD` should be rotated/removed from env after first boot.
- **Drop `util/mustache`, `util/jwt` (human auth), `util/eventPattern`** template
  cruft now that sessions replace JWT and the domain differs.

### Failure modes (eng additions)

```
CODEPATH         | FAILURE MODE              | RESCUED | TEST | USER SEES        | LOGGED
-----------------|---------------------------|---------|------|------------------|-------
boot migrations  | bad migration on startup  | Y       | Y    | container fails  | Y (recovery §16)
first-run seed   | env admin missing/weak    | Y       | Y    | boot refuses     | Y
auth (cookie)    | CSRF / session fixation   | Y       | Y    | denied           | Y
```
No new CRITICAL gaps beyond those already resolved in §20.

### Worktree parallelization strategy

| Step | Modules | Depends on |
|------|---------|------------|
| Backend foundations (config, db, migrations, crypto) | `backend/src/{config,db,crypto}` | — |
| Frontend shell + design system | `frontend/src/{styles,components/ui,components}` | — |
| Auth + RBAC + first-run seed | `backend/src/{integrations/auth,middleware,services}` | backend foundations |
| Infra/vault feature APIs | `backend/src/{routes,controllers,services,repositories}` | auth |
| Feature UIs (servers, topology, vault, …) | `frontend/src/pages` | feature APIs (contracts) |

- **Lane A (backend):** foundations → auth → feature APIs (sequential, shared `services/`).
- **Lane B (frontend):** shell + design system → feature UIs (UIs wait on API contracts).
- **Execution:** launch Lane A + Lane B foundations in parallel worktrees; feature
  UIs follow their API contracts. Clean split (Lane A = `backend/`, Lane B =
  `frontend/`), low merge risk.

## Implementation Tasks (synthesized from CEO + Eng findings)

- [ ] **T1 (P1)** — crypto — envelope encrypt/decrypt/wrap + per-user personal-vault key; tests: round-trip, wrong-key, re-wrap (C4.1, §21).
- [ ] **T2 (P1)** — vault/api — reveal endpoint: write-ahead audit fail-closed + rate-limit/lockout (C4.3, F2.1/F3.1).
- [ ] **T3 (P1)** — db — `app_instances` table; ports/connections reference it (C2.1, F1.3).
- [ ] **T4 (P1)** — ops — KEK gen + escrow + restore drill; gate before P4 (C0.1, F1.2).
- [ ] **T5 (P1)** — auth — single httpOnly cookie session + CSRF across 3 modes (E1).
- [ ] **T6 (P1)** — backend — TypeScript build; crypto/auth/services first (E6).
- [ ] **T7 (P1)** — boot — auto-migrate on startup + env-seeded admin, force-change (E3).
- [ ] **T8 (P1)** — worker — expiry scan + manual-rotation re-arm + heartbeat/stale alert (C5.2, F8.1).
- [ ] **T9 (P2)** — tests — Vitest + Supertest + 3 E2E flows; per-chunk gates (§21).
- [ ] **T10 (P2)** — quality — parameterized SQL, IDOR on all secret endpoints, LDAP filter escaping, zod settings (folded).

(JSONL task artifact skipped — no `jq`/git in this environment.)

## 23. Design review — decisions (APP UI)

A `/plan-design-review` was run. Classifier: **APP UI** (data-dense internal
workspace) → App-UI rules. Initial design completeness **7/10 → 9/10** after fixes.
Decisions below are binding.

### Binding decisions

| # | Pass | Decision |
|---|------|----------|
| D-1 | Interaction states (was 4/10) | **Add the full interaction-state table below** — every empty state gets warmth + a primary action. |
| D-2 | Responsive (was 4/10) | **Desktop-first:** full experience ≥1280px, usable to ~1024px (sidebar→icons, tables scroll-x). **No phone parity.** State it so implementers don't half-build mobile. |
| D-3 | Dashboard hierarchy | **Lead with "expiring soon + overdue" + active alerts** as the dominant block; totals second; recent activity third. Answers "what needs me now?" first. |

### Interaction-state table (D-1)

```
FEATURE            | LOADING            | EMPTY (warmth + CTA)                         | ERROR                          | PARTIAL
-------------------|--------------------|---------------------------------------------|--------------------------------|------------------------
Servers list       | skeleton rows      | "No servers yet — document your first."[+Add]| inline retry banner            | show loaded + "load more"
Topology           | canvas skeleton    | "Nothing mapped yet. Add servers + apps."   | "Couldn't load graph" + retry  | render known, badge missing
FS import          | parsing spinner    | "No snapshots. Generate a scan script."[Gen]| line-precise parse error       | n/a (atomic import)
Vault / secrets    | skeleton rows      | "No credentials here yet."[+Add]            | "Couldn't load" + retry        | metadata shown, value masked
Reveal             | "verifying…"       | n/a                                         | step-up failed / locked-out msg| n/a
Documents          | thumb skeletons    | "No documents attached."[Upload]            | unsupported/oversized message  | uploaded list + failed row
Notifications      | skeleton list      | "You're all caught up."                     | delivery-failed row + retry    | mixed sent/failed shown
Expiry dashboard   | skeleton cards     | "Nothing expiring. You're current." (calm)  | scanner-stale banner (F8.1)    | partial scan note
```

### User-journey storyboard (Pass 3)

```
FIRST RUN:   boot (env-seeded admin) -> login -> EMPTY dashboard ("all caught up")
             -> guided "document your first server" -> add credential -> first reveal
             FEELS: oriented, not lost; empty states reassure rather than scold.
REVEAL:      click Reveal -> re-auth modal ("confirm it's you") -> value shown with a
             10s countdown ring -> auto re-mask. FEELS: trusted but careful; the
             countdown makes the time limit visible, not surprising.
```

### Folded design specs

- **Reveal countdown:** a subtle circular countdown ring around the revealed value
  (accent stroke depleting over 10s); value re-masks at 0; "copied" toast on copy.
- **Custom components vs tokens:** TopologyCanvas (node = `--bg-elev` card, 1px
  `--border`, app logo + label `--text-sm`; selected = `--accent-soft` fill +
  `--accent-strong` ring), FolderTree (rows at `--btn-h` density, mono paths,
  `tabular-nums` sizes), RevealDialog (compact, focus-trapped, `--danger` on lockout).
- **Dashboard is NOT a card-mosaic** (App-UI rule): one dominant expiry panel, not
  6 equal tiles.
- **Accessibility baseline:** keyboard nav on all tables + command palette; visible
  2px `--accent-strong` focus rings (already in §10); body text ≥13px at ≥4.5:1
  contrast; reveal dialog focus-trapped; **topology + folder tree ship a
  table/list fallback view** for keyboard/screen-reader users (F11.2); status
  conveyed by label+icon, not color alone.

### Remaining pass ratings

Pass 1 IA 7→9 (hierarchy specified) · Pass 2 states 4→9 (table added) · Pass 3
journey 5→8 (storyboard added) · Pass 4 slop 8→9 (no-mosaic locked) · Pass 5 system
9→10 (custom components spec'd) · Pass 6 responsive/a11y 4→8 (desktop-first +
a11y baseline). **Overall 7→9.**

### Mockups
Not generated in this pass (the gstack designer calls an external image service +
opens a browser board). Available on request via `/design-shotgun` or the designer
binary once you want visual variants of the dashboard / topology / reveal.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_resolved | HOLD; 7 decided, 1 accepted-risk, 12 folded |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_resolved | 3 decided (E1/E6/E3) + 6 folded; 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_resolved | 7→9/10; 3 decided + states table + journey + a11y |

- **CROSS-MODEL:** outside-voice (independent 2nd model) not run in any review — offered, available on request.
- **VERDICT:** CEO + ENG + DESIGN complete (HOLD SCOPE). Vault hardened; stack locked
  (httpOnly sessions, backend TS, auto-migrate + env-seeded admin); design at 9/10
  (interaction-state table, desktop-first, expiry-first dashboard, a11y baseline).
  Ready to implement — start at §19 C0.1.

**UNRESOLVED DECISIONS:**
- Outside-voice (independent 2nd-model review) not run — offered, run on request.

---

*End of design. Implementation follows §19 + §20 + §22 + §23 starting at C0.1; do not skip chunks.*

---

## 24. As-built specification — current implementation

This section documents what was actually built. Where it differs from §1–§23, this section is authoritative.

### 24.1 Frontend stack (actual)

| Planned | Actual |
|---------|--------|
| Tailwind CSS | Plain inline CSS + CSS custom properties |
| shadcn/ui component library | Custom minimal components in `frontend/src/components/ui/` (`Button`, `Input`, `Card`) |
| class-variance-authority | Not used |
| lucide-react icons | Inline SVG paths; no icon library |
| react-router v6 | Custom `if/else` path matching in `App.tsx`; `window.history.pushState` + `popstate` |
| `main.jsx` / `App.jsx` | `main.tsx` / `App.tsx` (TypeScript throughout) |

CSS tokens are injected by `ThemeProvider` as a `<style>` block into `<head>`. Dark/light toggle swaps the full token set. Token names and values follow §10 exactly.

### 24.2 Backend stack (actual)

- **TypeScript throughout** (per eng review E6). Entry point: `backend/src/server.ts`.
- **Session auth only** (httpOnly cookie, SameSite=Strict). No Bearer-JWT for human users (per eng review E1).
- **Auto-migrate on boot** via custom `runMigrations()` in `backend/src/db/migrate.ts`. Migrations are in `backend/migrations/` numbered `0001` → `0017` (append-only).
- **Raw parameterized `pg` queries** throughout (no ORM). Follows F5.1 parameterized-SQL requirement.
- **First admin** seeded from env (`BIRO_ADMIN_EMAIL` + `BIRO_ADMIN_PASSWORD`) on first boot; force-change on first login (per eng review E3).

### 24.3 Login page

The login form card shows (top to bottom, all centered):
1. App logo (`/favicon.svg`, 52×52px)
2. App title in muted small text (`--text-muted`, 13px)
3. "Sign in" heading (`--text`, 16px, semibold)
4. Email + password fields and submit button

### 24.4 Apps — ownership model (implemented)

**Migrations:** `0015_apps_vault.sql` (adds `vault_id`) and `0016_apps_owner.sql` (adds `owner_id`).

**Visibility rules (enforced in `GET /apps` SQL):**
```sql
WHERE a.deleted_at IS NULL AND (
  $1 -- isAdmin: sees all
  OR (a.vault_id IS NULL AND a.owner_id = $2)                      -- personal app
  OR (a.vault_id IS NOT NULL AND EXISTS (                           -- vault app
    SELECT 1 FROM vault_members vm
    WHERE vm.vault_id = a.vault_id AND vm.user_id = $2))
)
```

**`canEdit` computed per row:**
```sql
($1 OR                                                              -- admin
 (a.vault_id IS NULL AND a.owner_id = $2) OR                       -- personal owner
 (a.vault_id IS NOT NULL AND EXISTS (                              -- vault manager
   SELECT 1 FROM vault_members vm
   WHERE vm.vault_id = a.vault_id AND vm.user_id = $2
   AND vm.access = 'manage')))  AS can_edit
```

**Nav + route:** The `/apps` route has no permission guard — accessible to all authenticated users. The sidebar "Apps" item has no `permission` field.

**Creating apps:** Any authenticated user can call `POST /apps` (no `servers.write` required). `owner_id` is always set to the caller. Assigning `vaultId` requires the caller to be any vault member.

**Editing apps:** `PATCH /apps/:id` checks vault membership and ownership before allowing edits. Reassigning to a different vault requires membership in the target vault too (IDOR fix).

### 24.5 Team vault credentials in Apps page

`GET /apps/:id/secrets` requires `secrets.view`. Returns team-vault secrets where:
- `s.app_id = <appId>`
- The caller is a member of `s.vault_id`
- `s.deleted_at IS NULL`

`days_remaining` is computed with the same `CASE WHEN` expression used in `vault.ts` (not a column).

In the Apps page expanded row, vault apps show team credentials with a `RevealDialog` (10-second modal, audited). Personal apps show their personal vault entries (§24.6) instead.

### 24.6 Personal vault entries linked to personal apps (implemented)

**Migration:** `0017_personal_entries_app.sql` adds `app_id UUID REFERENCES apps(id) ON DELETE SET NULL` to `personal_entries`.

**Backend changes:**
- `GET /personal-vault/entries` — accepts optional `?appId=` query param; returns `appId` in each entry.
- `POST /personal-vault/entries` — accepts `appId`; validates the app exists and is a personal app owned by the caller (`vault_id IS NULL AND owner_id = userId`).
- `PATCH /personal-vault/entries/:id` — accepts `appId` (or `null` to unlink); same validation.

**Personal vault page:** When the user has personal apps, both the "add entry" and "edit entry" forms show a "Link to personal app" dropdown populated from `GET /apps` (filtered to `vaultId === null`).

**Apps page — personal apps:** When a personal app row is expanded, the Credentials section fetches `GET /personal-vault/entries?appId=<id>`. Each entry shows title + username, with an inline reveal flow:
- Click "Reveal" → inline password input appears.
- User enters vault password → `POST /personal-vault/entries/:id/reveal`.
- Value shown for 10 seconds with countdown badge + clipboard copy button (auto-clears clipboard on expiry).
- All state (countdown, copy feedback, password prompt) is managed in `AppsPage.tsx` independently per entry.

### 24.7 Vault management UI (implemented)

**`VaultDetailPage.tsx`** includes:
- **Credential create form:** radio toggle to pick "Server" or "App" as the link type (not two independent dropdowns). A single dropdown shows servers or personal apps depending on the selection.
- **Credential edit modal:** same radio toggle.
- **Add vault member:** debounced user search field calling `GET /vault/users?q=` + access level picker (`view` / `reveal` / `manage`) + Add button.
- **Remove member:** `ConfirmDialog` before removal.
- **Delete secret:** `ConfirmDialog` before deletion.

`GET /vault/users?q=` requires `vault.manage_access`; returns up to 50 matching users (by display name or email).

`GET /vaults/:id/secrets` includes LEFT JOINs for `server_hostname` and `app_name` so the vault detail list can show what each credential is linked to.

`PATCH /secrets/:id` supports updating `type`, `appId`, and `serverId` fields in addition to the standard metadata.

### 24.8 Migrations applied (in order)

| # | File | Change |
|---|------|--------|
| 0001–0014 | initial + feature migrations | core schema through phase 8 |
| 0015 | `0015_apps_vault.sql` | `apps.vault_id UUID REFERENCES vaults(id)` |
| 0016 | `0016_apps_owner.sql` | `apps.owner_id UUID REFERENCES users(id)` |
| 0017 | `0017_personal_entries_app.sql` | `personal_entries.app_id UUID REFERENCES apps(id)` |

### 24.9 Security notes (as-built)

- **IDOR on `PATCH /apps/:id`** was present in an earlier version (any `servers.write` user could reassign apps to any vault). Fixed: the route now fetches the existing `vault_id` and `owner_id` before deciding whether to allow the edit.
- **Personal vault reveal endpoint** (`POST /personal-vault/entries/:id/reveal`) is IDOR-safe: WHERE clause includes `owner_id = userId`.
- **`GET /apps/:id/secrets`** uses `JOIN vault_members vm ON vm.vault_id = s.vault_id AND vm.user_id = $2` — non-members cannot retrieve credentials even by guessing an `appId`.
- **`days_remaining` was referenced as a column** in an early version of `GET /apps/:id/secrets`, causing PostgreSQL to throw and the frontend to silently show "No credentials linked." Fixed by replacing `s.days_remaining` with the full `CASE WHEN` expression.
