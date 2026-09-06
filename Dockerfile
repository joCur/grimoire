# Grimoire — one container: Hono API + the built frontend (issue #13).
# Operations doc: docs/DEPLOYMENT.md. Deployment shape per DECISIONS #3/#5.
#
#   docker build -t grimoire .
#   docker run -d -p 3000:3000 -v /srv/grimoire/data:/data grimoire
#
# No TypeScript build step for server/ and shared/ (DECISIONS #8): Bun runs
# the sources directly. The only build output is the Vite bundle in app/dist,
# which the server then serves statically (server/src/static-files.ts).

# --- stage 1: build the frontend ---------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app

# Build id of this image (issue #24): the release workflow passes the version
# tag (--build-arg GRIMOIRE_BUILD=v1.2.3); a local `docker build` without it
# gets "dev", which switches the app's version handshake off. Exported as env
# so the Vite build below can bake it into the bundle.
ARG GRIMOIRE_BUILD=dev
ENV GRIMOIRE_BUILD=$GRIMOIRE_BUILD

# Manifests first so `bun install` stays cached while sources change.
# app/package.json is needed in every stage because the root package.json
# declares it as a workspace.
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY app/package.json ./app/
RUN bun install --frozen-lockfile

# app/tsconfig.json extends the root tsconfig; Vite reads it during the build.
COPY tsconfig.base.json ./

# The app imports @grimoire/shared as TypeScript source, so shared/ is part
# of the build input. examples/ is needed too: the DEV-only markdown harness
# (app/src/routes/harness.tsx) imports fixture files from it via `?raw`, so
# the module must resolve even though it is tree-shaken out of the bundle.
COPY shared ./shared
COPY examples ./examples
COPY app ./app
RUN bun run --filter '@grimoire/app' build

# --- stage 2: runtime --------------------------------------------------------
FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Same id for the server (ARG does not cross stage boundaries, so it is
# declared again): bundle and server must report the SAME value, otherwise
# every fresh deploy would show its own reload banner.
ARG GRIMOIRE_BUILD=dev
ENV GRIMOIRE_BUILD=$GRIMOIRE_BUILD

# Runtime dependencies only: --production drops devDependencies, --filter
# leaves the app's build-time deps (vite, react, tailwind) out of the image.
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY app/package.json ./app/
RUN bun install --frozen-lockfile --production \
      --filter '@grimoire/server' --filter '@grimoire/shared'

# Sources (run as-is by Bun) + the generator's prompt assets, which the
# generate endpoint reads from ../generator relative to the server package.
COPY shared/src ./shared/src
COPY server/src ./server/src
COPY generator ./generator
COPY --from=build /app/app/dist ./app/dist

# The example campaign ships in the image as the source `grimoire seed` reads
# — a dev/E2E tool, never part of the boot (issue #79 AK6). A fresh container
# starts EMPTY; the cold start is issue #56's subject.
COPY --chown=bun:bun examples /examples

# GRIMOIRE_DATA is the only data setting left: the server reads and writes
# GRIMOIRE_DATA/grimoire.db and knows no campaign tree (ADR #13, issue #79).
ENV GRIMOIRE_DATA=/data \
    PORT=3000

# The database directory — this is the state of the deployment and the volume
# that must be mounted (docs/DEPLOYMENT.md, section 2a). Created here so the
# first boot without a mount still works.
RUN mkdir -p /data && chown bun:bun /data
VOLUME ["/data"]
# ANTHROPIC_API_KEY is optional — without it the read/write API works and only
# POST /api/:campaign/generate answers 503.

EXPOSE 3000
USER bun

# Exec form on purpose: no shell, so the JS string is passed through verbatim.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["bun", "-e", "const url = 'http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/campaigns'; const r = await fetch(url); process.exit(r.ok ? 0 : 1)"]

# The database boot (migrator + one-time import) and the static routes are
# wired up only when server.ts is the process entrypoint (import.meta.main) —
# `bun run <file>` is exactly that.
CMD ["bun", "run", "server/src/server.ts"]
