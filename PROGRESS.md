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
**Status:** 🔲 PENDING

### C0.3 — Backend skeleton
**Status:** 🔲 PENDING

### C0.4 — Frontend shell + design tokens
**Status:** 🔲 PENDING
