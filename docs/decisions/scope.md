# Scope: a tool for one game master

## Decision

Grimoire is a self-hosted single-user tool for a D&D game master: session
preparation and live running of the game on top of a campaign database. It is
not a VTT, not a campaign wiki, and has no player view.

- **No sync with the virtual tabletop.** Grimoire holds what only the DM sees;
  the tabletop holds what players see and touch. The bridge between them is
  one-directional and manual.
- **Access control sits in front of the app, not in it.** There is no account
  system; protecting the instance is a deployment concern (private network or
  authentication in the reverse proxy). The app itself is auth-agnostic.

## Why

The split from the tabletop follows visibility: what players see lives where
the players are. A two-way sync would need conflict resolution and format
conversion against a platform without a suitable API.

For a single user an account system is effort without benefit; a proxy in
front protects just as well and costs no app code.

## Consequences

- All writes go through the server, and there is no persistent browser state
  for data: the server is the truth.
- If app-side authentication becomes necessary, the first check is whether
  proxy authentication suffices; otherwise it is a middleware layer, not a
  rework.
- Real multi-user or permission requirements affect the data model and the
  auth model; at that point the decision is made anew instead of bolted on.
