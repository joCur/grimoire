# Grimoire — Deployment & Operations

One container, one process: the Hono server serves `/api` **and** the built
frontend bundle from `app/dist`. The campaign data lives outside the image in
a volume. Access control is a deployment concern, not an app concern — the
default is Tailscale (see [decisions/scope](decisions/scope.md), [decisions/stack](decisions/stack.md)).

> **The campaign truth is one SQLite file ([decisions/sqlite](decisions/sqlite.md)):**
> `GRIMOIRE_DATA/grimoire.db`, default `/data` in the container. It is the
> **only** data source: the server reads no other source at startup, a fresh
> instance starts **empty** and is filled in the UI. What needs backing up
> is the `GRIMOIRE_DATA` volume — section 2a.

## 1. Build and start

> Quickest: copy the `docker-compose.yml` from the repo root to the server,
> put a `.env` with `OPENROUTER_API_KEY=…` (and optionally
> `GRIMOIRE_VERSION=v0.1.0`) next to it, `docker compose up -d`.
> Version choice, update and rollback: section 1a. Everything below is the
> manual way.


```bash
docker build -t grimoire .

docker run -d --name grimoire \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v /srv/grimoire/data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-… \
  grimoire
```

- `-p 127.0.0.1:3000:3000` deliberately binds the port to loopback only;
  outside access goes through Tailscale (section 3).
- `/data` is the **state**: that is where `grimoire.db` (plus `-wal`/`-shm`)
  lives. It is the volume that gets backed up (section 2a). It is the
  **only** data mount — the server does not read a campaign folder.
- Write permissions: the container runs as `uid 1000` (`bun`). With a bind
  mount, run `sudo chown -R 1000:1000 /srv/grimoire/data` once, otherwise
  the database cannot be created.

**A fresh instance starts empty**: the server seeds nothing at startup.
That is not a special case — on an empty instance `/` offers to create a
campaign, and chapters, scenes, NPCs and locations are then created in the
UI as well. The image contains no test data; the example campaign is a
dev/E2E fixture in the repo (CLAUDE.md, `fixtures/`).

**Update:** rebuild, replace the container (`docker rm -f grimoire` + `run`).
The container itself has no state — that lives in the `/data` volume.

### Alternative: pull a ready-made image from GHCR

The production system does not have to build itself — images live in the
GitHub Container Registry. The release workflow is the **only** writer to
this registry — a merge to main publishes nothing ([decisions/release](decisions/release.md)). So there are exactly two kinds of tag:

| Tag | From | For |
| --- | ---- | --- |
| `v0.1.0` (also `0.1.0`) | release workflow on merging the release PR | **what a production system pins to** |
| `latest` | the same release workflow | the most recent release — does **not** change on merges to main |

An unreleased state does not exist as an image: for that you build locally
(section 1).

```bash
docker pull ghcr.io/jocur/grimoire:v0.1.0

docker run -d --name grimoire \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v /srv/grimoire/data:/data \
  --env-file /srv/grimoire/.env \
  ghcr.io/jocur/grimoire:v0.1.0
```

The package is **private** on GHCR by default, so a `docker pull` without
logging in fails at first. Two ways:

- **Make it public** (once, simplest way): GitHub → Packages →
  `grimoire` → Package settings → Change visibility → `public`. After that
  any host pulls without logging in. The image contains only code and the
  example campaign, no campaign data and no secrets (`.dockerignore`).
- **Keep it private** and log in once on the host, with a personal access
  token (classic) with the scope `read:packages`:

  ```bash
  echo <PAT> | docker login ghcr.io -u jocur --password-stdin
  ```

## 1a. Version choice, update, rollback

