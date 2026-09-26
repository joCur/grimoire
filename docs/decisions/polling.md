# Client refresh via polling

## Decision

Changes become visible in the app without a manual reload. Every write
increments `campaigns.version` in the **same** transaction. The app polls
`GET /api/campaigns/:campaign/version` (response `{ version, build }`) and
invalidates its queries when `version` changes. The poll interval is purely
client-side.

`build` is the build id (`GRIMOIRE_BUILD`) that the release image burns into
bundle and server (`decisions/release`); if it differs from the loaded
bundle, the app shows the reload banner.

## Why

For a single user (`decisions/scope`) polling is enough. Because the version
rises in the same transaction as the change, a poll cannot see an increased
version without the corresponding change. SSE or WebSockets can be added
later without breaking the API; the version counter then remains valid as a
fallback.

## Consequences

- `campaigns.version` is a signal for refreshing, not a guard: writes check
  the `rev` of their row (`decisions/writes`).
- The app polls running generator jobs via their own resource
  (`decisions/generator`).
