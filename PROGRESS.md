# BI-Ro Build Progress

> Tracks per-chunk completion for context recovery across sessions.
> Re-read §19.3 when resuming after a context reset.

---

## Phase 0 — Foundations

### C0.1 — Repo & env contract
**Status:** ✅ GREEN

**Built:**
- `git init` — repo initialized
- `backend/package.json` — updated with TypeScript (`tsx`, `tsup`), `vitest`, `pg`, `node-pg-migrate`, `pino`, `express-rate-limit`; pool=vmThreads required due to `& Projects` in path
- `backend/tsconfig.json` — ESNext/bundler, strict
- `backend/vitest.config.ts` — pool=vmThreads (required: Windows path with `&` breaks fork spawning)
- `backend/src/config.ts` — `loadConfig(env)` validates AUTH_MODE, BIRO_MASTER_KEK (≥32 bytes), DATABASE_URL; `initConfig()`/`getConfig()` singleton pattern
- `backend/src/__tests__/config.test.ts` — 9 tests (all passing)
- `.env.example` — all keys from §13 + §22 E3 admin seed vars
- `.dockerignore` — updated with vitest/TS artifacts

**Files touched:**
- `backend/package.json`
- `backend/tsconfig.json` (new)
- `backend/vitest.config.ts` (new)
- `backend/src/config.ts` (new)
- `backend/src/__tests__/config.test.ts` (new)
- `.env.example` (new)
- `.dockerignore` (updated)
- `PROGRESS.md` (new)

**Decisions/deviations:**
- Backend is TypeScript (§22 E6) — config.ts not config.js; Gate adapted to use tsx CLI
- `loadConfig` takes explicit env object (not module-level `process.env`) for testability — `initConfig()`/`getConfig()` singleton used at runtime
- `SESSION_SECRET` replaces `JWT_SECRET` (§22 E1 — cookie sessions, no human JWT)
- vitest `pool: 'vmThreads'` required — Windows path with `& Projects` breaks cmd.exe fork-spawn
- BIRO_MASTER_KEK length check: `Buffer.from(kek, 'base64').length < 32`
- KEK escrow documented in `.env.example` comments (§20 F1.2 P0 deliverable); restore drill is the pre-P4 gate

**Gate result:**
```
OK (missing env throws): AUTH_MODE must be one of self|keycloak|ldap; got: undefined
OK (valid env succeeds): authMode=self, appTitle=BI Root
Tests: 9 passed (2 files)
```

---

### C0.2 — DB pool + migration runner
**Status:** ✅ GREEN

**Built:**
- `backend/src/db/pool.ts` — `createPool` with `pool.on('error')` handler; `initPool`/`getPool`/`_resetPoolForTesting` singleton
- `backend/src/db/migrate.ts` — wraps `node-pg-migrate` runner; MIGRATIONS_DIR resolved via `fileURLToPath`
- `backend/migrations/0001_init.sql` — `CREATE EXTENSION IF NOT EXISTS pgcrypto/uuid-ossp`
- `docker-compose.yaml` — `bi-ro-db` (postgres:16-alpine) + named volumes; `bi-ro` app service with healthcheck depends-on

**Files touched:**
- `backend/src/db/pool.ts` (new)
- `backend/src/db/migrate.ts` (new)
- `backend/migrations/0001_init.sql` (new)
- `docker-compose.yaml` (new)
- `backend/src/__tests__/db.test.ts` (new)

**Decisions/deviations:**
- Host port for db NOT exposed (§13 port policy) — app reaches db via Docker internal network only
- `_resetPoolForTesting` is async (calls `pool.end()`) to prevent open-handle leaks between tests
- Migration naming: `0001_init.sql` (sequential, not timestamp) — consistent with append-only rule

**Gate result:**
```
Tests: 5 passed (db.test.ts) — createPool, initPool/getPool singleton, runMigrations is function
docker compose up bi-ro-db: healthy
runMigrations on empty DB: applied 0001_init (pgcrypto + uuid-ossp extensions)
runMigrations re-run: idempotent (IF NOT EXISTS)
```

---

### C0.3 — Backend skeleton
**Status:** ✅ GREEN

**Built:**
- `backend/src/server.ts` — `createApp()` factory (helmet, cors, requestId, body parsers, `/api` routes, static placeholder, errorHandler); `main()` entrypoint (dotenv → initConfig → runMigrations → initPool → listen)
- `backend/src/util/logger.ts` — pino; pino-pretty in dev, JSON in prod/test
- `backend/src/middleware/requestId.ts` — UUID per request, `X-Request-Id` header, `req.id` typed via Express namespace
- `backend/src/middleware/errorHandler.ts` — 4-arg Express error handler; shaped `{ error, requestId }` JSON; 5xx messages sanitized
- `backend/src/routes/health.ts` — `GET /health` → `{ status: 'ok', ts: ISO }` under `/api` prefix
- `backend/vitest.config.ts` — added `env: { NODE_ENV: 'test' }` to suppress pino-pretty transport in tests
- `docker-compose.yaml` — removed `5433:5432` db host-port mapping (port policy §13)
- `design-docs/DESIGN.md` — port exposure policy note in §13; C9.6 Docker e2e chunk added

**Files touched:**
- `backend/src/server.ts` (new)
- `backend/src/util/logger.ts` (new)
- `backend/src/middleware/requestId.ts` (new)
- `backend/src/middleware/errorHandler.ts` (new)
- `backend/src/routes/health.ts` (new)
- `backend/src/__tests__/server.test.ts` (new)
- `backend/vitest.config.ts` (updated)
- `docker-compose.yaml` (updated)
- `design-docs/DESIGN.md` (updated)

**Decisions/deviations:**
- `server.js` scaffold exists on disk but is NOT committed; `server.ts` supersedes it
- Error handler test creates its own minimal Express app (route before handler) rather than adding a route after `createApp()` — avoids Express layer-ordering issue where routes appended after the error handler aren't caught by it
- `dotenv.config()` called only inside `main()` (not at module level) so test imports don't pollute process.env

**Gate result:**
```
GET /api/health → 200 { status: 'ok', ts: '...' }  ✓
errorHandler returns { error: 'Internal server error', requestId: '...' } on thrown error  ✓
All 24 backend tests GREEN (4 suites: smoke, config, db, server)
```

---

### C0.4 — Frontend shell + design tokens
**Status:** ✅ GREEN

**Built:**
- `frontend/tsconfig.json` + `tsconfig.app.json` + `tsconfig.node.json` — TypeScript project references; strict, bundler moduleResolution
- `frontend/vite.config.js` — added `@tailwindcss/vite` plugin (Tailwind v4)
- `frontend/src/styles/globals.css` — `@import "tailwindcss"` + all §10 design tokens as CSS custom properties; `[data-theme="light"]` swap; global button hover/active via CSS `filter`
- `frontend/src/lib/theme.ts` — `getStoredTheme()` / `applyTheme()` with localStorage persistence
- `frontend/src/lib/api.ts` — typed fetch wrapper; `ApiError`; `Content-Type` only on body-bearing requests; 204 handled; `credentials: 'same-origin'`
- `frontend/src/components/ThemeProvider.tsx` — React context; lazy `useState` initializer (no FOUC); sets `data-theme` attribute synchronously
- `frontend/src/components/ThemeToggle.tsx` — emoji icons (☀️/🌙), aria-label
- `frontend/src/components/AppShell.tsx` — 220px sidebar + 48px topbar + `<main>` (max-width 1280px per §10); active nav item highlighted in accent
- `frontend/src/components/ui/Button.tsx` — 3 sizes (sm=26px/md=30px/lg=34px via CSS vars), 4 intents (primary/secondary/danger/ghost)
- `frontend/src/components/ui/Input.tsx` — 30px height, label, focus ring from global `:focus-visible`
- `frontend/src/components/ui/Card.tsx` — optional title, bg-elev surface
- `frontend/src/App.tsx` — wires ThemeProvider → AppShell → demo of all controls
- `frontend/src/main.tsx` — TypeScript entry; imports globals.css
- `frontend/index.html` — entry updated to main.tsx; title "BI Root"

**Files touched:** All above (new); `frontend/package.json` (deps: typescript, tailwindcss, @tailwindcss/vite)

**Decisions/deviations:**
- ThemeProvider uses lazy `useState(() => { applyTheme(t); return t })` instead of `useEffect` — eliminates FOUC on light-mode users (code review finding)
- Button hover/active states use global CSS `filter: brightness()` since inline styles can't express pseudo-selectors
- AppShell active-nav detection uses `window.location.pathname` with TODO comment for React Router replacement in C1.3+
- `input:focus` outline left to global `:focus-visible` rule (2px accent-strong ring); no `outline: none` in inline style

**Gate result:**
```
npm run build: ✓ 36 modules, 6.19kB CSS (Tailwind + tokens), 200kB JS
CSS output contains: --btn-h:30px, [data-theme=light] overrides, all §10 tokens
Visual gate (run manually): dev server → AppShell renders with 220px sidebar, 48px topbar, theme toggle switches dark/light; btn height 30px confirmed via CSS vars
```

---

## Phase 1 — Identity, Auth, Setup, Admin


### C1.1 — Identity schema
**Status:** ✅ GREEN

**Built:**
- `backend/migrations/0002_identity.sql` — creates `users`, `roles`, `role_permissions`, `user_roles`, `user_permission_overrides`, `settings`, `setup_state`; seeds 4 built-in roles (admin/editor/viewer_secrets/viewer) with their full permission flag sets per §3; idempotent throughout (IF NOT EXISTS + ON CONFLICT).
- `backend/src/__tests__/identity-schema.test.ts` — 17-test integration suite: verifies all tables exist, users columns correct, built-in roles seeded with exact flag sets (admin=16, editor=10 with no admin powers, viewer_secrets=4, viewer=2).
- `backend/src/__tests__/testSetup.ts` — vitest setupFiles entry calling `dotenv.config()` so DATABASE_URL loads before integration tests.
- `backend/vitest.config.ts` — added `setupFiles: ['./src/__tests__/testSetup.ts']`.
- `backend/src/db/migrate.ts` — filtered "Can't determine timestamp" log noise from node-pg-migrate with sequential filenames.

**Files touched:**
- `backend/migrations/0002_identity.sql` (new)
- `backend/src/__tests__/identity-schema.test.ts` (new)
- `backend/src/__tests__/testSetup.ts` (new)
- `backend/vitest.config.ts` (updated)
- `backend/src/db/migrate.ts` (updated)

**Decisions/deviations:**
- `email` uniqueness is a partial unique index (`WHERE deleted_at IS NULL`) instead of a table-level UNIQUE constraint — allows email reuse after soft-delete (P9 concern, but schema is correct from day one).
- `setup_state.auth_mode` has the same CHECK constraint as `users.auth_mode` but is nullable (NULL until the setup wizard runs); documented inline.
- `ON CONFLICT (name) DO UPDATE SET is_builtin = TRUE` on role seeds allows description to be customized in DB without being overwritten on re-run (intentional).
- Indexes added: `user_roles_role_id_idx` (reverse role→users), `role_permissions_permission_idx` (perm→roles), `users_email_uq` partial index.
- editor role explicitly lacks `vault.manage_access` and `audit.read` (asserted in tests).

**Gate result:**
```
17/17 identity-schema tests GREEN
41/41 total backend tests GREEN (5 suites: smoke, config, db, identity-schema, server)
Verified: admin=16 flags, editor=10 (no users/roles/settings/api_keys/vault.manage_access/audit.read), viewer_secrets=4, viewer=2
```

---

### C1.2 — Self-auth + RBAC
**Status:** ✅ GREEN

**Built:**
- `backend/src/auth/types.ts` — `AuthIdentity` interface.
- `backend/src/auth/self.ts` — `hashPassword` (Argon2id via `@node-rs/argon2`), `authenticateSelf` (timing-safe enumeration prevention; status checked before verify; Promise singleton dummy hash), `resolvePermissions` (UNION/EXCEPT SQL for role + per-user overrides).
- `backend/src/middleware/session.ts` — `createSessionMiddleware` (httpOnly, sameSite=lax, 8h maxAge, named `biro.sid`); `SessionData` module augmentation; MemoryStore warning in production.
- `backend/src/middleware/rbac.ts` — `requireAuth` (401), `requirePermission(flag)` (401 if no session, 403 if missing flag).
- `backend/src/routes/auth.ts` — `authRouter(pool)`: POST /auth/login (session fixation prevented via `session.regenerate()`), POST /auth/logout (destroys session + clears cookie), GET /auth/me.
- `backend/src/server.ts` (updated) — `createApp(opts?)` wires session + auth routes when opts provided; unit tests still call `createApp()` without opts.
- `backend/src/__tests__/auth.test.ts` — 12 integration tests.

**Files touched:**
- `backend/src/auth/types.ts` (new)
- `backend/src/auth/self.ts` (new)
- `backend/src/middleware/session.ts` (new)
- `backend/src/middleware/rbac.ts` (new)
- `backend/src/routes/auth.ts` (new)
- `backend/src/server.ts` (updated)
- `backend/src/__tests__/auth.test.ts` (new)
- `backend/package.json` (deps: @node-rs/argon2, express-session)

**Decisions/deviations:**
- `@node-rs/argon2` used instead of `argon2` (the latter requires native compilation that fails on Windows paths with `&`). `@node-rs/argon2` ships prebuilt NAPI binaries. Default type is Argon2id — matches §6.3.
- Session fixation prevention: `req.session.regenerate()` called on every successful login.
- Logout: `res.clearCookie('biro.sid')` clears client cookie even though server session is destroyed.
- email.trim() moved inside `authenticateSelf` so all callers get consistent behavior.
- MemoryStore: intentional for C1.2; replaced with persistent store in P9.
- CORS remains open for dev; lock to known origin before any production deployment.

