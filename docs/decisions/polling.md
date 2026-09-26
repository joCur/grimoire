# Client refresh via polling

## Decision

Changes become visible in the app without a manual reload. Every write
increments a version counter of its campaign in the same transaction; the
app polls that counter and invalidates its queries when it changes. The
poll response also carries the server's build id, and when it differs from
the loaded bundle, the app offers a reload.

## Why

For a single user (`decisions/scope`) polling is enough. Because the counter
rises in the same transaction as the change, a poll cannot see a new version
without the change behind it. Server push can be added later without
breaking the API; the counter then remains a fallback.

## Consequences

- The counter is a refresh signal, not a guard: writes check the `rev` of
  their row (`decisions/writes`).
- The build id changes only with a release (`decisions/release`), so the
  reload offer appears only on a real version change.
