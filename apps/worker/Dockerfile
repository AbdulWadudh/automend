# syntax=docker/dockerfile:1

# Multi-stage build for the BullMQ worker.
# No configuration is baked in — every setting is read from the environment at container start.

FROM oven/bun:1.3-slim AS base
WORKDIR /app

# --- dependencies ----------------------------------------------------------
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile --production --filter "@automend/worker"

# --- runtime ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps /app ./
# Each workspace's tsconfig.json extends the root one; Bun reads it when running TypeScript.
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/worker ./apps/worker

USER bun
WORKDIR /app/apps/worker

# The worker serves no traffic of its own; this port exposes its health endpoint only.
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun --eval "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/index.ts"]