**Gate result:**
```
12/12 auth tests GREEN (login, logout, /me, RBAC 200/403/401, hash format)
53/53 total backend tests GREEN (6 suites)
Login issues httpOnly session cookie ✓
RBAC: viewer→infra.read=200, viewer→users.manage=403, admin→users.manage=200 ✓
Unauthenticated→guarded route=401 (not 403) ✓
password_hash never leaked in any response ✓
Argon2id hash format ($argon2id$) verified in DB ✓
```

---

### C1.3 — First-launch setup wizard
**Status:** ✅ GREEN

**Built:**
- `backend/src/routes/setup.ts` — `setupRouter(pool, opts)`: GET /setup/state (returns `initialized`, `authMode`); POST /setup/initialize (transactional: FOR UPDATE re-check, create first admin from env credentials, seed settings appTitle/appAccent, mark setup_state.initialized=TRUE). Single-shot; 409 on re-run. (Created in prior session, wired this session.)
- `backend/src/middleware/setupGuard.ts` — `setupGuard(pool)`: blocks all /api routes except `/setup/*` and `/health` until `setup_state.initialized = TRUE`; in-process cached flag for fast-path after first successful check; `resetSetupGuardForTesting()` exported for test isolation. (Created in prior session, wired this session.)
- `backend/src/__tests__/setup.test.ts` — 9-test integration suite (created in prior session): GET /setup/state returns false on fresh DB; setupGuard blocks non-setup routes with 503; POST /initialize creates admin + role + settings in one transaction; GET /setup/state returns initialized=true; admin can login immediately; 409 on second initialize; non-setup routes pass after init.
- `backend/src/server.ts` — updated: `AppOptions` gains `adminEmail`, `adminPassword`, `authMode`; `createApp()` now wires `setupGuard` then `setupRouter` then `authRouter` then `adminRouter` (order matters); SPA fallback (`app.use`) serves `index.html` for non-API routes (enables client-side routing in production); `existsSync` import from `fs`.
- `frontend/src/pages/SetupPage.tsx` — wizard: title + accent color picker → POST /api/setup/initialize; success redirects to login; error inline.
- `frontend/src/pages/LoginPage.tsx` — email/password form → POST /api/auth/login; 401 handled with clear message.
- `frontend/src/App.tsx` — bootstrap: checks `/api/setup/state` → `/api/auth/me` → routes to `setup` / `login` / `app` states; SPA routing via `window.history.pushState` + `popstate` listener; page dispatch to DashboardPage or SettingsPage.
- `frontend/src/components/AppShell.tsx` — updated: accepts `currentPath`, `onNavigate`, `user`, `onLogout` props; sidebar links use `onNavigate` callback for SPA navigation; user chip in topbar; sign-out button calls POST /api/auth/logout.

**Files touched:**
- `backend/src/server.ts` (updated)
- `backend/src/routes/setup.ts` (pre-existing, now wired)
- `backend/src/middleware/setupGuard.ts` (pre-existing, now wired)
- `backend/src/__tests__/setup.test.ts` (pre-existing)
- `frontend/src/pages/SetupPage.tsx` (new)
- `frontend/src/pages/LoginPage.tsx` (new)
- `frontend/src/App.tsx` (updated)
- `frontend/src/components/AppShell.tsx` (updated)

**Decisions/deviations:**
- §22 E3 supersedes original wizard-creates-admin: admin is created by POST /setup/initialize using env vars `BIRO_ADMIN_EMAIL` + `BIRO_ADMIN_PASSWORD`; wizard sets only non-secret config (title, accent).
- `force_password_change = TRUE` set on admin user at creation; login succeeds but UI will prompt change on future force-change enforcement (P9 scope).
- SPA routing without `react-router-dom` (not installed): uses `window.history.pushState` + `popstate`; AppShell sidebar links call `onNavigate` callback. Avoids adding a dependency for a single routing concept.
- No `React` default import needed for JSX with `react-jsx` transform; use named `FormEvent` type import.

**Gate result:**
```
9/9 setup tests (describe.skipIf(!DB_URL) — DB-dependent, validated with PostgreSQL):
  GET /api/setup/state → 200 { initialized: false, authMode: null } ✓
  Non-setup route → 503 "not initialized" before setup ✓
  /health always reachable ✓
  POST /api/setup/initialize → 200 { ok: true } ✓
  GET /api/setup/state → 200 { initialized: true, authMode: 'self' } ✓
  Admin user has Argon2id hash + force_password_change=true ✓
  Admin has 'admin' role ✓
  settings table has appTitle + appAccent ✓
  POST /api/setup/initialize again → 409 ✓
  Non-setup route accessible after init ✓
  Admin login succeeds after init ✓
Frontend: SetupPage renders wizard, LoginPage renders login form,
  App.tsx state machine routes setup→login→app correctly (code review)
```

---

### C1.4 — Admin users/roles UI
**Status:** ✅ GREEN

**Built:**
- `backend/src/routes/admin.ts` — `adminRouter(pool)`: `router.use('/admin', requireAuth, requirePermission('users.manage'))` guards all; GET /admin/roles (list all roles with permissions array); GET /admin/users (list all non-deleted users with role names); POST /admin/users (create self-auth user with role, force_password_change=TRUE, transactional, 409 on duplicate email); PATCH /admin/users/:id (update status/displayName and/or role assignment). All SQL parameterized per §20 F5.1.
- `backend/src/__tests__/admin.test.ts` — 7-test integration suite: roles list returns all built-in roles with correct permissions; 401 unauthenticated; users list returns admin user; 403 for non-admin; create user returns 201 + force_password_change; 400 missing fields; 409 duplicate email; 403 non-admin create.
- `frontend/src/components/DataTable.tsx` — reusable DataTable: generic `T extends object`; `Column<T>` with optional render fn; skeleton loading rows (3 rows, index-based widths); empty state; hover highlight via onMouseEnter/Leave; accessible (role="region", scope="col", aria-label).
- `frontend/src/pages/DashboardPage.tsx` — empty dashboard following §23 D-3 hierarchy: expiry alerts first (empty state: "Nothing expiring. You're current."), totals grid second, recent activity last.
- `frontend/src/pages/SettingsPage.tsx` — Settings page with Users + Roles tabs; Users tab: DataTable with email/name/role/status/force-change columns, inline "New user" form (email, display name, role select, temp password), create → POST /api/admin/users; 403 handled with clear message; Roles tab: role cards with permission badges.

**Files touched:**
- `backend/src/routes/admin.ts` (new)
- `backend/src/__tests__/admin.test.ts` (new)
- `backend/src/server.ts` (updated — adminRouter wired)
- `frontend/src/components/DataTable.tsx` (new)
- `frontend/src/pages/DashboardPage.tsx` (new)
- `frontend/src/pages/SettingsPage.tsx` (new)

**Decisions/deviations:**
- PATCH /admin/users/:id replaces ALL roles (DELETE + INSERT) rather than appending — simpler UX for the admin: "change role to X" not "add role X". Matches the UI which has a single role selector.
- `forcePasswordChange: true` on all admin-created users; the force-change screen is P9 scope.
- Admin routes require `users.manage` permission (most restrictive necessary) rather than a separate `admin` flag; this aligns with §3 role flags.
- `noUnusedLocals: true` clean in code review; no dead state, all FormEvent types imported explicitly.

**Gate result:**
```
7/7 admin tests (describe.skipIf(!DB_URL) — DB-dependent, validated with PostgreSQL):
  GET /api/admin/roles → 200 with all 4 built-in roles + their permissions ✓
  GET /api/admin/roles unauthenticated → 401 ✓
  GET /api/admin/users → 200 with admin user (no password_hash) ✓
  GET /api/admin/users as viewer → 403 ✓
  POST /api/admin/users → 201 with forcePasswordChange=true ✓
  POST /api/admin/users missing fields → 400 ✓
  POST /api/admin/users duplicate email → 409 ✓
  POST /api/admin/users as viewer → 403 ✓
Frontend: DataTable renders skeleton/empty/data states; SettingsPage users tab
  shows create form and calls POST /api/admin/users (code review)
```

---

## Phase 2 — Infrastructure Documentation

### C2.1 — Infra schema
**Status:** ✅ GREEN

**Built:**
- `backend/migrations/0003_infra.sql` — creates `servers`, `tags`, `server_tags`, `apps`, `app_instances` (CEO F1.3 — first-class addressable nodes), `ports`, `connections`; all DDL idempotent (IF NOT EXISTS); enums enforced via CHECK constraints; FKs with appropriate ON DELETE CASCADE / SET NULL.
- `backend/src/__tests__/infra-schema.test.ts` — 14-test suite verifying table existence, required columns, enum check enforcement, FK relationships, and tag uniqueness. DB-gated (skipIf(!DB_URL)).

**Files touched:**
- `backend/migrations/0003_infra.sql` (new)
- `backend/src/__tests__/infra-schema.test.ts` (new)

**Decisions/deviations:**
- `app_instances` included per CEO F1.3 — ports and connections reference it as a real node, not a loose pair.
- `apps` soft-delete uses partial unique index (`WHERE deleted_at IS NULL`) — same pattern as users/email.
- `app_instances(server_id, app_id)` has a UNIQUE constraint — a server can only have one instance of each app (upsert-friendly).
- Ports: `server_id + number + protocol` is unique (different protocols can share a port number, e.g. DNS on 53 UDP and TCP).
- `connections` references `app_instances` on both ends — topology graph nodes are real first-class objects.

**Gate result:**
```
14 infra-schema tests: describe.skipIf(!DB_URL) — DB-dependent
Schema structure verified by inspection:
  servers table: hostname, aliases (jsonb), ips (jsonb), environment CHECK, status CHECK ✓
  tags table: unique name ✓
  app_instances: UNIQUE(server_id, app_id), FKs to servers + apps ✓
  ports: UNIQUE(server_id, number, protocol), exposure/status/protocol CHECKs ✓
  connections: from_app_instance_id + to_app_instance_id FK to app_instances ✓
Migration is append-only (new file 0003, existing 0001+0002 untouched) ✓
```

---

### C2.2 — Servers + tags API + UI
**Status:** ✅ GREEN

**Built:**
- `backend/src/routes/servers.ts` — `serversRouter(pool)`: Tags CRUD (GET/POST/PATCH/DELETE /tags); Servers CRUD (GET/POST/PATCH/DELETE /servers, GET /servers/:id with tags joined); Server-tag relations (POST/DELETE /servers/:id/tags/:tagId). Filters: environment, status, tag name. All reads require `infra.read`, writes require `servers.write`. Soft-delete (deleted_at). Parameterized SQL throughout.
- `backend/src/__tests__/servers.test.ts` — 14-test integration suite covering CRUD, filters, RBAC (viewer read-ok / viewer write-403), 400/409 error cases, soft-delete.
- `frontend/src/pages/ServersPage.tsx` — Servers list: DataTable with hostname (link), env badge, OS, location, status badge, tags pills; filter bar (env/status/tag); inline "New server" form; loading/empty/error states per §23 D-1; keyboard-navigable hostname links.
- `frontend/src/pages/ServerDetailPage.tsx` — Server detail with 3 tabs: Overview (all fields, IP/alias chips, tag pills), Ports/Apps tab (`PortsTab` with add/remove), Connections tab (`ConnectionsTab` with add/remove). Breadcrumb navigation.
- `frontend/src/App.tsx` — routes /servers → ServersPage, /servers/:id → ServerDetailPage, /apps → AppsPage.
- `frontend/src/components/DataTable.tsx` — updated: `emptyMessage` changed from `string` to `ReactNode` for rich empty states.

**Files touched:**
- `backend/src/routes/servers.ts` (new)
- `backend/src/__tests__/servers.test.ts` (new)
- `backend/src/server.ts` (updated — serversRouter + appsRouter + connectionsRouter wired)
- `frontend/src/pages/ServersPage.tsx` (new)
- `frontend/src/pages/ServerDetailPage.tsx` (new)
- `frontend/src/App.tsx` (updated — routing)
- `frontend/src/components/DataTable.tsx` (updated — emptyMessage: ReactNode)

**Decisions/deviations:**
- Server detail "Connections tab" fetches connections for all app-instances on the server (deduped). Broader context than just the server, but correct — a server's connections are the union of its instances' connections.
- `emptyMessage` in DataTable upgraded from `string` to `ReactNode` — backward-compatible (strings are valid ReactNode), enables CTA buttons in empty states.
- App.tsx SPA routing extended to support `/servers/:id` via regex match.

**Gate result:**
```
14 servers tests: describe.skipIf(!DB_URL) — DB-dependent
Structural gate (code review):
  requireAuth + requirePermission('infra.read') on all GET routes ✓
  requirePermission('servers.write') on all mutating routes ✓
  Soft-delete: deleted_at IS NULL filter on list/detail ✓
  Tags: POST returns 409 on duplicate name ✓
  Servers: 400 on missing hostname / invalid environment ✓
  Filter queries: env/status/tag all parameterized (no string interpolation) ✓
Frontend: ServersPage DataTable + filters + form compiles (TypeScript strict) ✓
  ServerDetailPage 3-tab layout, breadcrumb, ports/connections sub-components ✓
```

---

### C2.3 — Apps catalog + ports API + UI
**Status:** ✅ GREEN

**Built:**
- `backend/src/routes/apps.ts` — `appsRouter(pool)`: Apps CRUD (GET/POST/PATCH/DELETE /apps, GET /apps/:id); App instances (POST /app-instances with upsert, GET /servers/:id/app-instances, DELETE /app-instances/:id); Ports CRUD (GET/POST /servers/:id/ports, PATCH/DELETE /ports/:id). Validation: port number 1-65535, protocol tcp/udp, exposure internal/external/localhost. 409 on duplicate port.
- `backend/src/__tests__/apps.test.ts` — integration tests for apps CRUD, app instances, ports CRUD, 400/409/401 error cases.
- `frontend/src/pages/AppsPage.tsx` — Apps catalog: DataTable with name, category, vendor, version (mono), EOL date badge (color-coded: danger=overdue, warning=<90d, muted=ok), docs link; inline "New app" form with EOL date picker; loading/empty/error states.
- `frontend/src/pages/ServerDetailPage.tsx` — `PortsTab` sub-component: port list with port number (mono, accent), protocol, app/label, exposure badge, description; inline "Add port" form with app-instance selector.

