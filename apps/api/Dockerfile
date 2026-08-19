# syntax=docker/dockerfile:1

# Multi-stage build for the Hono API.
# No configuration is baked in — every setting is read from the environment at container start.

FROM oven/bun:1.3-slim AS base
WORKDIR /app

# --- dependencies ----------------------------------------------------------
# Only the manifests are copied first, so this layer stays cached until a dependency changes.
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
# Every workspace member's manifest, even ones this app does not import: `--frozen-lockfile`
# validates the whole lockfile, and a member missing its package.json fails the install.
COPY packages/auth/package.json ./packages/auth/
COPY packages/db/package.json ./packages/db/
COPY packages/kit-framework/package.json ./packages/kit-framework/
COPY packages/kit-runtime/package.json ./packages/kit-runtime/
COPY packages/kits/package.json ./packages/kits/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile --production --filter "@automend/api"

# --- runtime ---------------------------------------------------------------
# Bun runs TypeScript directly, so there is no compile step — the final image is the runtime
# dependencies plus the source of this app and the workspace packages it imports.
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps /app ./
# Each workspace's tsconfig.json extends the root one; Bun reads it when running TypeScript.
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/kit-framework ./packages/kit-framework
COPY packages/kit-runtime ./packages/kit-runtime
COPY packages/kits ./packages/kits
COPY packages/db ./packages/db
COPY packages/auth ./packages/auth
COPY apps/api ./apps/api

USER bun
WORKDIR /app/apps/api
EXPOSE 3000

# The probe prints what it saw when it fails, which is what a deploy log has to work from.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "run", "/app/packages/shared/scripts/health-probe.ts", "api"]

CMD ["bun", "run", "src/index.ts"]