Releases are not created automatically on every merge: release-please keeps
a release PR from the Conventional Commits on `main` ("chore(main): release
X.Y.Z"). Only its merge (with PO approval like every PR) creates the tag
`vX.Y.Z`, the GitHub release with changelog **and** the image tags above —
and only if the `ci` run of exactly that commit was green
(`require-green-ci` in `.github/workflows/release.yml`).

The compose file therefore references
`ghcr.io/jocur/grimoire:${GRIMOIRE_VERSION:-latest}`. Recommendation for
production: pin a version in `.env`.

```bash
# /srv/grimoire/.env
GRIMOIRE_VERSION=v0.1.0
```

**Update:**

```bash
# 1. Read the changelog of the new release (GitHub → Releases)
# 2. Set GRIMOIRE_VERSION in .env to the new tag
docker compose pull
docker compose up -d
```

Without `GRIMOIRE_VERSION`, `docker compose pull` pulls the most recent
release via `latest` — convenient, but afterwards you do not know which
state is running. If needed,
`docker inspect --format '{{index .Config.Env}}' grimoire | tr ' ' '\n' | grep GRIMOIRE_BUILD`
tells you which one it was (build id = release tag).

**Rollback** is the same step in reverse — no state in the container,
everything lives in the volume:

```bash
# GRIMOIRE_VERSION back to the last good tag
docker compose up -d
```

Manually (without Compose): `docker rm -f grimoire`, then the same
`docker run` as above with `ghcr.io/jocur/grimoire:<old-version-tag>`.
Version tags are the only rollback reference — a changelog belongs to them,
and old releases stay in GHCR.

## 2. Configuration (env variables)

| Variable            | Default      | Meaning                                                       |
| ------------------- | ------------ | ------------------------------------------------------------- |
| `GRIMOIRE_DATA`     | `/data` (in the image; otherwise `./data` next to the `server/` package) | Directory of the SQLite database `grimoire.db` — **the state of the deployment** (section 2a) |
| `PORT`              | `3000`       | HTTP port in the container                                    |
| `APP_DIST`          | `../app/dist` (relative to the `server/` package) | Path of the frontend build; already correct in the image |
| `GRIMOIRE_BUILD`    | `dev`        | Build id; baked into the bundle **and** the server as a build arg — for GHCR images the release tag (`v0.1.0`), for local builds whatever you pass as `--build-arg` (otherwise `dev`) |
| `GRIMOIRE_VERSION`  | `latest`     | **Compose file only**, not an app setting: the image tag `docker compose` pulls (section 1a) |

## 2a. Database, volume and backup

The entire campaign truth is **one file**:

```
$GRIMOIRE_DATA/
  grimoire.db        ← campaigns, scenes, NPCs, locations, threads, sessions,
  grimoire.db-wal      log, ideas, glossary, generator jobs, search index
  grimoire.db-shm
```

- `-wal` and `-shm` **are part of the data**. Copying only `grimoire.db`
  while the server is running copies an incomplete state.
- Schema migrations run automatically at startup (in a transaction,
  bookkeeping in `__drizzle_migrations`). A **downgrade** is not
  supported: the way back when there are problems is your own volume backup
  plus an image rollback to the old tag ([decisions/release](decisions/release.md)). A migration
  that rewrites content gets its own section.
- Installations before v0.7 are not supported.
- **WAL on bind mounts:** WAL needs working `mmap`/locking in the mounted
  file system. Local bind mounts and Docker volumes are fine;
  **network file systems (NFS, SMB/CIFS) are not** — there the database
  belongs on local storage, not on the share.

### Backup — the stack owner's job

Grimoire **deliberately has no backup system of its own**: no
`grimoire backup`, no automatic backups before migration boots. There is one
file in a volume, and the operator backs it up with their own tools.
Two ways that are consistent:

```bash
# a) while running, without downtime — a consistent single-file snapshot:
sqlite3 /srv/grimoire/data/grimoire.db "VACUUM INTO '/backup/grimoire-$(date +%F).db'"

# b) or stop the container and back up the whole directory:
docker compose stop
tar czf /backup/grimoire-$(date +%F).tar.gz -C /srv/grimoire data
docker compose start
```

A `cp grimoire.db` while running is **not** a backup — use `VACUUM INTO` or
stop the container. Restoring is the same in reverse: stop the container,
put the file(s) back, start the container.

## 2b. Generator (LLM provider)

Everything here is **optional** — without configuration everything except
the generator runs. `LLM_PROVIDER` selects the provider; the other variables
apply only to the selected one:

| Variable             | Applies to   | Default                        | Meaning                                               |
| -------------------- | ------------ | ------------------------------ | ----------------------------------------------------- |
| `LLM_PROVIDER`       | –            | `claude`                       | `claude`, `openrouter`, `openai`, `lmstudio`           |
| `ANTHROPIC_API_KEY`  | `claude`     | –                              | **required** for `claude`                              |
| `CLAUDE_MODEL`       | `claude`     | `claude-sonnet-5`            | Model override                                         |
| `OPENROUTER_API_KEY` | `openrouter` | –                              | **required** for `openrouter`                          |
| `LLM_MODEL`          | `openrouter`, `openai` | –                    | **required**, e.g. `anthropic/claude-sonnet-5`       |
| `LLM_BASE_URL`       | `openai` (required), `openrouter` (override) | `https://openrouter.ai/api/v1` | API root of an OpenAI-compatible endpoint, **without** `/chat/completions` |
| `LLM_API_KEY`        | `openai`     | –                              | optional, only if the endpoint requires auth           |
| `LMSTUDIO_URL`       | `lmstudio`   | `http://localhost:1234/v1`     | API root of the local LM Studio instance               |
| `LMSTUDIO_MODEL`     | `lmstudio`   | `local-model`                  | Model name in LM Studio                                |
| `LLM_MAX_TOKENS`     | all          | `8000` (`claude`), otherwise the endpoint default | Upper limit of the response length (positive integer; unusable values are ignored) |
| `LLM_CORRECTION_TURNS` | all        | `1`                            | Correction turns after the first call (`0`–`2`; unusable values are ignored) |
| `LLM_FORCE_JSON`     | `openrouter`, `openai`, `lmstudio` | on              | Sends `response_format` along (`json_schema`, strict, falling back to `json_object` on 400); `0` = off, for endpoints/models without `response_format` support. Affects **every** call — outline and entries — because every response is an object with its own schema; the `claude` path forces every response via a tool call and is unaffected |
| `LLM_PROMPT_CACHE`   | `openrouter`, `openai`, `lmstudio` | on for `openrouter`, otherwise off | Marks the constant part of the prompt as cacheable; `0` = off (for endpoints that reject content parts), `1` = on (e.g. your own Anthropic proxy). The `claude` path always caches and is unaffected |

`LLM_PROMPT_CACHE` is the cost lever of a chapter run: with the pipeline
(one call per scene) the same prompt prefix — system prompt, few-shot,
campaign knowledge, glossary, outline — repeats on every call. Marking it
means paying for it once instead of a dozen times; for a chapter that is
roughly 30 % of the cost. Whether the cache takes effect is shown in the
server line per run: `generate: openrouter, 14 attempt(s), 119000 in /
31000 out (98000 cached) — ok`. If `cached` is missing, the model (or the
routed provider) does not support cache breakpoints — then the marking
costs nothing, but gains nothing either.

`LLM_MAX_TOKENS` is worth it when comparing models: if a model cuts the
response off, the generator detects that from `finish_reason`/`stop_reason`
and aborts immediately with `422` and a message saying the model truncated
the response and to raise `LLM_MAX_TOKENS` (showing the current value) or
shorten the source text, instead of spinning two expensive correction turns;
then raise the limit or shorten the source text.

`LLM_CORRECTION_TURNS` controls how often a failed shape check goes back to
the model as a list of errors (default `1`): the triggers that cannot be
healed are gone (truncated responses abort immediately, a code fence or a
sentence around the object is tolerated, near-JSON in the outline is
repaired), and what remains, a model with an error list almost always
repairs in the first turn — a second one only costs. `0` switches correction
turns off entirely (cheapest, strictest mode), `2` is the maximum.

**Generations run in the background** ([decisions/generator](decisions/generator.md)): `POST
/api/campaigns/:campaign/generator-jobs` starts a job and responds with
`202` and the job; the app reads it via `GET
/api/campaigns/:campaign/generator-jobs`. One job per campaign (a second
start → `409` with the running job), and it stays, review edits included,
until it is accepted or discarded — navigation, a reload or a closed tab do
not cost a generation. The job is a row of the database: a finished one
survives a container restart and stays acceptable, a running one is
reported as failed.

If a required variable is missing, only the start of a run (`POST
/api/campaigns/:campaign/generator-jobs` or `POST …/augment`) responds with
`503` and a plain-text message in the `error` field naming the missing
variable (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, or `LLM_MODEL` with an
example value such as `anthropic/claude-sonnet-5`); the provider is
deliberately created per request. A typo in `LLM_PROVIDER` is caught the
same way instead of silently falling back to Claude: the message names the
unknown provider. The read and write API is not affected by any of this.

**Example OpenRouter** (one key, many models — handy for comparing):

```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-…
LLM_MODEL=anthropic/claude-sonnet-5
```

Switching models = change `LLM_MODEL` and restart the container. Grimoire
sends OpenRouter's optional attribution headers (`HTTP-Referer`,
`X-Title`) along; that is purely a label in their dashboard.