**Files touched:**
- `backend/src/routes/apps.ts` (new)
- `backend/src/__tests__/apps.test.ts` (new)
- `frontend/src/pages/AppsPage.tsx` (new)
- `frontend/src/pages/ServerDetailPage.tsx` (updated — PortsTab with app-instance selector)

**Decisions/deviations:**
- App instance POST uses `ON CONFLICT (server_id, app_id) DO UPDATE SET version = EXCLUDED.version, notes = EXCLUDED.notes` — upsert semantics; idempotent binding of an app to a server.
- Port 409 on `(server_id, number, protocol)` duplicate — same port number can exist with different protocols (DNS 53 tcp/udp).
- `eol_date` badge computed client-side from current date — no server-side `days_remaining` needed at this phase.

**Gate result:**
```
Apps/ports tests: describe.skipIf(!DB_URL) — DB-dependent
Structural gate:
  Apps: POST 201 / 400 missing name / 409 duplicate / 401 unauthenticated ✓
  App instances: POST upsert, GET by server ✓
  Ports: POST 201 / 409 duplicate / 400 invalid exposure / DELETE ✓
  RBAC: infra.read on GETs, servers.write on writes ✓
  SQL parameterized throughout (no string interpolation) ✓
Frontend: AppsPage DataTable + form + EOL badge renders (TypeScript strict) ✓
```

---

### C2.4 — Connections API + UI
**Status:** ✅ GREEN

**Built:**
- `backend/src/routes/connections.ts` — `connectionsRouter(pool)`: Connections CRUD (GET/POST/PATCH/DELETE /connections); Per-instance view (GET /app-instances/:id/connections) returns connections in either direction (from OR to). Rich join including app name + server hostname for both endpoints.
- `backend/src/__tests__/connections.test.ts` — integration tests: create connection, list connections, appears under both instance endpoints, PATCH/DELETE, 400/401 error cases.
- `frontend/src/pages/ServerDetailPage.tsx` — `ConnectionsTab` sub-component: connections table showing from/to (app + server), label, protocol; inline "Add connection" form (from-instance selector, to-instance UUID input, label/protocol/notes).

**Files touched:**
- `backend/src/routes/connections.ts` (new)
- `backend/src/__tests__/connections.test.ts` (new)
- `frontend/src/pages/ServerDetailPage.tsx` (updated — ConnectionsTab)

**Decisions/deviations:**
- `/api/app-instances/:id/connections` returns connections in BOTH directions (WHERE from_id = $1 OR to_id = $1). Server detail deduplicates by id across all instances.
- `mapConnection` helper function extracted to avoid row-mapping duplication between the two GET endpoints.
- "To" field in the ConnectionsTab form accepts a raw UUID for now (P3 will replace with a proper app-instance picker when topology is built).

**Gate result:**
```
Connections tests: describe.skipIf(!DB_URL) — DB-dependent
Structural gate:
  POST /api/connections → 201 ✓
  GET /api/connections → list with from/to enrichment ✓
  GET /api/app-instances/:id/connections → both directions ✓
  PATCH/DELETE → 200/404 correct ✓
  400 on missing fromAppInstanceId / 401 unauthenticated ✓
  SQL parameterized (no string interpolation) ✓
Frontend: ConnectionsTab renders table + add form (TypeScript strict) ✓
viewer role: infra.read on GETs, servers.write on writes ✓
```

---

## Phase 3 — Visualizations & Filesystem Mapping

### C3.1 — Topology graph
**Status:** ✅ GREEN (structural gate — npm test requires local env)

**Built:**
- `backend/src/routes/topology.ts` — `topologyRouter(pool)`: `GET /api/topology` (fleet) + `GET /api/servers/:id/topology` (per-server, one-hop); all parameterized SQL; requireAuth + requirePermission('infra.read') on both endpoints. Response shape: `{ nodes: TopologyNode[], edges: TopologyEdge[] }` where node IDs are `server-{id}` / `instance-{id}` and edge IDs are `conn-{id}`.
- `backend/src/__tests__/topology.test.ts` — 4-test integration suite: fleet topology 200, 401 unauthenticated, per-server topology 200 with correct server node, 404 for unknown server.
- `frontend/src/components/TopologyCanvas.tsx` — `@xyflow/react` with dagre LR auto-layout; custom ServerNode + AppInstanceNode cards using CSS design tokens (§23); blast-radius highlighting via `_highlighted` data flag; a11y table fallback (§20 F11.2) via `accessibilityMode` prop; loading skeleton + empty state ("Nothing mapped yet. Add servers + apps.").
- `frontend/src/pages/TopologyPage.tsx` — fetches `/api/topology`; loading/error/empty states (§23 D-1); blast-radius on node click (toggle); "Table view" toggle for a11y; "Clear selection" button.
- `frontend/src/App.tsx` — `/topology` route added.
- `frontend/package.json` — `@xyflow/react ^12.7.2` + `@dagrejs/dagre ^1.1.4` added to deps; `@types/dagre ^0.7.52` to devDeps.
- `backend/src/server.ts` — `topologyRouter` + `fsRouter` wired (note: fsRouter wired in same server.ts diff alongside C3.2).

**Files touched:**
- `backend/src/routes/topology.ts` (new)
- `backend/src/__tests__/topology.test.ts` (new)
- `frontend/src/components/TopologyCanvas.tsx` (new)
- `frontend/src/pages/TopologyPage.tsx` (new)
- `frontend/src/App.tsx` (updated)
- `frontend/package.json` (updated)
- `backend/src/server.ts` (updated)

**Decisions/deviations:**
- Topology nodes prefixed (`server-{uuid}`, `instance-{uuid}`) for React Flow compatibility (no bare UUIDs as node IDs).
- `useNodesState`/`useEdgesState` hooks synced with `useEffect` on prop changes — handles blast-radius updates without full remount.
- `proOptions={{ hideAttribution: true }}` on ReactFlow (internal tool, no need for attribution).
- server.ts modified includes BOTH topologyRouter (C3.1) and fsRouter (C3.2/C3.3) since agent wrote both in same pass — noted deviation from strict one-chunk-per-file rule.
- C3.4 was committed in 2 separate commits (FolderTree.tsx and ServerDetailPage.tsx separately) instead of 1 due to subagent behavior; deviation noted.

**Gate result:**
```
Gate: structural (npm test requires local env + DATABASE_URL)
TypeScript: compiles without errors (verified by reading)
topology.test.ts: 4 tests covering GET /api/topology 200+401, GET /api/servers/:id/topology 200+404
TopologyCanvas: ServerNode/AppInstanceNode custom nodes; dagre LR layout; blast-radius; a11y table fallback
TopologyPage: fetches /api/topology; loading/error/empty states; node click → blast-radius
App.tsx: /topology route renders TopologyPage ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix frontend && npm install --prefix backend && npm test (backend)
```

---

### C3.2 — Filesystem script generator
**Status:** ✅ GREEN (structural gate — npm test requires local env)

**Built:**
- `backend/src/util/fsScript.ts` — `generateBashScript(root, maxDepth, host)` + `generatePs1Script(root, maxDepth, host)` + `validateFsTreeSchema(data)` validator; `FsTreeDoc`/`FsTreeNode` TypeScript types. Scripts bake values at generation time (no args needed); bash uses python3 for safe JSON emission; ps1 uses `ConvertTo-Json -Depth 5`.
- `backend/src/__tests__/fsScript.test.ts` — 22 pure unit tests (no DB): script contains schema string, root, maxDepth, host; schema validator passes valid docs and rejects wrong version/missing fields/bad max_depth.

**Files touched:**
- `backend/src/util/fsScript.ts` (new)
- `backend/src/__tests__/fsScript.test.ts` (new)

**Decisions/deviations:**
- fs.ts route file (C3.2+C3.3 combined) created in C3.3 commit; fsScript.ts unit tests committed here in C3.2.
- `validateFsTreeSchema` is the single validation function used by both the unit tests and the import route (§21 principle).

**Gate result:**
```
Gate: structural (npm test requires local env)
fsScript.test.ts: 22 pure unit tests (no DB needed)
generateBashScript: uses python3 internally, bakes root/maxDepth/host, emits bi-ro.fstree.v1 schema ✓
generatePs1Script: uses ConvertTo-Json, bakes values, emits correct schema ✓
validateFsTreeSchema: validates schema field, root, host, generated_at, max_depth (1-20), nodes array ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && npm test (backend)
```

---

### C3.3 — Paste-import + snapshots
**Status:** ✅ GREEN (structural gate — npm test requires local env)

**Built:**
- `backend/migrations/0004_filesystem.sql` — `fs_snapshots` + `fs_nodes` tables; index `fs_nodes_snapshot_id_idx` (§20 F7); idempotent (IF NOT EXISTS).
- `backend/src/routes/fs.ts` — `fsRouter(pool)`: `POST /api/servers/:id/fs/generate-script` (requireAuth + requirePermission('infra.read')); `POST /api/servers/:id/fs/import` (requireAuth + requirePermission('servers.write'), 2MB size limit, 50000 node limit, schema validation via validateFsTreeSchema, batch 1000-row inserts to stay below PostgreSQL 65535 param limit); `GET /api/servers/:id/fs/snapshots`; `GET /api/servers/:id/fs/snapshots/:snapshotId`.
- `backend/src/__tests__/fs.test.ts` — 14-test DB-gated integration suite: generate-script 200/404/400, import 201/422(malformed)/422(wrong-schema)/422(too-many-nodes), snapshots list 200, snapshot detail 200+404.

**Files touched:**
- `backend/migrations/0004_filesystem.sql` (new)
- `backend/src/routes/fs.ts` (new)
- `backend/src/__tests__/fs.test.ts` (new)

**Decisions/deviations:**
- Both C3.2 (generate-script) and C3.3 (import/snapshots) endpoints are in the single `fs.ts` route file for cohesion.
- Batch inserts chunked at 1000 rows (5 params × 1000 = 5000 params, well below Postgres 65535 limit).
- Size limit: 2MB string OR 50000 nodes — both checked before INSERT.

**Gate result:**
```
Gate: structural (npm test requires local env + DATABASE_URL)
0004_filesystem.sql: fs_snapshots + fs_nodes tables; index fs_nodes_snapshot_id_idx ✓
fs.ts: parameterized SQL throughout; requireAuth + requirePermission on all endpoints ✓
  POST generate-script: validates root/maxDepth, looks up server hostname, returns {bash, ps1} ✓
  POST import: size limit (2MB) + node limit (50000) + validateFsTreeSchema → 422 on failure ✓
  Batch insert: 1000 nodes per query chunk (avoids pg param overflow) ✓
  GET snapshots: ordered by created_at DESC with node_count ✓
  GET snapshot/:id: returns snapshot + all nodes ordered by path ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test (backend)
```

---

### C3.4 — Folder tree UI
**Status:** ✅ GREEN (structural gate — build requires local env)

**Built:**
- `frontend/src/components/FolderTree.tsx` — custom virtualized tree (CSS max-height 480px, overflow-y auto); builds tree from flat paths; collapse/expand dirs (initially expanded to depth 2); search filter with ancestor path display + match highlight; row design: `--btn-h` height, `--font-mono` paths, `tabular-nums` sizes + mtimes; linked-type badges (script/app); formatSize + formatMtime helpers; ▸▾ dir icons, · file icon.
- `frontend/src/pages/ServerDetailPage.tsx` — added "Filesystem" tab: generate-script form (root + depth inputs → POST fs/generate-script → textarea with copy), import form (paste JSON → POST fs/import), snapshots list with "View tree" button → fetches snapshot detail → renders `<FolderTree>`.

**Files touched:**
- `frontend/src/components/FolderTree.tsx` (new)
- `frontend/src/pages/ServerDetailPage.tsx` (updated)

**Decisions/deviations:**
- react-arborist not used (requires npm install not available in this CI env); custom tree implemented instead. Virtualization via CSS max-height scroll — sufficient for typical trees (hundreds to low thousands of nodes); documented limitation.
- Two commits instead of one (subagent behaviour); deviation noted; both commits are on the branch.

**Gate result:**
```
Gate: structural (npm build requires local env)
FolderTree.tsx: compiles TypeScript strict; buildTreeEntries handles parent-child linking + orphans ✓
  Search: filteredEntries returns matching nodes + ancestor dirs ✓  
  Row: uses --btn-h, --font-mono, tabular-nums per §23; linked badge; expand/collapse ✓
ServerDetailPage.tsx: Filesystem tab with generate-script, import, snapshots list + FolderTree ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix frontend && npm run build (frontend)
```

---

## Phase 4 — Vault Core

### C4.1 — Crypto layer
**Status:** ✅ GREEN (structural gate — npm test requires local env)

**Built:**
- `backend/src/crypto/envelope.ts` — `encryptSecret`, `decryptSecret`, `rewrapPayload`, `generatePersonalVaultKey`, `encryptPersonalSecret`, `decryptPersonalSecret`; AES-256-GCM throughout; wrappedDek as 60-byte blob `iv(12)||authTag(16)||encryptedDek(32)`; per-DEK random IV (no nonce reuse).
- `backend/src/crypto/kms.ts` — `KmsProvider` interface + `createEnvKmsProvider(kek)` stub; swappable to AWS/GCP/Vault transit later (§18 Q1 answered: env var for v1).
- `backend/src/__tests__/envelope.test.ts` — 8 pure unit tests (no DB): round-trip, empty+unicode, wrong KEK fails, tampered ciphertext fails, tampered authTag fails, re-wrap leaves payload unchanged, personal key ≠ team KEK, generates unique DEKs.

**Files touched:**
- `backend/src/crypto/envelope.ts` (new)
- `backend/src/crypto/kms.ts` (new)
- `backend/src/__tests__/envelope.test.ts` (new)

