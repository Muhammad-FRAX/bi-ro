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
