# Grimoire — one container: Hono API + the built frontend (issue #13).
# Operations doc: docs/DEPLOYMENT.md. Deployment shape per DECISIONS #3/#5.
#
#   docker build -t grimoire .
#   docker run -d -p 3000:3000 -v /srv/grimoire/campaigns:/campaigns grimoire
#
# No TypeScript build step for server/ and shared/ (DECISIONS #8): Bun runs
# the sources directly. The only build output is the Vite bundle in app/dist,
# which the server then serves statically (server/src/static-files.ts).

# --- stage 1: build the frontend ---------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app

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

# The demo campaign ships in the image at the default CAMPAIGN_ROOT, so a
# container started WITHOUT a volume is not empty. A mounted volume on
# /campaigns simply shadows it (see docs/DEPLOYMENT.md). Owned by the bun user
# because the API writes into the campaign root (session logs, inbox, drafts).
COPY --chown=bun:bun examples /campaigns

# CAMPAIGN_ROOT is set explicitly: the dev default (../examples, relative to
# the server package) does not apply to this layout.
ENV CAMPAIGN_ROOT=/campaigns \
    PORT=3000
# ANTHROPIC_API_KEY is optional — without it the read/write API works and only
# POST /api/:campaign/generate answers 503.

EXPOSE 3000
USER bun

# Exec form on purpose: no shell, so the JS string is passed through verbatim.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["bun", "-e", "const url = 'http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/campaigns'; const r = await fetch(url); process.exit(r.ok ? 0 : 1)"]

# The file watcher and the static routes are wired up only when server.ts is
# the process entrypoint (import.meta.main) — `bun run <file>` is exactly that.
CMD ["bun", "run", "server/src/server.ts"]