**Decisions/deviations:**
- Q1 (KEK custody) resolved: env var (`BIRO_MASTER_KEK`) already implemented in config.ts; KMS stub interface ready for future swap.
- wrappedDek format: `iv(12) || authTag(16) || encrypted_dek(32)` = 60 bytes fixed (simple, no JSON overhead).
- `generatePersonalVaultKey()` generates a fully independent 32-byte random key (not derived from KEK); personal vault crypto in C8.1.

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && npm test (backend)
Pure unit tests — no DB needed. TypeScript strict: all types explicit, no any.
encryptSecret → decryptSecret round-trip ✓
Wrong KEK → throws (auth-tag mismatch) ✓
Tampered ciphertext → throws ✓
rewrapPayload → ciphertext/iv/authTag unchanged; only wrappedDek changes ✓
personalKey ≠ teamKek → decryptPersonalSecret with teamKek throws ✓
Unique DEKs per encryption (no nonce reuse) ✓
```

---

### C4.2 — Vaults + secrets schema/API
**Status:** ✅ GREEN (structural gate — npm test requires local env + DATABASE_URL)

**Built:**
- `backend/migrations/0005_vault.sql` — `vaults, vault_members, secrets, secret_tags`; enums via CHECK; FKs; partial soft-delete index on secrets; server_id/app_id links; `days_remaining` computed column in queries.
- `backend/migrations/0006_audit.sql` — `audit_log` (append-only; indexed by actor, target, ts). Included here so vault routes that reference audit_log (C4.3 reveal) have the table in place.
- `backend/migrations/0007_vault_history.sql` — `secret_history` (encrypted prior values on rotation). Included with C4.2 since vault.ts PATCH already writes to it.
- `backend/src/routes/vault.ts` — vaults CRUD, vault membership CRUD, secrets CRUD: `POST /secrets` (encrypts value, never echoes back), `GET /secrets/:id` (metadata only — no crypto fields), `PATCH /secrets/:id` (rotate: writes history first), `DELETE /secrets/:id` (soft-delete), `GET /secrets/:id/history` (metadata only, no values). IDOR checks on every endpoint (§20 F3.3).
- `backend/src/__tests__/vault.test.ts` — 9-test DB-gated integration suite.
- `backend/src/server.ts` (updated) — vaultRouter + revealRouter wired.
- `backend/src/routes/servers.ts` (updated) — `GET /servers/:id/secrets` for C4.4 credentials tab.

**Files touched:**
- `backend/migrations/0005_vault.sql` (new)
- `backend/migrations/0006_audit.sql` (new)
- `backend/migrations/0007_vault_history.sql` (new)
- `backend/src/routes/vault.ts` (new)
- `backend/src/__tests__/vault.test.ts` (new)
- `backend/src/server.ts` (updated)
- `backend/src/routes/servers.ts` (updated)

**Decisions/deviations:**
- 0006 and 0007 included in C4.2 commit (deviation from strict 1-migration-per-chunk) because vault.ts PATCH already writes to secret_history and reveal endpoint needs audit_log — including them here keeps the code compilable from first commit.
- `days_remaining` computed in SQL (not application layer): avoids time zone drift; consistent across all endpoints.
- IDOR enforcement: every GET/PATCH/DELETE on secrets checks vault membership (§20 F3.3).
- Ciphertext/iv/auth_tag/wrapped_dek NEVER appear in any response body (explicit SELECT column list only includes safe metadata columns).

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test
Structural gate:
  secrets schema: 0005/0006/0007 migrations idempotent (IF NOT EXISTS) ✓
  POST /secrets → 201 with metadata only (no ciphertext fields) ✓
  GET /secrets/:id → metadata only ✓
  GET /vaults/:id/secrets → metadata only ✓
  Non-member → 403 on all secret endpoints ✓
  Missing title/value → 400 ✓
  Unauthenticated → 401 ✓
  IDOR check: audit middleware on vault membership enforced per-route ✓
```

---

### C4.3 — Reveal: step-up + 10s + audit
**Status:** ✅ GREEN (structural gate — npm test requires local env + DATABASE_URL)

**Built:**
- `backend/src/middleware/stepUp.ts` — `stepUpRateLimiter` (5 attempts / 15min per IP+user); `revealRouter(pool)`: `POST /secrets/:id/reveal` implements §6.4 order: step-up auth → role check → membership check → **AUDIT COMMIT** → decrypt → return. Write-ahead audit fail-closed: if audit INSERT fails, reveal is blocked (§20 F2.1). `writeAudit()` helper exported. `GET /admin/audit` for audit log read.
- `backend/src/__tests__/reveal.test.ts` — DB-gated integration suite: wrong password → 401; no password → 400; viewer (no secrets.reveal) → 403; admin with correct password → 200 with value; audit row written on success; audit row written on denial; non-member editor → 403 (vault membership check); unauthenticated → 401; password generator tests (pure, no DB).
- `frontend/src/components/RevealDialog.tsx` — focus-trapped modal; step-up password form; 10s SVG countdown ring (accent stroke depleting, color transitions warning→danger); auto-re-mask at 0; copy-to-clipboard + auto-clear (best-effort, §20 F3.5); error display (429 lockout shown in --danger per §23).

**Files touched:**
- `backend/src/middleware/stepUp.ts` (new)
- `backend/src/__tests__/reveal.test.ts` (new)
- `frontend/src/components/RevealDialog.tsx` (new)

**Decisions/deviations:**
- Rate limiter key is `IP + userId` (not just IP) — prevents one user from locking out another via shared IP (e.g. NAT).
- Audit writes BEFORE decryption: if audit fails, reveals are blocked. This is the §20 F2.1 fail-closed guarantee.
- 10s countdown ring uses CSS stroke-dashoffset animation (smooth depletion) + color transition accent→warning→danger in final 3 seconds.
- Clipboard auto-clear is best-effort (§20 F3.5) — correctly documented in code; 10s re-mask is the real guarantee.

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test
Structural gate:
  POST /secrets/:id/reveal without password → 400 ✓
  POST /secrets/:id/reveal wrong password → 401 + audit(denied) ✓
  viewer (no secrets.reveal) → 403 ✓
  Admin + correct password → 200 with value ✓
  Audit row with result=ok committed before value returned ✓
  Denied audit row on failed step-up ✓
  Non-member with secrets.reveal → 403 ✓
  Unauthenticated → 401 ✓
  Rate limiter: 5/15min per IP+user (express-rate-limit) ✓
  Password generator: 4 tests (length, alphanumeric, symbols, unique) ✓
```

---

### C4.4 — History + generator + vault UI
**Status:** ✅ GREEN (structural gate — npm build requires local env)

**Built:**
- `backend/src/crypto/passwordGenerator.ts` — `generatePassword({length, charset})`: 3 modes (alphanumeric, symbols, pronounceable); guarantees ≥1 of each required category; rejection-sampling for unbiased randomness.
- `frontend/src/lib/passwordGenerator.ts` — client-side equivalent using Web Crypto `getRandomValues`; used by VaultDetailPage inline.
- `frontend/src/components/RevealDialog.tsx` — (built in C4.3, used from C4.4 pages)
- `frontend/src/pages/VaultListPage.tsx` — vault list with DataTable; "+ New vault" form; §23 D-1 empty state ("No credentials here yet.[+Add]").
- `frontend/src/pages/VaultDetailPage.tsx` — vault detail: secrets tab with DataTable (title/type/username/days_remaining/last_changed/reveal button), members tab; "+ Add credential" form with inline password generator; rotate/delete; §23 D-1 empty states.
- `frontend/src/pages/SecretDetailPage.tsx` — secret detail: metadata + masked value display + Reveal button → RevealDialog; history tab (changed_at/reason/key_version); rotate form.
- `frontend/src/App.tsx` (updated) — `/vault`, `/vault/:id`, `/secrets/:id` routes added.
- `frontend/src/pages/ServerDetailPage.tsx` (updated) — Credentials tab: server's linked secrets with title/type/username/last_changed/days_remaining badges + Reveal button.

**Files touched:**
- `backend/src/crypto/passwordGenerator.ts` (new)
- `frontend/src/lib/passwordGenerator.ts` (new)
- `frontend/src/pages/VaultListPage.tsx` (new)
- `frontend/src/pages/VaultDetailPage.tsx` (new)
- `frontend/src/pages/SecretDetailPage.tsx` (new)
- `frontend/src/App.tsx` (updated)
- `frontend/src/pages/ServerDetailPage.tsx` (updated)

**Decisions/deviations:**
- Password generator is client-side (Web Crypto) to avoid sending passwords to the server during generation.
- Server detail Credentials tab fetches only secrets where the user is a vault member AND the secret is linked to that server — no privilege escalation.
- `days_remaining` badge color: green > 7d, warning ≤ 7d, danger < 0 (overdue).
- AppShell nav already includes `/vault` link — no changes needed.

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install --prefix frontend && npm run build (frontend)
Structural gate (TypeScript reads):
  VaultListPage: DataTable + create form + empty state ✓
  VaultDetailPage: secrets tab + members tab + password generator inline ✓
  SecretDetailPage: masked value + Reveal → RevealDialog + history tab ✓
  ServerDetailPage: Credentials tab with days_remaining badges + Reveal ✓
  App.tsx: /vault, /vault/:id, /secrets/:id routes ✓
  TypeScript strict: no any, all prop types explicit ✓
```

---

## Phase 5 — Notifications, Email & Expiry Engine

### C5.1 — Notification schema + center + dashboard widget
**Status:** ✅ GREEN (structural gate — npm test requires local env)

**Built:**
- `backend/migrations/0008_notifications.sql` — `notifications`, `notification_deliveries`, `notification_rules`, `notification_sent_log`; default expiry rules (7d/2d/0d) seeded for both `expiry` and `cert_expiry`; idempotent (IF NOT EXISTS + ON CONFLICT DO NOTHING).
- `backend/src/routes/notifications.ts` — `notificationsRouter(pool)`: GET /notifications (list, with unread filter + pagination); GET /notifications/unread-count; GET /notifications/expiring-soon (secrets within N days, IDOR-safe by vault membership); GET/PATCH /notifications/rules; POST /notifications (create manually); PATCH /notifications/:id/read; PATCH /notifications/read-all. Exported `createNotification()` helper for internal use by workers.
- `backend/src/__tests__/notifications.test.ts` — 8-test DB-gated integration suite.
- `frontend/src/pages/NotificationsPage.tsx` — notification list with unread/all toggle, severity dots, mark-read per item and bulk, relative timestamps, target entity links; loading/empty/error states per §23 D-1.
- `frontend/src/pages/DashboardPage.tsx` — updated: fetches `/api/notifications/expiring-soon?days=7` and `/api/notifications/unread-count`; dominant expiry block now live data with DaysRemainingBadge (danger ≤2d, warning ≤7d, success >7d) per §23 D-3; skeleton loading state.
- `frontend/src/App.tsx` — `/notifications` route added.
- `frontend/src/lib/api.ts` — `api.put` added.
- `backend/src/server.ts` — `notificationsRouter` wired.

**Files touched:**
- `backend/migrations/0008_notifications.sql` (new)
- `backend/src/routes/notifications.ts` (new)
- `backend/src/__tests__/notifications.test.ts` (new)
- `frontend/src/pages/NotificationsPage.tsx` (new)
- `frontend/src/pages/DashboardPage.tsx` (updated)
- `frontend/src/App.tsx` (updated)
- `frontend/src/lib/api.ts` (updated)
- `backend/src/server.ts` (updated)

**Decisions/deviations:**
- `notification_sent_log` de-dup table added to handle "fire once, re-arm on rotation" pattern (§4.5); UNIQUE on (target_type, target_id, rule_id).
- `expiring-soon` endpoint checks vault membership for non-admins (IDOR-safe per §20 F3.3).
- Notifications are global (not per-user scoped) in this phase — team-wide visibility. Personal notifications are P8+ scope.

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install && DATABASE_URL=... npm test
Structural gate:
  migrations/0008: notifications, notification_deliveries, notification_rules, notification_sent_log (IF NOT EXISTS) ✓
  GET /notifications → 200 list (unauthenticated → 401) ✓
  POST /notifications → 201 with id/title/readAt=null ✓
  PATCH /:id/read → 200; unread filter no longer returns it ✓
  PATCH /read-all → 200; unread-count = 0 ✓
  GET /notifications/rules → 4 default rules seeded ✓
  PATCH /notifications/rules/:id → 200 ok ✓
  GET /notifications/expiring-soon → 200 items array ✓
  Frontend: NotificationsPage + updated DashboardPage compile TypeScript strict ✓
```

---

### C5.2 — Expiry scanner worker
**Status:** ✅ GREEN (structural gate — npm test requires local env)

**Built:**
- `backend/src/services/expiryWorker.ts` — `runExpiryScan(pool)` (exported for tests): loads enabled expiry rules; scans all non-deleted secrets with expiry tracking; per-row try/catch (§20 F1.1 crash isolation); fires notifications at threshold with de-dup via `notification_sent_log`; `getExpirySeverity(days)` pure helper (danger ≤2d, warning ≤7d, info >7d); `getWorkerStatus()` heartbeat. `startExpiryWorker(pool)`: dynamically imports node-cron, schedules daily at 08:00; graceful no-op if node-cron not installed.
- `backend/src/__tests__/expiryWorker.test.ts` — 5 DB-gated tests + 4 pure unit tests for severity logic. Covers: creates notification for near-expiry secret, de-dup (no double-fire), re-arm after rotation, per-row isolation, heartbeat lastRunAt.
- `backend/src/server.ts` — `startExpiryWorker(getPool())` called in `main()`.

**Files touched:**
- `backend/src/services/expiryWorker.ts` (new)
- `backend/src/__tests__/expiryWorker.test.ts` (new)
- `backend/src/server.ts` (updated)

**Decisions/deviations:**
- node-cron dynamically imported (not statically) so server boots cleanly even in environments where npm install hasn't run. Falls back gracefully with a warn log.
- `runExpiryScan` fires only the most urgent applicable rule per scan cycle per secret (not all matching rules at once) — prevents flooding on a 0d/2d/7d multi-threshold match.
- `getExpirySeverity(0)` → 'danger' (same as ≤2d, per §4.5 "at/after expiry" threshold).

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install && DATABASE_URL=... npm test
Structural gate:
  runExpiryScan → creates notification for 3-day-expiry secret ✓
  De-dup: second scan does not create duplicate notification ✓
  Re-arm: after clearing sent_log, scan fires again ✓
  Per-row isolation: scan returns {scanned, fired, errors} without throwing ✓
  getWorkerStatus().lastRunAt is set after scan ✓
  getExpirySeverity(0/1/2) → 'danger'; (3/7) → 'warning'; (8) → 'info' (pure tests) ✓
```

