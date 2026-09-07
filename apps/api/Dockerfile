# syntax=docker/dockerfile:1
# Multi-stage image for @nature/api. Build context is the REPOSITORY ROOT (see
# infra/docker-compose.yml: context `..`, dockerfile `apps/api/Dockerfile`) because pnpm needs the
# workspace manifest, the lockfile and the workspace packages the API depends on.
#
#   docker build -f apps/api/Dockerfile -t nature-api:dev .
#
# Validation note: not built in the authoring container (no Docker daemon) and it needs the root
# pnpm-lock.yaml that Stream E commits (T043) — `pnpm install --frozen-lockfile` fails without it.
# Reviewed against pnpm 10 docs (`--filter <pkg>...` selects the package and its workspace
# dependencies; corepack reads `packageManager` from the root package.json) and node:22-alpine
# (BusyBox `wget` for the compose healthcheck). Stream E verifies with `docker compose up api`.
ARG NODE_VERSION=22.22.2

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable
WORKDIR /repo

# Manifests only, so dependency layers are cached until a package.json or the lockfile changes.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/ packages/

# Full install (dev deps included) and TypeScript build of the API and its workspace deps.
FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @nature/api...
COPY apps/api/ apps/api/
RUN pnpm --filter @nature/api... run build

# Production node_modules only.
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @nature/api...

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /repo/apps/api
COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./node_modules
# Built workspace packages (dist/) the API imports through its node_modules symlinks.
COPY --from=build /repo/packages /repo/packages
COPY apps/api/package.json ./package.json
COPY apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
