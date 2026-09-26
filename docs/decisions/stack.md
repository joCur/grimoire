# Tech stack

## Decision

**Frontend:** Vite + React 19 + Tailwind v4 + shadcn/ui. TanStack Query holds
server state (caching, refetch after mutation, 409 handling); local UI state
is plain React — no Zustand, no Redux. Markdown is rendered by react-markdown
with a custom remark plugin for `[!callout]` blocks and `## If:` headings. GFM
for tables only: `micromark-extension-gfm-table` and `mdast-util-gfm-table`
instead of `remark-gfm`. No Electron, no Tauri — a web app behind Tailscale is
enough.

**Backend:** Bun + Hono, SQLite via Drizzle (`server/src/db/`), search as an
FTS5 index (`decisions/sqlite`).

**Icons:** Lucide for UI chrome (consistent with shadcn); game-icons.net
(CC BY) for thematic markers (entity and callout types). The SVGs needed are
checked in as components of their own.

**Deployment:** one Docker container (Bun image) with a volume on
`GRIMOIRE_DATA`, reachable only via Tailscale. Details are in
[docs/DEPLOYMENT.md](../DEPLOYMENT.md).

### Monorepo with Bun workspaces

The repo is a Bun workspace monorepo of `shared/` (entity types,
`@grimoire/shared`), `server/` and `app/`. Server and frontend import the
same types; the data format is thus described in code exactly once
(`decisions/resources`). `shared/` is consumed as TypeScript source without a
build step — Bun and Vite handle that natively, under Node it runs via tsx.
The test runner is `bun test`.

### Node portability: Bun-only APIs only with an entry here

Hono runs unchanged on Bun and Node. Switching the runtime is a deployment
change, not a code rework, as long as no Bun-only API appears in runtime
code. Hence: **a Bun-only API requires an entry in this file.** The rule
covers runtime APIs; `bun test` as a dev tool does not fall under it.

Exactly one is registered:

- **`bun:sqlite` as a fallback behind `server/src/db/driver.ts`.** The driver
  uses `node:sqlite` where the runtime offers it, and `bun:sqlite` otherwise.
  Bun does not implement `node:sqlite` (checked with Bun 1.3.14, the version
  pinned in CI), and drizzle-orm 0.45.2 has no `node-sqlite` driver. On Node
  (≥ 22.16, because of `setReturnArrays`) the server thus runs without a
  native dependency; on Bun, the image's runtime, `bun:sqlite` runs. Both sit
  behind one interface with identical parameter and row handling.
  `server/test/db-smoke.test.ts` proves FTS5, transactions and UPSERT on both
  runtimes; the CI job `db-smoke-node` runs the same file on Node. If a driver
  drifts, that is the early warning. Should both fail, `better-sqlite3` behind
  the same interface would be the replacement; it is not implemented.

## Why

- Hono instead of Express or Fastify: minimal, type-safe, and it runs on Bun
  and Node.
- `remark-gfm` cannot be restricted to tables: task lists would turn a
  `- [ ]` in the DM's text into a control that writes nothing.
- A `shared/` package without a build step keeps server and app on the same
  type, with no generated copy that can go stale.

## Consequences

Bun/Hono is not a "small only" decision; the limits are named:

- **App-level auth:** first Forward Auth in the proxy, otherwise Hono
  middleware (`decisions/scope`).
- **More data, more complex queries:** SQLite is the source of truth
  (`decisions/sqlite`).
- **Bun-specific risk:** limited to the one registered coupling above.
- **Multi-user and permission requirements:** then the runtime is not the
  problem, but the data model and the auth model (`decisions/scope`).

New dependencies follow `decisions/dependencies`; only Bun-only APIs still
require an entry.