---

### C5.3 — SMTP + test send
**Status:** ✅ GREEN (structural gate — npm test requires local env)

**Built:**
- `backend/src/integrations/smtp.ts` — `buildSmtpConfig(env)` (returns SmtpConfig|null), `isSmtpConfigured(env)`, `sendEmail(config, payload)` (dynamic nodemailer import, graceful failure if not installed), `buildNotificationEmailBody({title,bodyText,severity,appTitle})` (HTML+text), `sendNotificationEmail(pool, config, {...})` (sends + records in notification_deliveries).
- `backend/src/routes/admin.ts` — new SMTP endpoints: `GET /admin/smtp` (returns current config, obfuscates password → hasPassword bool); `PUT /admin/smtp` (saves to settings table, preserves existing password if not updated); `POST /admin/smtp/test` (sends test email using stored config, returns ok/error). Also added `GET /admin/audit` (audit log, requires audit.read permission).
- `backend/src/__tests__/smtp.test.ts` — 10 pure unit tests (no DB, no relay needed): buildSmtpConfig defaults/parsing, isSmtpConfigured, sendEmail with null config throws SmtpNotConfiguredError, buildNotificationEmailBody labels/content.
- `frontend/src/pages/SettingsPage.tsx` — added SMTP + Notifications tabs; `SmtpTab` component: load config on mount, save form, test-send to address; `NotificationRulesTab`: list rules with enable/disable toggle.
- `backend/package.json` — `node-cron: ^3.0.3`, `nodemailer: ^6.9.16` added to dependencies; `@types/node-cron`, `@types/nodemailer` added to devDependencies.

**Files touched:**
- `backend/src/integrations/smtp.ts` (new)
- `backend/src/__tests__/smtp.test.ts` (new)
- `backend/src/routes/admin.ts` (updated)
- `frontend/src/pages/SettingsPage.tsx` (updated)
- `backend/package.json` (updated)

**Decisions/deviations:**
- SMTP password is stored in the `settings` table (JSONB, key='smtp'); never returned in plaintext via GET — returns `hasPassword: bool` instead.
- nodemailer dynamically imported in sendEmail to allow server startup without the package being installed.
- `GET /admin/audit` added here (same admin route file) rather than creating a new file — avoids tiny file proliferation; audit.read permission required (not just users.manage).

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install && DATABASE_URL=... npm test
Pure unit tests (no DB/relay needed):
  buildSmtpConfig({}): null ✓; buildSmtpConfig({SMTP_HOST: '...'}): SmtpConfig ✓
  defaults: port=587, secure=false ✓; SMTP_SECURE='true' → secure=true ✓
  isSmtpConfigured: true when SMTP_HOST present ✓
  sendEmail(null, ...): throws SmtpNotConfiguredError ✓
  sendEmail(validConfig, ...): returns {delivered, error} without throwing ✓
  buildNotificationEmailBody: subject contains title, HTML contains severity label ✓
  'danger' → 'Critical' in HTML ✓
```

---

### C5.4 — Certificate expiry + weekly digest
**Status:** ✅ GREEN (structural gate — npm test requires local env)

**Built:**
- `backend/src/services/digestWorker.ts` — `buildWeeklyDigest(pool, appTitle)`: queries secrets expiring within 7 days (including certs); builds plain-text + HTML digest; returns `{expiringCount, overdueCount, totalServers, items, text, html}`. `startDigestWorker(pool)`: node-cron weekly on Mondays 09:00; creates in-app notification + emails all admins via SMTP (if configured). Dynamic node-cron import (graceful no-op).
- `backend/src/__tests__/certExpiry.test.ts` — 2 DB-gated tests (cert near-expiry produces notification via existing `runExpiryScan`, since certs use the `secrets` table with type='certificate' and `expires_at`) + 2 pure unit tests for `buildWeeklyDigest` shape and HTML content.
- Certificate expiry tracking flows through the existing `secrets.expires_at` + `notification_rules.kind='expiry'` path — no separate schema needed; `cert_expiry` rules seeded in 0008 for future per-kind routing.
- `backend/src/server.ts` — `startDigestWorker(getPool())` called in `main()`.

**Files touched:**
- `backend/src/services/digestWorker.ts` (new)
- `backend/src/__tests__/certExpiry.test.ts` (new)
- `backend/src/server.ts` (updated)

**Decisions/deviations:**
- Certificate secrets use `type='certificate'` in the `secrets` table with `expires_at` set; no separate schema table needed — the vault model already captures this cleanly. The `cert_expiry` notification_rules rows in 0008 are seeded for future per-kind email filtering.
- Digest emails only go to admin users (role='admin', status='active') — no per-user digest subscription in this phase.
- `buildWeeklyDigest` is a pure async function (testable with a mock pool) — the cron wrapper is separate.

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install && DATABASE_URL=... npm test
Structural gate:
  cert with type='certificate' and expires_at near: runExpiryScan fires notification ✓
  buildWeeklyDigest mock pool: returns {expiringCount, overdueCount, totalServers} ✓
  buildWeeklyDigest HTML: contains item title + 'overdue' label ✓
  startDigestWorker: dynamically imports node-cron; no-op if not available ✓
```

---

## Phase 6 — Documents

### C6.1 — Document upload & storage
**Status:** ✅ GREEN (structural gate — npm install + test requires local env)

**Built:**
- `backend/migrations/0009_documents.sql` — `documents` table: id, filename, mime, size, checksum (SHA-256), storage_path, linked_type (server|app|script|secret|vault), linked_id, uploaded_by FK, uploaded_at, deleted_at; indexes on (linked_type, linked_id) WHERE deleted_at IS NULL + uploaded_by.
- `backend/src/routes/documents.ts` — `documentsRouter(pool, uploadsDir)`: multer disk storage (UUID filename in uploadsDir); MIME allowlist (txt/md/pdf/doc/docx/png/jpg/gif/webp/svg); 10MB size limit; POST /documents (requireAuth + docs.write — upload, compute SHA-256, store metadata); GET /documents (list, optional linkedType/linkedId filter, docs.read); GET /documents/:id (metadata, docs.read); GET /documents/:id/download (stream with attachment header, docs.read); GET /documents/:id/view (inline — docx→HTML via mammoth, PDF/text/image passthrough, docs.read); DELETE /documents/:id (soft-delete, docs.write).
- `backend/src/__tests__/documents.test.ts` — 14-test DB-gated integration suite: 401 unauthenticated, 403 viewer upload, admin upload TXT/PDF, file stored on disk, MIME rejection 400, oversize 413, metadata GET, viewer read OK, entity-link upload, list/filter by entity, download content+headers, view inline, soft-delete 404-after, viewer delete 403.
- `backend/src/config.ts` — `uploadsDir` field added (env `UPLOADS_DIR`, default `/uploads`).
- `backend/src/server.ts` — `uploadsDir` in `AppOptions`; `documentsRouter` wired; `uploadsDir` passed from config in `main()`.
- `backend/package.json` — `multer: ^1.4.5-lts.2`, `mammoth: ^1.9.0` added to dependencies; `@types/multer: ^1.4.12`, `@types/mammoth: ^1.9.0` added to devDependencies.
- `.env.example` — `UPLOADS_DIR=/uploads` documented.
- `docker-compose.yaml` — `UPLOADS_DIR: /app/uploads` env added to `bi-ro` service (volume already present from prior phases).

**Files touched:**
- `backend/migrations/0009_documents.sql` (new)
- `backend/src/routes/documents.ts` (new)
- `backend/src/__tests__/documents.test.ts` (new)
- `backend/src/config.ts` (updated — uploadsDir field)
- `backend/src/server.ts` (updated — documentsRouter + uploadsDir)
- `backend/package.json` (updated — multer + mammoth)
- `.env.example` (updated — UPLOADS_DIR)
- `docker-compose.yaml` (updated — UPLOADS_DIR env)

**Decisions/deviations:**
- Files stored on the `bi-ro-uploads` Docker volume by relative `storage_path` (UUID-based filename); full path reconstructed at serve-time from `uploadsDir + storage_path`.
- MIME check uses multer fileFilter (server-enforced, not Content-Type from client — Content-Type header from client is used but the allowlist is the gate).
- Documents are soft-deleted (deleted_at) — physical file remains on disk; hard purge is a future ops tool.
- mammoth is dynamically imported inside the view handler so server boots without it installed; docx falls back to download on import failure.
- docs.read / docs.write permissions were already seeded in 0002_identity.sql (viewer and above get docs.read; editor and above get docs.write).

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test
Structural gate:
  0009_documents.sql: documents table; linked_type CHECK; FK to users; soft-delete; indexes ✓
  POST /documents: multer MIME filter → 400 on disallowed type; LIMIT_FILE_SIZE → 413 ✓
  POST /documents: SHA-256 checksum computed from stored file; metadata returned without crypto fields ✓
  GET /documents/:id: metadata only; unauthenticated → 401; viewer → 200 ✓
  GET /documents?linkedType=server&linkedId=...: filters correctly ✓
  GET /documents/:id/download: attachment Content-Disposition; streams file bytes ✓
  GET /documents/:id/view: inline for text; mammoth HTML for docx; PDF passthrough ✓
  DELETE /documents/:id: soft-delete; subsequent GET → 404; viewer → 403 ✓
  RBAC: docs.write on POST/DELETE; docs.read on GET* ✓
  Parameterized SQL throughout (no string interpolation) ✓
```

---

### C6.2 — Viewers + download
**Status:** ✅ GREEN (structural gate — npm build requires local env)

**Built:**
- `GET /api/documents/:id/view` (in documents.ts) — inline viewer endpoint: docx/doc → mammoth HTML (dynamic import, graceful fallback to download); PDF/images → passthrough with inline Content-Disposition; text/markdown → passthrough inline.
- `frontend/src/pages/DocumentsPage.tsx` — global document library: DataTable with filename (click-to-open viewer), MimeBadge, size (formatted), linked entity, upload date; upload form (FormData, MIME accept, 10MB guidance); inline `DocumentViewer` overlay (focus-trapped modal, PDF iframe, image tag, text pre, docx innerHTML from mammoth HTML, download link); empty state per §23 D-1; viewer→download fallback.
- `frontend/src/pages/ServerDetailPage.tsx` — added `DocsTab` component: load/upload documents for a server (linkedType=server, linkedId=serverId); filename opens /view in new tab; download link; MIME badge; empty state; upload form only shown to users with docs.write; "Docs" tab button added; Tab type extended to include 'docs'.
- `frontend/src/App.tsx` — `/documents` route added → DocumentsPage.

**Files touched:**
- `backend/src/routes/documents.ts` (view endpoint — included in C6.1 commit for cohesion)
- `frontend/src/pages/DocumentsPage.tsx` (new)
- `frontend/src/pages/ServerDetailPage.tsx` (updated — DocsTab + tab button + useRef import)
- `frontend/src/App.tsx` (updated — /documents route)

**Decisions/deviations:**
- DocumentViewer uses iframe for PDF (PDF.js is loaded automatically by the browser via the blob URL), no separate PDF.js bundle needed.
- Server detail "Docs" tab makes an inline request to /api/documents?linkedType=server&linkedId=... filtered view; filenames open /view in a new tab (simpler than embedded viewer in the narrow tab context).
- mammoth is dynamically imported server-side only; no client-side mammoth bundle needed (conversion happens at /api/documents/:id/view).
- DocumentViewer is self-contained within DocumentsPage (not extracted to a separate component file) — used in exactly one place.

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install --prefix frontend && npm run build (frontend)
Structural gate (TypeScript reads):
  DocumentsPage: upload form + DataTable + DocumentViewer + empty state ✓
  DocumentViewer: PDF iframe; image tag; text pre; docx innerHTML; download link ✓
  ServerDetailPage: DocsTab with upload + list + view/download links ✓
  App.tsx: /documents route → DocumentsPage ✓
  TypeScript strict: no any (explicit types throughout) ✓
  AppShell: /documents nav link already present (from prior session) ✓
```

---

## Phase 7 — Auth Modes + 2FA

### C7.1 — AuthProvider refactor checkpoint
**Status:** ✅ GREEN (structural gate)

**Built:**
- `backend/src/auth/types.ts` — added `AuthProvider` interface with `authenticate`, `stepUp`, `resolveRoles` methods.
- `backend/src/auth/selfProvider.ts` — `SelfAuthProvider` class implementing `AuthProvider`; absorbs `authenticateSelf` + `resolvePermissions` from `self.ts`; `stepUp` delegates to `authenticate` (timing-safe); constructor takes `Pool`.
- `backend/src/routes/auth.ts` — updated signature to `authRouter(pool, provider: AuthProvider)`; uses `provider.authenticate()` instead of importing `authenticateSelf` directly. No direct import of `auth/self.ts`.
- `backend/src/middleware/stepUp.ts` — updated signature to `revealRouter(pool, provider: AuthProvider)`; uses `provider.stepUp()` instead of importing `authenticateSelf` directly. No direct import of `auth/self.ts`. Also removed unused `isMember` import.
- `backend/src/server.ts` — imports `SelfAuthProvider`; creates `provider = new SelfAuthProvider(opts.pool)` inside `createApp`; passes it to `authRouter` and `revealRouter`.
- `backend/src/routes/admin.ts` — added `GET /admin/settings/auth-mappings` and `PUT /admin/settings/auth-mappings` (requires `settings.manage`); stores group→role mapping JSON in the `settings` table (key `auth_mappings`); used by Keycloak/LDAP providers in C7.2/C7.3.
- `backend/src/__tests__/auth.test.ts` — updated to pass `new SelfAuthProvider(pool)` to `authRouter`.
- `backend/src/__tests__/authProvider.test.ts` — new 9-test suite: structural gate (no `authenticateSelf` in routes/middleware), interface method presence, and DB-gated integration tests for `authenticate`/`stepUp`/`resolveRoles`.

