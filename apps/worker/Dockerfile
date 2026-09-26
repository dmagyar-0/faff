# syntax=docker/dockerfile:1
# The worker image (M0 plan §5, PR 0.4). Build from the repo root, since the bundle compiles
# workspace packages from source:
#   docker build -f apps/worker/Dockerfile -t faff-worker .

# --- build: install the worker's slice of the workspace and bundle it with esbuild ---------
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
# Manifests first, so the install layer is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/tools/package.json packages/tools/
COPY packages/agents/package.json packages/agents/
COPY packages/telephony/package.json packages/telephony/
COPY packages/email/package.json packages/email/
COPY packages/sim/package.json packages/sim/
RUN pnpm install --frozen-lockfile --filter @faff/worker...
COPY packages packages
COPY apps/worker apps/worker
RUN pnpm --filter @faff/worker build

# --- runtime: the bundle alone on a slim Node, as a non-root user ------------------------
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/worker/dist ./dist
# The node image's built-in unprivileged user (uid 1000).
USER node
EXPOSE 8080
# Node is PID 1 and handles SIGTERM itself (src/shutdown.ts); no init wrapper needed.
CMD ["node", "--enable-source-maps", "dist/main.mjs"]
