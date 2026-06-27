# BI-Ro — Infrastructure Inventory & Secrets Manager

BI-Ro is a self-hosted web application for documenting servers, apps, and managing secrets with envelope encryption. All secrets are encrypted at rest using AES-256-GCM.

## Prerequisites

- Docker 24+ and Docker Compose v2
- A terminal on the host machine
- `curl` and `nc` (for the e2e validation script)

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/your-org/bi-ro.git
cd bi-ro
```

### 2. Copy and configure the environment file

```bash
cp .env.example .env
```

Edit `.env` and set the required variables:

```bash
# Generate a 32-byte KEK (Key Encryption Key) — KEEP THIS SECRET AND BACKED UP
BIRO_MASTER_KEK=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

# Generate a session secret
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")

# PostgreSQL password
POSTGRES_PASSWORD=change_me_in_production

# Optional: seed the admin account on first launch
BIRO_ADMIN_EMAIL=admin@example.com
BIRO_ADMIN_PASSWORD=ChangeMe1!
```

### 3. Start the application

```bash
docker compose up -d
```

BI-Ro will be available at http://localhost:5000 after the healthcheck passes (typically 30–60 seconds).

### 4. First-time setup

On first launch, navigate to http://localhost:5000 to complete the setup wizard (set app title, accent color, and admin account if not seeded via env vars).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BIRO_MASTER_KEK` | Yes | Base64-encoded 32-byte Key Encryption Key. Protects all secret DEKs. |
| `SESSION_SECRET` | Yes | Base64-encoded session signing secret (48+ bytes recommended). |
| `DATABASE_URL` | Auto | Set by docker-compose from POSTGRES_PASSWORD. Override for external DB. |
| `AUTH_MODE` | No | `self` (default), `keycloak`, or `ldap`. |
| `BIRO_ADMIN_EMAIL` | No | Seed admin email on first launch. |
| `BIRO_ADMIN_PASSWORD` | No | Seed admin password on first launch. |
| `SMTP_HOST` | No | SMTP server for email notifications. |
| `SMTP_PORT` | No | SMTP port (default: 587). |
| `SMTP_USER` | No | SMTP username. |
| `SMTP_PASS` | No | SMTP password. |
| `SMTP_FROM` | No | From address for outgoing email. |
| `UPLOADS_DIR` | No | Directory for uploaded documents (default: `/uploads`). |
| `PORT` | No | HTTP port (default: 5000). |
| `EXPIRY_THRESHOLDS` | No | Days before expiry to trigger alerts, comma-separated (default: `7,2,0`). |

## Architecture

```
bi-ro (Node.js/Express) ──► bi-ro-db (PostgreSQL 16)
        │
        ├── /api/*        Backend REST API
        ├── /uploads/     Document storage (Docker volume)
        └── /             React SPA (built into image)
```

## Ops Runbook

### Viewing logs

```bash
docker compose logs -f bi-ro
docker compose logs -f bi-ro-db
```

### Stopping / restarting

```bash
docker compose stop
docker compose start
# or
docker compose restart bi-ro
```

### Upgrading

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

Migrations run automatically on startup — they are append-only and idempotent.

### Backup

Use the built-in Backup page at `/backup` (admin only) to download an encrypted backup, or call the API directly:

```bash
curl -s -b session.txt http://localhost:5000/api/admin/backup \
  | jq -r '.backup' > bi-ro-backup-$(date +%Y%m%d).bak
```

The backup is AES-256-GCM encrypted with `BIRO_MASTER_KEK`. **The backup is useless without the KEK** — back them up separately.

### Restore

```bash
BACKUP_B64=$(cat bi-ro-backup-YYYYMMDD.bak)
curl -s -X POST -b session.txt \
  -H 'Content-Type: application/json' \
  -d "{\"backup\":\"${BACKUP_B64}\"}" \
  http://localhost:5000/api/admin/restore
```

Restore upserts data — it does not wipe existing records. User passwords are NOT restored; users must reset them after restore.

### KEK Custody & Backup

The Key Encryption Key (`BIRO_MASTER_KEK`) is the root of trust for all secrets:

1. **Generate securely**: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. **Store offline**: Write the KEK to paper or a hardware token and store in a safe. Do not store it only in `.env`.
3. **Back up separately from the data**: A database backup without the KEK cannot decrypt secrets.
4. **Rotation**: When rotating the KEK, use the Backup page (`/backup`) KEK Rotation form, which re-wraps all DEKs. After rotation:
   - Update `BIRO_MASTER_KEK` in your `.env` (or secrets manager)
   - Restart: `docker compose restart bi-ro`
   - Verify secrets still decrypt correctly
   - Shred the old KEK from temporary storage

### KEK Rotation Procedure

```bash
# 1. Generate new KEK
NEW_KEK=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
echo "NEW_KEK: ${NEW_KEK}"  # Save this immediately!

# 2. Rotate via API (while old KEK is still active)
curl -s -X POST -b session.txt \
  -H 'Content-Type: application/json' \
  -d "{\"newKek\":\"${NEW_KEK}\"}" \
  http://localhost:5000/api/admin/kek-rotation

# 3. Update .env and restart
sed -i "s|^BIRO_MASTER_KEK=.*|BIRO_MASTER_KEK=${NEW_KEK}|" .env
docker compose restart bi-ro

# 4. Verify
curl -s http://localhost:5000/api/health
```

### Database backup (Postgres-level)

```bash
docker exec bi-ro-db pg_dump -U biro biro | gzip > biro-db-$(date +%Y%m%d).sql.gz
```

### Docker e2e validation

Validate a clean-machine deployment end-to-end:

```bash
export BIRO_MASTER_KEK=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")
bash scripts/docker-e2e.sh
```

The script: builds images, starts containers, waits for health, hits `/api/health`, confirms the DB port is not exposed, then tears down.

### Security checklist

- [ ] `BIRO_MASTER_KEK` is stored securely and backed up offline
- [ ] `SESSION_SECRET` is at least 48 random bytes
- [ ] `POSTGRES_PASSWORD` is changed from the default
- [ ] `NODE_ENV=production` is set in production
- [ ] The database port is not exposed on the host (docker-compose default)
- [ ] HTTPS is terminated by a reverse proxy (nginx, Caddy, etc.) in front of port 5000
- [ ] Regular encrypted backups are scheduled and tested
- [ ] SMTP is configured for expiry alerts and notifications

## Development

```bash
# Backend (with hot reload)
cd backend && npm install && npm run dev

# Frontend (Vite dev server, proxies /api to :5000)
cd frontend && npm install && npm run dev
```

Run tests:

```bash
cd backend
DATABASE_URL=postgres://biro:biro@localhost:5432/biro_test \
BIRO_MASTER_KEK=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
npm test
```

## License

ISC