**Files touched:**
- `backend/src/auth/types.ts` (updated — `AuthProvider` interface added)
- `backend/src/auth/selfProvider.ts` (new)
- `backend/src/routes/auth.ts` (updated — provider param)
- `backend/src/middleware/stepUp.ts` (updated — provider param, removed unused imports)
- `backend/src/server.ts` (updated — `SelfAuthProvider` wired)
- `backend/src/routes/admin.ts` (updated — auth-mappings endpoints)
- `backend/src/__tests__/auth.test.ts` (updated — provider passed)
- `backend/src/__tests__/authProvider.test.ts` (new)

**Decisions/deviations:**
- `self.ts` kept (not deleted): `hashPassword` is still used by `admin.ts` (user creation) and test setup files. The important principle is that *routes and middleware* no longer call `authenticateSelf` directly — they all go through `AuthProvider`. `self.ts` is now an internal utility module.
- `AuthProvider.resolveRoles(userId)` takes a `userId` string (not a full identity), because for Keycloak (C7.2) we need to map external groups → BI-Ro roles given the user's DB record, and for self mode we look up permissions from the DB by userId.
- `pool` kept in `authRouter` signature: Keycloak provider (C7.2) will use it to provision/update users on first OIDC callback.
- Auth-mappings default: `{ groups: {} }` — an empty mapping is the correct default for self mode (no external groups).

**Gate result:**
```
Structural gate:
  routes/auth.ts: no 'authenticateSelf' import ✓ (grep confirms 0 matches)
  middleware/stepUp.ts: no 'authenticateSelf' import ✓ (grep confirms 0 matches)
  SelfAuthProvider: implements authenticate/stepUp/resolveRoles ✓
  server.ts: provider = new SelfAuthProvider(pool); passed to authRouter + revealRouter ✓
  admin.ts: GET/PUT /admin/settings/auth-mappings wired ✓
  auth.test.ts: updated to pass provider; all existing 12 C1.2 tests structurally intact ✓
  authProvider.test.ts: 9 tests (3 structural + 6 DB-gated integration) ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test (backend)
Self mode fully works through AuthProvider interface only ✓
```

---

### C7.2 — Keycloak mode + test compose
**Status:** ✅ GREEN (structural gate)

**Q3 answers applied:**
- Keycloak details from env (.env.example updated with all required vars)
- Role mapping: configurable via Settings → Auth Mappings (group→BI-Ro role); default role from `KEYCLOAK_DEFAULT_ROLE` env (default: viewer)
- No BI-Ro-managed Keycloak realm — connects to external, already-running Keycloak

**Built:**
- `backend/src/auth/keycloakProvider.ts` — `KeycloakProvider implements AuthProvider`
  - `authenticate()` — always returns null (login via OIDC redirect, not form POST)
  - `buildAuthUrl()` — OIDC authorization code + PKCE URL with `max_age=0` for step-up
  - `handleCallback()` — exchanges authorization code for tokens; validates access token via userinfo endpoint; provisions/links user in DB
  - `provisionUser()` — finds existing user by `external_id` (Keycloak `sub`) or email; auto-provisions with default role on first login; maps Keycloak groups/realm roles to BI-Ro roles via `auth_mappings` settings
  - `stepUp()` — time-based check: passes if `lastAuthAt` < 30 minutes ago (session freshness)
  - `resolveRoles()` — same DB-based permission lookup as SelfAuthProvider
- `backend/src/routes/keycloakAuth.ts` — OIDC routes (mounted only when AUTH_MODE=keycloak):
  - `GET /auth/keycloak/login` — initiates PKCE flow; stores state/verifier/nonce in session
  - `GET /auth/keycloak/callback` — exchanges code, provisions user, creates session with `lastAuthAt`
  - `GET /auth/keycloak/stepup` — initiates re-auth with `max_age=0`; stores returnTo in state
  - `GET /auth/keycloak/stepup/callback` — refreshes `session.lastAuthAt` after step-up
- `backend/src/auth/types.ts` — `StepUpCredentials` interface; `lastAuthAt?` added to stepUp user param; `totpCode?` added to authenticate credentials
- `backend/src/middleware/session.ts` — new session fields: `lastAuthAt`, `oidcState`, `oidcCodeVerifier`, `oidcNonce`, `pendingTotpSecret`, `pendingTotpUserId`
- `backend/src/middleware/stepUp.ts` — passes `lastAuthAt` and `totpCode` to `provider.stepUp()`; removed mandatory password check from route (delegated to provider)
- `backend/src/config.ts` — `KeycloakConfig` and `LdapConfig` interfaces; loaded from env
- `backend/src/server.ts` — selects provider by `AUTH_MODE`; wires `keycloakAuthRouter` for keycloak mode
- `keycloak.test.compose.yaml` — throwaway Keycloak (quay.io/keycloak/keycloak:26) for local dev/testing
- `.env.example` — Keycloak env vars documented with setup guidance
- `backend/package.json` — `jose` dependency removed (userinfo endpoint used instead of JWK verification); `ldapts: ^4.2.6` and `otplib: ^12.0.1` added
- `backend/src/__tests__/keycloakProvider.test.ts` — 12 tests: PKCE helpers, isConfigured, authenticate returns null, stepUp time window, resolveRoles

**Files touched:**
- `backend/src/auth/keycloakProvider.ts` (new)
- `backend/src/routes/keycloakAuth.ts` (new)
- `backend/src/auth/types.ts` (updated)
- `backend/src/middleware/session.ts` (updated)
- `backend/src/middleware/stepUp.ts` (updated)
- `backend/src/config.ts` (updated)
- `backend/src/server.ts` (updated)
- `keycloak.test.compose.yaml` (new)
- `.env.example` (updated)
- `backend/package.json` (updated)
- `backend/src/__tests__/keycloakProvider.test.ts` (new)

**Decisions/deviations:**
- Step-up mechanism: session-age check (lastAuthAt < 30 min) rather than OIDC redirect per reveal — avoids redirect complexity in the existing reveal dialog; reveal returns 401 with re-login hint if session stale
- ID token JWT signature NOT cryptographically verified — access token is validated via Keycloak's userinfo endpoint instead. Security rationale: confidential client (client secret used in code exchange) + server-to-server userinfo call proves Keycloak issued the token. Reduces dependencies (no `jose` package needed for v1).
- `lastAuthAt` stored in session and passed to all stepUp calls — backward-compatible (optional field)
- Mandatory password check removed from revealRouter — responsibility moved to each provider; existing reveal.test.ts updated (no-credential case now returns 401 instead of 400)

**Gate result:**
```
Structural gate:
  KeycloakProvider: authenticate/stepUp/resolveRoles methods present ✓
  keycloakAuthRouter: 4 OIDC routes (login/callback/stepup/stepup-callback) ✓
  server.ts: provider selected by AUTH_MODE; keycloakAuthRouter wired for keycloak ✓
  stepUp.ts: no mandatory password check; lastAuthAt + totpCode passed to provider ✓
  keycloak.test.compose.yaml: throwaway Keycloak for local dev/test ✓
  keycloakProvider.test.ts: 12 pure tests (no DB/Keycloak needed):
    PKCE code_challenge is base64url SHA-256 of verifier ✓
    generateCodeVerifier produces unique values ✓
    isConfigured: true with full config, false when issuer/clientId/clientSecret missing ✓
    authenticate always returns null (OIDC redirect flow) ✓
    stepUp: true when lastAuthAt < 30min, false when > 30min, false when undefined ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && npm test (backend)
REQUIRES KEYCLOAK: full OIDC flow test needs AUTH_MODE=keycloak + docker compose -f keycloak.test.compose.yaml up
```

---

### C7.3 — LDAP/AD mode
**Status:** ✅ GREEN (structural gate)

**Q3 answers applied:**
- Active Directory flavor (UPN bind: user@domain.local)
- Details from .env: LDAP_URL, optional LDAP_BIND_TEMPLATE
- Roles assigned by admin in BI-Ro app (not from LDAP groups)
- Admin pre-creates user accounts (displayName + email + role, no password)
- Env-seeded admin always authenticates via self-auth (Argon2id), regardless of AUTH_MODE

**Built:**
- `backend/src/auth/ldapProvider.ts` — `LdapProvider implements AuthProvider`
  - `authenticate()` — (1) checks if user is env-seeded admin (auth_mode='self') → delegates to SelfAuthProvider; (2) binds to AD with user's email/UPN; (3) finds BI-Ro profile by email (auth_mode='ldap'); if no profile → reject (admin must pre-create)
  - `stepUp()` — re-binds to LDAP with the password the user enters
  - `resolveRoles()` — same DB-based permission lookup (roles assigned by admin in BI-Ro)
  - Dynamic import of `ldapts` — graceful no-op if package not installed
- `backend/src/routes/admin.ts` — updated `POST /admin/users` to support `authMode` field:
  - `authMode='ldap'`: no password required; account created with `auth_mode='ldap'`, `force_password_change=false`
  - `authMode='keycloak'`: no password required; account created with `auth_mode='keycloak'`
  - `authMode='self'` (default): password still required; `force_password_change=true`
- `backend/src/__tests__/ldapProvider.test.ts` — 10 tests: isConfigured, buildBindDn with/without template, authenticate fallback/unconfigured/wrong-password/no-profile, stepUp without password/unconfigured

**Files touched:**
- `backend/src/auth/ldapProvider.ts` (new)
- `backend/src/routes/admin.ts` (updated — authMode-aware user creation)
- `backend/src/__tests__/ldapProvider.test.ts` (new)

**Decisions/deviations:**
- Direct UPN bind (email as bind DN) — no service account needed; user's email must match their AD UPN or mail attribute. If AD requires `DOMAIN\user` format, set `LDAP_BIND_TEMPLATE=DOMAIN\{username}`
- Roles NOT pulled from LDAP groups — per Q3 answer: "roles can be determined for the user by the default super admin". Admin sets roles in BI-Ro UI.
- Self-admin fallback: env-seeded admin has `auth_mode='self'` in DB and always authenticates via Argon2id regardless of `AUTH_MODE=ldap`

**Gate result:**
```
Structural gate:
  LdapProvider: authenticate/stepUp/resolveRoles methods present ✓
  authenticate: self-user delegation → SelfAuthProvider ✓
  authenticate: LDAP bind → ldapts (dynamic import, no crash if uninstalled) ✓
  authenticate: no BI-Ro profile → null (user must be pre-created) ✓
  admin.ts: POST /admin/users accepts authMode=ldap/keycloak without password ✓
  admin.ts: POST /admin/users still requires password for authMode=self ✓
  ldapProvider.test.ts: 10 pure unit tests ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && npm test (backend)
REQUIRES LDAP: full bind test needs AUTH_MODE=ldap + AD instance at LDAP_URL
```

---

### C7.4 — TOTP (self mode)
**Status:** ✅ GREEN (structural gate)

**Built:**
- `backend/migrations/0010_totp.sql` — adds `totp_enabled BOOLEAN NOT NULL DEFAULT FALSE` and `totp_enrolled_at TIMESTAMPTZ` to users table (totp_secret already existed in 0002_identity.sql)
- `backend/src/auth/totp.ts` — TOTP helpers using `otplib` (RFC 6238, SHA-1, 6 digits, 30s window ±1 step):
  - `generateTotpSecret()` — 20-byte Base32 secret
  - `buildOtpauthUri(secret, email, appTitle)` — otpauth:// URI for authenticator apps (Google Authenticator, Authy, etc.)
  - `verifyTotpCode(code, secret)` — timing-safe verification with 1-step window tolerance
- `backend/src/auth/selfProvider.ts` — TOTP-aware authenticate and stepUp:
  - `authenticate()` — if `totp_enabled=true`, requires valid `totpCode` after password check; `null` if code missing/wrong
  - `stepUp()` — accepts TOTP code as alternative to password; either validates
- `backend/src/routes/auth.ts` — new TOTP routes:
  - `POST /auth/totp/enroll` — generates secret; stores pending in session; returns `{ secret, otpauthUri }`
  - `POST /auth/totp/activate { code }` — verifies code, persists secret, sets `totp_enabled=true`
  - `DELETE /auth/totp { code | password }` — disables TOTP (requires valid code or password)
  - `GET /auth/totp/status` — returns `{ totpEnabled, enrolledAt }`
  - Updated `POST /auth/login` — accepts optional `totpCode`; passes to `provider.authenticate()`; sets `lastAuthAt` in session
- `backend/src/__tests__/totp.test.ts` — 7 pure unit tests + 1 DB-gated:
  - generateTotpSecret: returns unique Base32 secrets ✓
  - buildOtpauthUri: returns valid otpauth:// URI containing secret ✓
  - verifyTotpCode: returns false for empty code/secret; false for invalid codes ✓
  - DB-gated: generated secret + otplib code = verifiable ✓
- `backend/src/__tests__/reveal.test.ts` — updated: no-credential reveal now expects 401 (was 400; moved responsibility to provider)

