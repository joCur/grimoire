# Tech stack

## Decision

- **Frontend:** Vite + React + Tailwind + shadcn/ui. TanStack Query holds
  server state; local UI state is plain React, without a state library.
  Markdown is rendered by react-markdown with a custom remark plugin for the
  body vocabulary (README.md). Of GFM only tables are enabled.
- **Backend:** Bun + Hono, SQLite via Drizzle (`decisions/sqlite`).
- **Icons:** Lucide for UI chrome; game-icons.net for thematic markers,
  checked in as components.
- **Deployment:** one container with a data volume, reachable only through a
  private network ([docs/DEPLOYMENT.md](../DEPLOYMENT.md)). No desktop shell.
- **Monorepo:** a Bun workspace of `shared/` (entity schemas and types),
  `server/` and `app/`. Server and app import the same types; `shared/` is
  consumed as TypeScript source without a build step.

### Node portability: Bun-only APIs are registered here

Runtime code stays portable to Node, so that switching the runtime is a
deployment change, not a rework. **A Bun-only runtime API requires an entry
in this file.** Dev tooling such as the test runner is not covered.

Registered:

- **`bun:sqlite`, as the fallback of the database driver.** The driver uses
  `node:sqlite` where the runtime offers it and `bun:sqlite` otherwise, both
  behind one interface with identical behavior, proven on both runtimes in CI.

## Why

- Hono: minimal, type-safe, and it runs unchanged on Bun and Node.
- Full GFM would turn task-list syntax in the DM's text into controls that
  write nothing; tables are the only extension the text needs.
- A shared package without a build step keeps server and app on one type,
  with no generated copy that can go stale.
- A web app behind a private network covers every device the DM uses; a
  desktop shell would add packaging without benefit.

## Consequences

- The Bun-specific risk is limited to the registered couplings.
- The growth limits lie elsewhere: auth (`decisions/scope`), data volume
  (`decisions/sqlite`), multi-user (the data model, not the runtime).
- New dependencies follow `decisions/dependencies`; only Bun-only APIs
  require an entry.
