# Containerized "operational" build of the whole app: server/src/index.ts
# does consolidated serving (API + the frontend's static build, one process,
# one port) — this image just packages that. See docker-compose.prod.yml for
# how it's actually run, and CLAUDE.md "Containerized operational deployment"
# for why this exists (in short: it lets `server` reach `judge` over a
# Docker-internal network instead of a host-published port, which is what
# makes judge's outbound network access blockable — see docs/operations.md).
#
# Build context is the REPO ROOT, not server/ — this needs both the frontend
# source (src/, index.html, vite.config.ts, ...) and server/ itself:
#   docker build -f server/Dockerfile .
# (docker-compose.prod.yml's `server` service does this for you.)

# ---- 1. frontend build -----------------------------------------------------
# Debian/glibc (not Alpine) specifically for this stage: Vite/oxlint's native
# optional dependencies (@rolldown/binding-*, @oxlint/binding-*) are more
# reliably available for glibc than musl — see CLAUDE.md's Node-version note
# for the broader native-binding fragility this project already works around.
# Only this stage's *output* (static files) is copied forward; its toolchain
# never reaches the runtime image.
FROM node:22.12-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
# Same-origin relative API paths (`fetch("/api/...")`) — this build is always
# served by this same server/port, whatever host it ends up on. Mirrors
# .env.production.example; see CLAUDE.md "Consolidated serving".
ENV VITE_API_BASE_URL=""
RUN npm run build

# ---- 2. server build --------------------------------------------------------
FROM node:22.12-alpine AS server-build
WORKDIR /app/server
# Prisma's query engine needs a real OpenSSL on Alpine.
RUN apk add --no-cache openssl
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/prisma ./prisma
COPY server/src ./src
# Must generate the Prisma Client *before* tsc — src/**/*.ts imports types
# from it (@prisma/client), so building first fails with "has no exported
# member" for every model/enum.
RUN npm run prisma:generate
RUN npm run build

# ---- 3. runtime -------------------------------------------------------------
FROM node:22.12-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
# Production-only deps, installed fresh here (not copied from server-build)
# so devDependencies (tsx, typescript, prisma CLI, @types/*) never reach the
# image.
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev
# server/src and server/dist sit at the same depth under server/, and the
# frontend build sits one level above that — see server/src/index.ts's
# CLIENT_DIST_PATH comment. This layout reproduces that on purpose; don't
# rearrange it without updating that resolution.
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/node_modules/.prisma ./server/node_modules/.prisma
COPY --from=server-build /app/server/prisma ./server/prisma
COPY --from=frontend-build /app/dist ./dist

# Unprivileged (the base image ships a `node` user/group at uid/gid 1000).
USER node

EXPOSE 4000
CMD ["node", "server/dist/index.js"]