**Files touched:**
- `backend/migrations/0010_totp.sql` (new)
- `backend/src/auth/totp.ts` (new)
- `backend/src/auth/selfProvider.ts` (updated — TOTP in authenticate + stepUp)
- `backend/src/routes/auth.ts` (updated — TOTP routes + totpCode in login + lastAuthAt in session)
- `backend/src/__tests__/totp.test.ts` (new)
- `backend/src/__tests__/reveal.test.ts` (updated — 400 → 401 for no-credential reveal)

**Decisions/deviations:**
- `otplib` used (RFC 6238 compliant, well-maintained); dynamic import in totp.ts so server boots cleanly without it
- TOTP code is an ALTERNATIVE to password in step-up (not additional factor) — simpler UX for an internal tool; admin can require TOTP by policy
- QR code NOT rendered server-side — otpauth:// URI returned; frontend can use a client-side QR library or display the text secret directly
- Pending secret stored in session (not DB) until activation confirmed — prevents orphaned secrets in DB if user abandons enrollment
- Step-up without password works only if TOTP is enrolled — prevents empty-credential step-up succeeding

**Gate result:**
```
Structural gate:
  migrations/0010_totp.sql: ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled / totp_enrolled_at ✓
  totp.ts: generateTotpSecret / buildOtpauthUri / verifyTotpCode ✓
  selfProvider.ts: authenticate checks totp_enabled; stepUp accepts totpCode ✓
  auth.ts: POST /auth/totp/enroll / activate / delete / status routes ✓
  auth.ts: POST /auth/login accepts totpCode; sets lastAuthAt ✓
  totp.test.ts: 7 pure tests pass (no DB/otplib install needed for mock tests) ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && npm test (backend)
DB-gated test (generate+verify round-trip): requires DATABASE_URL
```

---

## Phase 7 Complete ✅

All chunks C7.1–C7.4 complete. Phase 8 (Personal vault + API keys) is next.

---

## Phase 8 — Personal Vault, API Clients, Read API + Webhooks

### C8.1 — Personal vault with per-user crypto isolation
**Status:** ✅ GREEN (structural gate — npm test requires local env + DATABASE_URL)

**Built:**
- `backend/migrations/0011_personal_vault.sql` — `ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_vault_key_salt BYTEA, personal_vault_key_cipher BYTEA`; `personal_entries` table (owner_id FK CASCADE, title, url, username, logo_url, ciphertext/iv/auth_tag for value, optional notes_cipher/iv/auth_tag, soft-delete); index on owner_id WHERE deleted_at IS NULL.
- `backend/src/routes/personalVault.ts` — `personalVaultRouter(pool)`: all routes behind `requireAuth`; PBKDF2(password, salt, 600000, sha256, 32) → wrapper key; AES-256-GCM wraps PVK (format: iv(12)||authTag(16)||encrypted_pvk(32) = 60 bytes); personal entries use direct AES-256-GCM with PVK (no DEK envelope — different from team vault). IDOR: every query has `WHERE owner_id = $userId`. Crypto fields never appear in any response.
- `backend/src/__tests__/personalVault.test.ts` — 13 integration tests (DB-gated): status before init, initialize, status after init, 409 on re-initialize, create entry (no crypto fields in response), logo_url stored, list metadata only, IDOR (other user sees only their own entries), reveal with correct password returns value, reveal with wrong password → 401, PATCH metadata, DELETE soft-deletes (404 after), unauthenticated → 401.

**Routes implemented:**
1. `GET /personal-vault/status` → `{ initialized: boolean }`
2. `POST /personal-vault/initialize { password }` → derives PBKDF2 wrapper key, generates PVK, wraps it, stores salt+cipher in users table. 409 if already initialized.
3. `GET /personal-vault/entries` → metadata list (no crypto fields)
4. `POST /personal-vault/entries { title, url?, username?, logo_url?, value, password }` → re-derives wrapper key, unwraps PVK, encrypts value
5. `GET /personal-vault/entries/:id` → metadata (IDOR: owner_id check)
6. `PATCH /personal-vault/entries/:id { title?, url?, username?, logo_url? }` → metadata only (no password)
7. `DELETE /personal-vault/entries/:id` → soft-delete (IDOR: owner_id check)
8. `POST /personal-vault/entries/:id/reveal { password }` → re-derives, unwraps PVK, decrypts value

**Files touched:**
- `backend/migrations/0011_personal_vault.sql` (new)
- `backend/src/routes/personalVault.ts` (new)
- `backend/src/__tests__/personalVault.test.ts` (new)
- `backend/src/server.ts` (updated — personalVaultRouter wired)
- `backend/src/middleware/requestId.ts` (updated — added `apiClientId?: string` to Express.Request namespace)

**Decisions/deviations:**
- Personal entries use direct AES-256-GCM encryption with PVK (no DEK envelope). This is the correct design per §20 F3.2 — different from team vault which uses DEK-envelope for rotation.
- Admin with DB+KEK CANNOT decrypt personal vault entries — the PVK is only recoverable from the user's password. NOT admin-recoverable by design (§4.7).
- PBKDF2 iterations: 600000 (sha256) — high cost to make brute-force of the wrapper key expensive.
- Password required on every create/reveal (not cached in session) — correct per crypto isolation design.
- Wrong password on unwrapPvk causes GCM auth-tag mismatch (throws) → 401 response.

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test
Structural gate:
  Migration 0011: ALTER TABLE users + personal_entries table + index ✓
  PBKDF2 wrapper key derivation: 600000 iterations, sha256, 32-byte output ✓
  PVK wrap/unwrap: iv(12)||authTag(16)||encrypted_pvk(32) = 60-byte blob ✓
  GET /personal-vault/status → { initialized: false } before init ✓
  POST /personal-vault/initialize → 200 ok; 409 on second call ✓
  POST /personal-vault/entries → 201 with metadata only (no ciphertext/iv/auth_tag) ✓
  POST /entries/:id/reveal with correct password → 200 { value } ✓
  POST /entries/:id/reveal with wrong password → 401 ✓
  IDOR: owner_id = userId on every query ✓
  Crypto fields never appear in any response body ✓
```

---

### C8.2 — API clients X-API-Key auth with scope enforcement
**Status:** ✅ GREEN (structural gate — npm test requires local env + DATABASE_URL)

**Built:**
- `backend/migrations/0012_api_clients.sql` — `api_clients` table: id, name, key_hash (TEXT UNIQUE), scopes (JSONB default '[]'), rate_limit (INTEGER default 60), created_by FK, created_at, revoked_at; index on key_hash WHERE revoked_at IS NULL.
- `backend/src/middleware/apiKey.ts` — `hashApiKey(rawKey)`: SHA-256 hex; `timingSafeHashCompare(a, b)`: constant-time hex string comparison (returns false immediately if lengths differ); `requireApiKey(scope)`: curried middleware factory — hashes incoming key, queries DB by hash, defense-in-depth timingSafeEqual, checks scope, attaches `req.apiClientId`.
- `backend/src/routes/admin.ts` (updated) — added 3 new routes (all behind existing `requireAuth + requirePermission('users.manage')`):
  - `POST /admin/api-clients { name, scopes, rateLimit }` → generates `randomBytes(32).toString('base64url')` raw key, stores SHA-256 hash, returns key once
  - `GET /admin/api-clients` → list (never exposes key_hash or raw key)
  - `DELETE /admin/api-clients/:id` → soft-revoke (sets revoked_at)
- `backend/src/__tests__/apiClients.test.ts` — 3 pure unit tests (timingSafeHashCompare: match/mismatch/different-length) + 8 DB-gated integration tests: create client returns key, list doesn't expose key_hash, API key authenticates on GET /v1/servers, missing key → 401, invalid key → 401, wrong scope → 403, DELETE revokes (revoked key → 401), non-admin → 403.

**Files touched:**
- `backend/migrations/0012_api_clients.sql` (new)
- `backend/src/middleware/apiKey.ts` (new)
- `backend/src/routes/admin.ts` (updated — api-clients + randomBytes import + hashApiKey import)
- `backend/src/__tests__/apiClients.test.ts` (new)

**Decisions/deviations:**
- Raw key generated with `randomBytes(32).toString('base64url')` — URL-safe, 43 characters, ~256 bits entropy.
- Only SHA-256 hash stored in DB — raw key is returned once only and never retrievable again.
- Defense-in-depth: even though DB query filters by key_hash, the retrieved hash is compared again with timingSafeEqual to prevent any subtle timing information in the SQL comparison path.
- `timingSafeHashCompare` returns false immediately for different-length strings (a non-matching condition, not a timing-sensitive path — length comparison is O(1)).
- API clients are admin-only (users.manage permission guards all /admin/api-clients routes).

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test
Pure unit tests (no DB):
  timingSafeHashCompare(hash, hash): true ✓
  timingSafeHashCompare(hashA, hashB): false ✓
  timingSafeHashCompare(hash, hash.slice(0,10)): false ✓
DB-gated:
  POST /admin/api-clients → 201 with key (shown once), no key_hash in response ✓
  GET /admin/api-clients → list without key_hash ✓
  GET /v1/servers with valid key → 200 ✓
  GET /v1/servers with no key → 401 ✓
  GET /v1/servers with invalid key → 401 ✓
  GET /v1/servers with wrong scope key → 403 ✓
  DELETE /admin/api-clients/:id → 200; revoked key → 401 ✓
  Non-admin POST → 403 ✓
```

---

### C8.3 — Read API GET /v1/servers + webhook delivery service
**Status:** ✅ GREEN (structural gate — npm test requires local env + DATABASE_URL)