**Example LM Studio** (local, without a key — the container must reach the
host, under Docker Desktop e.g. `http://host.docker.internal:1234/v1`):

```bash
LLM_PROVIDER=lmstudio
LMSTUDIO_URL=http://host.docker.internal:1234/v1
LMSTUDIO_MODEL=qwen2.5-32b-instruct
```

`LLM_PROVIDER=openai` is the same transport for any other OpenAI-compatible
endpoint (vLLM, Ollama, LiteLLM, Azure proxy, …):
`LLM_BASE_URL` + `LLM_MODEL`, `LLM_API_KEY` only if needed.

No secrets in the image: `.env` is gitignored **and** in `.dockerignore`.
Pass them at runtime:

```bash
docker run --env-file /srv/grimoire/.env … grimoire
```

## 3. Reachability: Tailscale first

Grimoire has no login ([decisions/scope](decisions/scope.md)). It must therefore **not** be openly
reachable on the internet. Two proven patterns:

**A) Tailscale on the host (simplest way)**

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status
```

The app is then reachable via MagicDNS at
`https://<hostname>.<tailnet>.ts.net` — Tailscale obtains the TLS certificate
itself. Bind the container port to `127.0.0.1` (section 1).
No `tailscale funnel`; that would make the service public.

**B) Tailscale as a sidecar container**

