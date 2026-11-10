# syntax=docker/dockerfile:1

# The Node image is pinned by tag and digest, written out in both FROM lines so Dependabot
# can update them. CI checks the tag matches .node-version.
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install --global pnpm@12.15.0
WORKDIR /app

# Local dev: source is bind-mounted; see compose.yaml.
FROM base AS dev

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .
# Version info for Settings → About, baked into the web bundle. Declared after the install
# layer so changing them never invalidates the dependency cache.
ARG APP_VERSION=dev
ARG APP_RELEASE=
ARG APP_COMMIT=
ARG APP_REPO=
RUN pnpm build

# Runtime: bundled API + static SPA only. No node_modules, no package managers, no source.
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS runtime
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn*
ENV NODE_ENV=production PORT=3000 STATIC_DIR=/app/public MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /app/apps/api/dist/ ./
COPY --from=build /app/apps/api/drizzle/ ./drizzle/
COPY --from=build /app/apps/web/dist/ ./public/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--enable-source-maps", "index.js"]
