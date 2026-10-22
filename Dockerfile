# syntax=docker/dockerfile:1

# The Node image is pinned by tag and digest, written out in both FROM lines so Dependabot
# can update them. CI checks the tag matches .node-version.
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS base
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
RUN pnpm build

# Runtime: bundled API + static SPA only. No node_modules, no package managers, no source.
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runtime
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
