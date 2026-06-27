# ── Stage 1: Frontend build ───────────────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --prefer-offline
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Backend build ────────────────────────────────────────────────────
FROM node:22-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --prefer-offline
COPY backend/ ./
# Build TypeScript → ESM bundle in dist/
RUN npm run build

# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM node:22-alpine AS production
LABEL org.opencontainers.image.description="BI-Ro infrastructure inventory and secrets manager"

# Security: run as non-root user
RUN addgroup -g 1001 biro && \
    adduser -u 1001 -G biro -D -h /app biro

WORKDIR /app

# Install production dependencies only
COPY backend/package*.json ./
RUN npm ci --omit=dev --prefer-offline && npm cache clean --force

# Copy compiled backend bundle
COPY --from=backend-build /app/backend/dist ./dist
# Migrations run at startup (runMigrations reads from migrations/ relative to __dirname)
COPY --from=backend-build /app/backend/migrations ./migrations

# Copy compiled frontend static assets
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create uploads directory with correct ownership
RUN mkdir -p /app/uploads && chown -R biro:biro /app

# Drop to non-root user
USER biro

# Expose application port
EXPOSE 5000

# Health check — matches docker-compose.yaml
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

# Start the compiled server bundle
CMD ["node", "dist/server.js"]
