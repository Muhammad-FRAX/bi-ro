#!/usr/bin/env bash
# docker-e2e.sh — End-to-end Docker validation for BI-Ro
#
# Runs the full Docker lifecycle:
#   1. docker compose build
#   2. docker compose up -d
#   3. Wait for bi-ro healthcheck to go green
#   4. Hit GET /api/health from the host and confirm 200 JSON
#   5. Confirm the database port is NOT reachable on the host
#   6. docker compose down -v
#
# Prerequisites: docker compose (v2), curl, nc
# Usage: ./scripts/docker-e2e.sh
# Exit 0 on success, non-zero on failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yaml"

APP_HOST="http://localhost:5000"
DB_HOST="localhost"
DB_PORT="5432"
MAX_WAIT_SECONDS=120
POLL_INTERVAL=5

# Color helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[e2e]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[e2e]${NC} $*"; }
log_error() { echo -e "${RED}[e2e] ERROR:${NC} $*" >&2; }

# Ensure required env vars are set for the compose run
: "${BIRO_MASTER_KEK:?BIRO_MASTER_KEK must be set. Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"}"
: "${SESSION_SECRET:?SESSION_SECRET must be set. Generate: node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\"}"

export BIRO_MASTER_KEK
export SESSION_SECRET
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-biro_e2e_test_pw}"

cleanup() {
  log_warn "Cleaning up — running docker compose down -v …"
  docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

# ── Step 1: docker compose build ─────────────────────────────────────────────
log_info "Step 1/6: Building Docker images …"
docker compose -f "${COMPOSE_FILE}" build --no-cache
log_info "Build complete."

# ── Step 2: docker compose up -d ─────────────────────────────────────────────
log_info "Step 2/6: Starting containers …"
docker compose -f "${COMPOSE_FILE}" up -d
log_info "Containers started."

# ── Step 3: Wait for bi-ro healthcheck to go green ───────────────────────────
log_info "Step 3/6: Waiting for bi-ro container healthcheck to go green (max ${MAX_WAIT_SECONDS}s) …"
elapsed=0
while true; do
  health_status="$(docker inspect --format='{{.State.Health.Status}}' bi-ro 2>/dev/null || echo 'unknown')"
  if [[ "${health_status}" == "healthy" ]]; then
    log_info "Container bi-ro is healthy."
    break
  fi
  if [[ "${health_status}" == "unhealthy" ]]; then
    log_error "Container bi-ro health status: unhealthy"
    docker logs bi-ro --tail 50
    exit 1
  fi
  if [[ $elapsed -ge $MAX_WAIT_SECONDS ]]; then
    log_error "Timed out waiting for bi-ro to become healthy (last status: ${health_status})"
    docker logs bi-ro --tail 50
    exit 1
  fi
  log_warn "  Health status: ${health_status} — waiting ${POLL_INTERVAL}s … (${elapsed}/${MAX_WAIT_SECONDS}s)"
  sleep "${POLL_INTERVAL}"
  elapsed=$((elapsed + POLL_INTERVAL))
done

# ── Step 4: Hit GET /api/health from the host ────────────────────────────────
log_info "Step 4/6: Hitting GET ${APP_HOST}/api/health …"
http_code="$(curl -s -o /tmp/bi-ro-health.json -w '%{http_code}' "${APP_HOST}/api/health")"
if [[ "${http_code}" != "200" ]]; then
  log_error "GET /api/health returned HTTP ${http_code}"
  cat /tmp/bi-ro-health.json
  exit 1
fi
body="$(cat /tmp/bi-ro-health.json)"
log_info "Response: ${body}"
if ! echo "${body}" | grep -q '"status"'; then
  log_error "/api/health response does not contain 'status' key: ${body}"
  exit 1
fi
log_info "Health check passed: HTTP 200 with JSON body."

# ── Step 5: Confirm database port NOT reachable on host ──────────────────────
log_info "Step 5/6: Confirming database port ${DB_HOST}:${DB_PORT} is NOT reachable from host …"
if nc -z -w 2 "${DB_HOST}" "${DB_PORT}" 2>/dev/null; then
  log_error "Database port ${DB_PORT} is reachable from the host — this is a security misconfiguration!"
  exit 1
fi
log_info "Database port ${DB_PORT} is NOT exposed on the host. Good."

# ── Step 6: docker compose down -v ───────────────────────────────────────────
log_info "Step 6/6: Tearing down containers and volumes …"
# Disable trap first to avoid double-cleanup
trap - EXIT
docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans
log_info "Cleanup complete."

log_info ""
log_info "============================================"
log_info "  BI-Ro Docker e2e validation: PASSED"
log_info "============================================"
