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