For hosts without a Tailscale installation: a `tailscale/tailscale`
container with `TS_AUTHKEY` (auth key from the Tailscale admin console) and
`TS_SERVE_CONFIG` for HTTPS; Grimoire shares its network namespace
(`--network=container:tailscale`, in Compose `network_mode:
service:tailscale`). Then Grimoire itself publishes no port to the outside.
Put the sidecar's state (`/var/lib/tailscale`) in a volume, otherwise it
has to re-authenticate after every restart.

**Alternatives** (if Tailscale is not an option, [decisions/scope](decisions/scope.md), [decisions/stack](decisions/stack.md)):
a reverse proxy in front — Caddy/nginx/Traefik with basic auth for the
minimal case, or forward auth against Authelia/authentik if real sessions
and 2FA are wanted. In both cases the app code stays unchanged;
do not rebuild in-app auth.

## 4. Backup

**What gets backed up is the `GRIMOIRE_DATA` volume — see section 2a**, which
describes the procedure (`VACUUM INTO` while running, or stop the container
and copy the directory) and the restore.

## 5. Operations & troubleshooting

- Logs: `docker logs -f grimoire`. At startup the path of the database, the
  port, `Database ready (…)` and `Serving app build from /app/app/dist`
  appear. If it says
  `No app build at …` instead, `app/dist` is missing from the image (build
  stage failed) and the container serves only the API.
- Healthcheck: built in (`GET /api/campaigns`), visible via
  `docker inspect --format '{{.State.Health.Status}}' grimoire`.
- Refresh in the browser: every write increments `campaigns.version` in the
  same transaction, the app polls `GET /api/campaigns/:campaign/version`
  ([decisions/polling](decisions/polling.md)). There is no file watcher — edits in the file tree
  have NO effect; the database is the truth ([decisions/sqlite](decisions/sqlite.md)).
- Generator jobs survive a restart ([decisions/generator](decisions/generator.md)): a finished
  job is still there after the boot and acceptable. If a job was running,
  the log says `N generate job(s) were running at the last shutdown — marked
  as failed`, and the app says that the server was restarted during the run
  and the job should be started again. That is the expected message, not a
  defect.
- The new-version banner with its reload action: an open tab is still
  running an older bundle than the server (build ids from `GRIMOIRE_BUILD`
  differ, compared during the ongoing version polling) — the click does a
  hard reload; deliberately nothing happens automatically. Locally and in
  self-built images without `--build-arg GRIMOIRE_BUILD=…` both sides say
  `dev`, so the banner always stays off.
- Caching: `/assets/*` (hashed file names) is served `immutable`,
  `index.html` with `no-cache`. A deploy is therefore visible immediately,
  without the browser loading bundles twice.
- Development is unaffected by this: there the Vite dev server runs and
  proxies `/api` to `localhost:3000` (`app/vite.config.ts`); without
  `app/dist` the server serves nothing static.
- A runtime switch stays open ([decisions/stack](decisions/stack.md)): server/ and shared/ are in
  the image as TypeScript source, no Bun-only runtime APIs are used.
  A Node image with `@hono/node-server` would be a deployment rework, not a
  code rework.
