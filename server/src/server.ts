// Grimoire server — Hono app.
// Runs on Bun (bun run src/server.ts). No Bun-only runtime APIs are used
// (DECISIONS #5/#7): Bun picks up the default { port, fetch } export below;
// on Node >= 20 the same app runs via @hono/node-server instead:
//   import { serve } from "@hono/node-server"; serve({ fetch: app.fetch, port: PORT });
//
// Planned API — the living checklist (conventions: /README.md). Tick an
// endpoint here when it is implemented:
//
//   [x] GET  /api/campaigns                    campaign list (directories)
//   [x] GET  /api/:campaign/tree               scenes/npcs/locations/sessions as a tree (frontmatter parsed)
//   [x] GET  /api/:campaign/file?path=...      one file (raw + parsed + mtime)
//   [x] PATCH /api/:campaign/frontmatter       { path, mtimeMs, patch } — only if
//                                              mtimeMs is unchanged, otherwise 409
//   [x] POST /api/:campaign/session/start      creates sessions/<today>.md
//   [x] POST /api/:campaign/session/end        sets `ended`
//   [x] POST /api/:campaign/log                { text, sceneId? } -> append with timestamp
//   [x] POST /api/:campaign/inbox              { text } -> append to inbox.md
//   [ ] POST /api/:campaign/generate           { chapter, sourceText } -> GenerateResult
//                                              (review preview; writes NOTHING)
//   [ ] POST /api/:campaign/generate/apply     { scenes, stubs } -> writes drafts
//
// Validation after generate: frontmatter parseable, status==draft, references
// exist or ship as stubs, only known callouts. Errors -> correction turn to
// the LLM (max 2), see generator/README.md.
//
// The LLM provider (./llm-provider) is created lazily when the generate
// endpoints land — instantiating it at boot would require an API key even
// for the read-only API.

import { Hono } from "hono";
import { getCampaignRoot, PORT } from "./config";
import { api } from "./routes/api";

export const app = new Hono();
app.route("/api", api);

console.log(`Grimoire server — campaigns: ${getCampaignRoot()}, port: ${PORT}`);

// Bun serves this automatically when the file is the entrypoint; the app
// object itself stays runtime-neutral (see Node alternative above).
export default {
  port: PORT,
  fetch: app.fetch,
};