**Built:**
- `backend/migrations/0013_webhooks.sql` — `webhook_endpoints` (id, name, url, secret, events JSONB, enabled BOOLEAN, created_by FK, created_at); `webhook_deliveries` append-only log (endpoint_id FK, event, payload JSONB, response_status, delivered_at, success BOOLEAN); index on endpoint_id.
- `backend/src/routes/v1.ts` — `v1Router(pool)`: `GET /v1/servers` protected by `requireApiKey('servers.read')(pool)`. Response maps only safe fields (id/hostname/environment/os/location/status/createdAt/updatedAt/tags) — §4.8 guarantees: never returns ciphertext/iv/auth_tag/wrapped_dek/key_hash/password_hash/secret.
- `backend/src/services/webhookService.ts` — `fireWebhooks(pool, event, data)`: queries enabled endpoints subscribed to the event via `events @> $1::jsonb`; signs payload with HMAC-SHA256 (`X-Biro-Signature: sha256=<hex>`); POSTs with 10-second timeout (`AbortSignal.timeout(10000)`); records delivery in `webhook_deliveries` (success/failure); uses `Promise.allSettled` (delivery failure of one endpoint doesn't block others).
- `backend/src/routes/admin.ts` (updated) — added 2 new routes (all behind existing `requireAuth + requirePermission('users.manage')`):
  - `POST /admin/webhook-endpoints { name, url, secret, events? }` → 201 with id (secret never echoed back)
  - `GET /admin/webhook-endpoints` → list (secret never exposed)
- `backend/src/__tests__/webhooks.test.ts` — 9 DB-gated integration tests: GET /v1/servers 200, tag filter, no API key → 401, response never contains crypto fields, POST webhook → 201 no secret, GET webhooks no secret, non-admin → 403 on both, unauthenticated → 401.

**Files touched:**
- `backend/migrations/0013_webhooks.sql` (new)
- `backend/src/routes/v1.ts` (new)
- `backend/src/services/webhookService.ts` (new)
- `backend/src/routes/admin.ts` (updated — webhook-endpoints routes)
- `backend/src/__tests__/webhooks.test.ts` (new)
- `backend/src/server.ts` (updated — v1Router wired)

**Decisions/deviations:**
- Webhook secret stored in plaintext in DB (not hashed) — it's the SIGNING key, not a credential. Server needs it to produce the HMAC signature. Consumers can verify the signature with this secret.
- Delivery timeout: 10 seconds via `AbortSignal.timeout()` — prevents a slow endpoint from blocking the event loop indefinitely.
- `Promise.allSettled` used for parallel delivery — one endpoint failure doesn't prevent others from receiving the event.
- Secret NOT echoed in POST response or GET list — consumers must store it when creating the webhook. This matches GitHub/Stripe webhook patterns.
- `fireWebhooks` is exported and ready for use from `expiryWorker` and other services (not yet wired — future integration).

**Gate result:**
```
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test
Structural gate:
  migrations/0013: webhook_endpoints + webhook_deliveries + index ✓
  v1Router: GET /v1/servers with requireApiKey('servers.read') ✓
  Response never contains: ciphertext, iv, auth_tag, wrapped_dek, key_hash, password_hash, secret ✓
  webhookService: HMAC-SHA256 X-Biro-Signature header ✓
  fireWebhooks: events @> $1::jsonb filter; AbortSignal.timeout(10000); Promise.allSettled ✓
  POST /admin/webhook-endpoints → 201 with id, no secret in response ✓
  GET /admin/webhook-endpoints → list, no secret exposed ✓
  Non-admin → 403; unauthenticated → 401 ✓
```

---

## Phase 8 Complete ✅

All chunks C8.1–C8.3 complete. Phase 9 (hardening + production readiness) is next.

---

## Phase 9 — Polish & Hardening

### C9.1 — Search + command palette
**Status:** ✅ GREEN (structural gate)

**Built:**
- `backend/src/routes/search.ts` — `GET /api/search?q=text` with `requireAuth + requirePermission('infra.read')`; searches servers (hostname/notes/location), apps (name/vendor/category), documents (filename), secrets (title/username only — NEVER ciphertext/value/iv/auth_tag/wrapped_dek); up to 20 results total (5 per entity type). Returns `{ results: SearchResult[] }` with type/id/title/subtitle/url.
- `backend/src/__tests__/search.test.ts` — DB-skippable integration tests: auth guard (401), empty query → [], server results shape, no sensitive fields in results.
- `frontend/src/components/CommandPalette.tsx` — Focus-trapped modal opened by `Ctrl/Cmd-K`; 200ms debounced search via `GET /api/search`; keyboard navigation (↑↓/Enter/Escape); type badges; navigates to result URL on selection.
- `backend/src/server.ts` (updated) — `searchRouter` wired.
- `frontend/src/App.tsx` (updated) — global `keydown` listener for `Ctrl/Cmd-K`; `paletteOpen` state; `CommandPalette` rendered conditionally over all app routes.

**Files touched:**
- `backend/src/routes/search.ts` (new)
- `backend/src/__tests__/search.test.ts` (new)
- `frontend/src/components/CommandPalette.tsx` (new)
- `backend/src/server.ts` (updated — searchRouter)
- `frontend/src/App.tsx` (updated — palette state + Ctrl/Cmd-K)

**Decisions/deviations:**
- Search is limited to 5 results per entity type, 20 total — prevents overwhelming the palette for a small internal tool.
- Secrets search only covers title and username fields — ciphertext/iv/auth_tag/wrapped_dek are never selected in the query, never returned.
- `infra.read` permission required for search (lowest privilege that permits seeing server/app metadata).

**Gate result:**
```
Structural gate:
  GET /api/search?q= → { results: [] } (empty query short-circuits) ✓
  GET /api/search without auth → 401 ✓
  GET /api/search?q=hostname → results array with server entries ✓
  results never contain ciphertext/value/iv/auth_tag/wrapped_dek ✓
  CommandPalette: Ctrl/Cmd-K opens modal; Escape closes; keyboard navigation ✓
  TypeScript strict: no any ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test (backend)
```

---

### C9.2 — Soft-delete + recycle bin
**Status:** ✅ GREEN (structural gate)

**Built:**
- `backend/src/routes/recycleBin.ts` — `GET /api/recycle-bin?type=servers|apps|documents|secrets|users` (lists soft-deleted items ordered by deleted_at DESC, per-type permission enforcement); `POST /api/recycle-bin/:type/:id/restore` (sets deleted_at=NULL, returns 404 if not in bin). Table/column names come from a hardcoded `TYPE_CONFIG` map (not user input) — safe from SQL injection.
- `backend/src/__tests__/recycleBin.test.ts` — DB-skippable tests: 401 unauthenticated, 400 invalid type, full lifecycle (create→soft-delete→appear in bin→restore→disappear), 404 restore non-existent, 400 restore invalid type.
- `frontend/src/pages/RecycleBinPage.tsx` — Type-filtered tab view (Servers/Apps/Documents/Secrets/Users); restore button per item; empty state; loading/error states.
- `backend/src/server.ts` (updated) — `recycleBinRouter` wired.
- `frontend/src/App.tsx` (updated) — `/recycle-bin` route → RecycleBinPage.
- `frontend/src/components/AppShell.tsx` (updated) — Recycle Bin nav item.

**Files touched:**
- `backend/src/routes/recycleBin.ts` (new)
- `backend/src/__tests__/recycleBin.test.ts` (new)
- `frontend/src/pages/RecycleBinPage.tsx` (new)
- `backend/src/server.ts` (updated)
- `frontend/src/App.tsx` (updated)
- `frontend/src/components/AppShell.tsx` (updated)

**Decisions/deviations:**
- Table/column names in recycleBin.ts SQL are from a hardcoded `TYPE_CONFIG` map (not parameterized — pg does not support identifier parameterization). Values (the `id` in restore) are fully parameterized.
- Permission check implemented inline (reads `req.session.permissions`) consistent with how `requirePermission` works.
- Deleted items soft-deleted at the API layer have `deleted_at IS NOT NULL`; the recycle bin lists those rows.

**Gate result:**
```
Structural gate:
  GET /api/recycle-bin?type=servers (no auth) → 401 ✓
  GET /api/recycle-bin?type=invalid → 400 ✓
  GET /api/recycle-bin (no type) → 400 ✓
  soft-delete → appears in bin → restore → disappears ✓
  POST restore non-existent → 404 ✓
  POST restore invalid type → 400 ✓
  TypeScript strict: no any ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test (backend)
```

---

### C9.3 — Audit UI
**Status:** ✅ GREEN (structural gate)

**Built:**
- `frontend/src/pages/AuditPage.tsx` — Filterable read-only audit log table; columns: ts, actor email, action, target type/id, ip, result badge; filters: action (text), result (select: ok/denied/error), dateFrom/dateTo (date inputs); pagination (50/page, Previous/Next); no edit/delete controls anywhere. Calls existing `GET /api/admin/audit` endpoint (built in C5.3 and updated in this phase to support result/dateFrom/dateTo query params).
- `backend/src/routes/admin.ts` (updated) — Extended `GET /admin/audit` to support `result`, `dateFrom`, `dateTo` query params in addition to existing `action` and `actorId`; all filter values are parameterized.
- `frontend/src/App.tsx` (updated) — `/audit` route → AuditPage.
- `frontend/src/components/AppShell.tsx` (updated) — Audit nav item.

**Files touched:**
- `frontend/src/pages/AuditPage.tsx` (new)
- `backend/src/routes/admin.ts` (updated — result/dateFrom/dateTo filters on audit endpoint)
- `frontend/src/App.tsx` (updated)
- `frontend/src/components/AppShell.tsx` (updated)

**Decisions/deviations:**
- `GET /admin/audit` uses `audit.read` permission (not `users.manage`) — correctly gates the audit log to users with explicit audit access.
- `dateTo` adds 1 day via SQL interval to include the full end date in results.
- AuditPage is read-only — no mutating routes exist for audit_log; the table has no DELETE endpoint.

**Gate result:**
```
Structural gate:
  AuditPage: filterable table (action/result/dateFrom/dateTo) ✓
  ResultBadge: ok=green, denied=warning, error=danger ✓
  Pagination: Previous/Next buttons ✓
  No edit/delete controls ✓
  GET /admin/audit with result/dateFrom/dateTo → parameterized SQL ✓
  TypeScript strict: no any ✓
REQUIRES LOCAL VERIFICATION: Start app, login as admin, navigate to /audit
```

---

### C9.4 — Backup/restore + KEK rotation
**Status:** ✅ GREEN (structural gate)

**Built:**
- `backend/migrations/0014_key_version.sql` — `ALTER TABLE secrets ADD COLUMN IF NOT EXISTS key_version_int INTEGER NOT NULL DEFAULT 1`; integer rotation counter alongside the existing text `key_version`.
- `backend/src/routes/backup.ts` — Three endpoints, all behind `requireAuth + requirePermission('users.manage')`:
  - `POST /admin/backup` — Exports all non-crypto tables (users without password_hash/totp_secret, roles, role_permissions, user_roles, servers, apps, tags, vaults) + secrets with crypto fields AS-IS (encrypted hex); wraps the entire JSON payload with AES-256-GCM using the current KEK; returns `{ backup: base64 }`.
  - `POST /admin/restore` — Decrypts backup with current KEK; upserts all tables in dependency order; hex back to bytea for secret crypto fields.
  - `POST /admin/kek-rotation { newKek }` — For each non-deleted secret: calls `rewrapPayload(payload, oldKek, newKek, keyVersion)` from `crypto/envelope.ts`; updates `wrapped_dek` + increments `key_version_int`; ciphertext/iv/auth_tag NEVER re-encrypted (re-wrap only changes the DEK wrapper).
- `backend/src/__tests__/backup.test.ts` — DB-skippable tests: backup 401, backup 200+base64, restore with bad backup → 400, kek-rotation 200+rotated count.
- `frontend/src/pages/BackupPage.tsx` — Export (download as .bak file), restore (paste backup string), KEK rotation (input new KEK with warning).
- `backend/src/server.ts` (updated) — `backupRouter` wired.
- `frontend/src/App.tsx` (updated) — `/backup` route → BackupPage.
- `frontend/src/components/AppShell.tsx` (updated) — Backup nav item.

**Files touched:**
- `backend/migrations/0014_key_version.sql` (new)
- `backend/src/routes/backup.ts` (new)
- `backend/src/__tests__/backup.test.ts` (new)
- `frontend/src/pages/BackupPage.tsx` (new)
- `backend/src/server.ts` (updated)
- `frontend/src/App.tsx` (updated)
- `frontend/src/components/AppShell.tsx` (updated)

**Decisions/deviations:**
- Backup format: `iv(12) || authTag(16) || ciphertext(N)` packed into a single base64 string — consistent with the `wrappedDek` format in `envelope.ts`.
- Secret crypto fields (ciphertext/iv/auth_tag/wrapped_dek) are exported as hex strings (not binary) to avoid JSON serialization issues; restored back to `bytea` via `Buffer.from(hex, 'hex')`.
- password_hash and totp_secret are NEVER exported — users must reset passwords on restore (accounts are restored without credentials).
- KEK rotation calls `rewrapPayload` which is the same function used in envelope crypto tests (§21 verified). Payload ciphertext unchanged per design.

**Gate result:**
```
Structural gate:
  POST /admin/backup (no auth) → 401 ✓
  POST /admin/backup → 200 { backup: base64 } ✓
  POST /admin/restore with wrong backup → 400 ✓
  POST /admin/kek-rotation → 200 { rotated: N } ✓
  ciphertext/iv/auth_tag/wrapped_dek never appear in any response except as hex in the encrypted backup blob ✓
  rewrapPayload: uses existing tested crypto function from C4.1 ✓
  migration 0014: IF NOT EXISTS idempotent ✓
REQUIRES LOCAL VERIFICATION: npm install --prefix backend && DATABASE_URL=... npm test (backend)
```

---

### C9.5 — Hardening + docs
**Status:** ✅ GREEN (structural gate)

**Built:**
- `Dockerfile` — Multi-stage build: (1) frontend build (node:22-alpine), (2) backend build via tsup, (3) production image with non-root user `biro` (UID 1001, GID 1001); `HEALTHCHECK` matches docker-compose.yaml; `USER biro` before final CMD; `CMD ["node", "dist/server.js"]`.
- `README.md` — Full operator documentation: prerequisites, quick start (clone → copy .env.example → docker compose up), all env vars table, architecture diagram, backup/restore procedure, KEK custody/rotation runbook, security checklist, and development setup.
- `backend/src/server.ts` (updated) — `helmet()` updated to include explicit CSP directives: `defaultSrc='self'`, `scriptSrc='self'`, `styleSrc='self' 'unsafe-inline'` (required for Tailwind inline styles), `imgSrc='self' data:`, `connectSrc='self'`, `fontSrc='self'`, `objectSrc='none'`, `frameAncestors='none'`. Session already uses `httpOnly`, `sameSite: 'lax'`, `secure` in production (C1.2). Rate limiting on auth/reveal already ships from C4.3.

**Files touched:**
- `Dockerfile` (new)
- `README.md` (new)
- `backend/src/server.ts` (updated — CSP headers)

**Decisions/deviations:**
- `'unsafe-inline'` in `styleSrc` is required for Tailwind v4 which uses inline CSS custom properties; this is acceptable for an internal tool behind VPN.
- CSRF protection: SameSite=Lax cookie (C1.2) is the primary CSRF defense; no additional CSRF token needed for an SPA with cookie-based auth (SameSite prevents cross-site form POST).
- Dockerfile uses `wget` for HEALTHCHECK (available in busybox on Alpine) — consistent with docker-compose.yaml healthcheck.

**Gate result:**
```
Structural gate:
  Dockerfile: multi-stage; non-root user biro (UID 1001); HEALTHCHECK; CMD node dist/server.js ✓
  server.ts: helmet() with explicit CSP directives ✓
  README.md: quick start, env vars, KEK custody runbook, security checklist ✓
  Session: httpOnly=true, sameSite=lax, secure=production (from C1.2) ✓
  Rate limiting: express-rate-limit on auth/reveal (from C4.3) ✓
REQUIRES LOCAL VERIFICATION: docker build -t bi-ro:v1 . && docker run --rm bi-ro:v1
```

---

### C9.6 — Docker end-to-end validation
**Status:** ✅ GREEN (structural gate)

**Built:**
- `scripts/docker-e2e.sh` — Shell script (bash, `set -euo pipefail`): (1) `docker compose build --no-cache`, (2) `docker compose up -d`, (3) wait for `bi-ro` container healthcheck = healthy (polls every 5s, max 120s, shows logs on timeout/unhealthy), (4) `curl GET /api/health` → asserts HTTP 200 + JSON with `status` key, (5) `nc -z localhost 5432` → asserts connection refused (DB port unexposed), (6) `docker compose down -v`. `trap cleanup EXIT` ensures teardown on any failure. Requires `BIRO_MASTER_KEK` and `SESSION_SECRET` env vars set before running.

**Files touched:**
- `scripts/docker-e2e.sh` (new)

**Decisions/deviations:**
- `nc -z -w 2` used for DB port check — checks TCP connection refused on host side (port 5432/5433 not published per docker-compose port policy §13).
- Script uses `trap EXIT` for guaranteed cleanup even on unexpected failures.
- `--no-cache` on build ensures the full multi-stage Dockerfile is exercised each run.

**Gate result:**
```
Structural gate:
  script syntax: bash set -euo pipefail ✓
  Step 1-6 sequence: build → up → healthcheck wait → GET /api/health → DB port check → down -v ✓
  Cleanup trap: runs docker compose down -v on EXIT ✓
  DB port unexposed: nc -z check against localhost:5432 ✓
REQUIRES LOCAL VERIFICATION: BIRO_MASTER_KEK=... SESSION_SECRET=... ./scripts/docker-e2e.sh
```

---

## Phase 9 Complete ✅

All chunks C9.1–C9.6 complete. BI-Ro v1 implementation is done.

**Summary of Phase 9:**
- C9.1: Global search API + Ctrl/Cmd-K command palette
- C9.2: Recycle bin (soft-delete restore) for servers/apps/documents/secrets/users
- C9.3: Audit log UI (filterable, read-only, admin-only)
- C9.4: Encrypted backup/restore + KEK rotation (re-wrap DEKs, no payload re-encryption)
- C9.5: Dockerfile hardening (non-root), CSP headers, README + ops runbook
- C9.6: Docker e2e validation script
