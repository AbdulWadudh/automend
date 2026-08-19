# syntax=docker/dockerfile:1

# Multi-stage build for the React app.
#
# The bundle is built once here, then served by a small Bun server that also proxies `/api` to
# the API service. That proxy is why no API address is compiled into the JavaScript: the target
# is read from `API_URL` at container start, so one image works in every environment.

FROM oven/bun:1.3-slim AS base
WORKDIR /app

# --- dependencies (including dev, needed to run Vite) ----------------------
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
RUN bun install --frozen-lockfile --filter "@automend/web"

# --- build the static bundle ----------------------------------------------
FROM deps AS build
# Each workspace's tsconfig.json extends the root one, so it has to be present to build.
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
# Types and the catalogue schema only. `packages/kits` and `packages/kit-runtime` are deliberately absent: a kit's
# code calls third-party APIs and must never reach a browser bundle, and the runtime that executes it even less so
# — which is why the builder reads the catalogue over HTTP instead.
COPY packages/kit-framework ./packages/kit-framework
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN bun run build

# --- runtime dependencies only --------------------------------------------
FROM base AS prod-deps
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/auth/package.json ./packages/auth/
COPY packages/db/package.json ./packages/db/
COPY packages/kit-framework/package.json ./packages/kit-framework/
COPY packages/kit-runtime/package.json ./packages/kit-runtime/
COPY packages/kits/package.json ./packages/kits/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile --production --filter "@automend/web"

# --- runtime ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=prod-deps /app ./
COPY packages/shared ./packages/shared
COPY apps/web/server.ts ./apps/web/
COPY --from=build /app/apps/web/dist ./apps/web/dist

USER bun
WORKDIR /app/apps/web
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun --eval "fetch('http://127.0.0.1:'+(process.env.WEB_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "server.ts"]
