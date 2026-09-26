# Scope: a tool for one game master

## Decision

Grimoire is a self-hosted single-user tool for a D&D game master: session
preparation and live running of the game on top of a campaign database. It is
not a VTT, not a campaign wiki, and has no player view.

### No Roll20 sync

Grimoire holds what only the DM sees: read-alouds, notes, secrets, logs.
Roll20 holds what players see and touch: maps, tokens, player handouts, stat
blocks. The bridge is unidirectional and manual (copy button, handout
references by name). There is no bidirectional sync.

### Access control in front of the app, not in the app

There is no account system. Access control is a deployment decision:
Tailscale by default, alternatively Basic Auth or Forward Auth (Authelia,
authentik) in the reverse proxy. The app itself is auth-agnostic. The only
consequence inside the app: all writes go through the server, and there is no
persistent browser state.

## Why

The split from Roll20 follows visibility: what players see lives where the
players are. A bidirectional sync would need conflict resolution, a
conversion between HTML and Markdown, and an official REST API, which Roll20
does not have.

For a single user an account system is effort without benefit; a proxy in
front protects just as well and costs no app code.

## Consequences

- If app-side authentication does become necessary, the first check is
  whether Forward Auth in the proxy suffices; it also covers access from
  other devices. Otherwise it is a middleware layer in Hono (Basic Auth, JWT,
  sessions), not a rework.
- Real multi-user or permission requirements affect the data model and the
  auth model; at that point the decision is made anew instead of bolted on.
- No localStorage for data: the server is the truth.
