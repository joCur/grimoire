// The campaigns: the list of them, the one create that lives outside a
// campaign, the campaign itself, its tree and its version poll.
//
// THE CAMPAIGN IS ITS OWN RESOURCE (ADR #31): `/campaigns/:c`, answering the
// `Campaign` type — every field of the campaign flat, `body` among them,
// beside its `rev`. The list answers `CampaignSummary`, the campaign's name
// beside its newest session, and the tree is a shape of its own that shows
// several entities.

import { Hono } from "hono";
import { campaignCreateSchema } from "@grimoire/shared";
import { getBuildId } from "../config";
import {
  campaignVersion,
  createCampaign,
  listCampaigns,
  patchCampaign,
  readCampaign,
} from "../store/campaigns";
import { buildTree } from "../store/chapters";
import { parseRequest } from "../store/shared";
import { jsonBody, optionalText, requiredText } from "./http";

export const campaignRoutes = new Hono();

// GET /api/campaigns -> CampaignSummary[]
campaignRoutes.get("/campaigns", async (c) => c.json(await listCampaigns()));

// POST /api/campaigns { name, description?, id? } -> 201 Campaign
// The cold start (an empty instance is the normal first boot): this is the
// only create that does not live under a campaign. The id is derived from
// `name` unless the request sets it; a blank description is none. A taken id
// is 409 { code: "slug_taken", kind, id, suggestion } and writes nothing. A
// key that is none of the three, or a value of the wrong shape, is a 400 that
// names it.
campaignRoutes.post("/campaigns", async (c) => {
  const request = parseRequest(campaignCreateSchema, await jsonBody(c, null), "campaign");
  const name = requiredText(request.name, "name");
  const description = optionalText(request.description, "description");
  return c.json(await createCampaign(name, description, optionalText(request.id, "id")), 201);
});

// GET /api/campaigns/:campaign -> Campaign
// `{ id, name, description?, body, rev }` — every field of the campaign flat,
// the description absent when the campaign carries none, the name its id
// when it has none of its own, and `rev` the guard its PATCH sends back. 404
// for an unknown campaign.
campaignRoutes.get("/campaigns/:campaign", async (c) =>
  c.json(await readCampaign(c.req.param("campaign"))),
);

// PATCH /api/campaigns/:campaign { rev, force?, id?, name?, description?, body? }
//   -> Campaign
// THE write of the campaign (ADR #23): any subset of its fields — `body` is
// one of them — in ONE row update against ONE `rev`, checked against the
// campaign's schema. `null` clears the description; a key that is not a field
// of a campaign, or a value of the wrong shape, is a 400 that names it. A
// request that names no field is 400 { code: "nothing_to_write" }. The `id`
// may be echoed, never changed (400).
//
// A stale `rev` is 409 { code: "rev_conflict", rev, campaign } and writes
// nothing — `campaign` is the campaign as it stands now. `force: true` writes
// the given fields on top of that current row instead: only what this
// request carries is written. 404 for an unknown campaign.
campaignRoutes.patch("/campaigns/:campaign", async (c) => {
  const body = await jsonBody(c, null);
  return c.json(await patchCampaign(c.req.param("campaign"), body));
});

// GET /api/campaigns/:campaign/tree -> CampaignTree
campaignRoutes.get("/campaigns/:campaign/tree", async (c) => c.json(await buildTree(c.req.param("campaign"))));

// GET /api/campaigns/:campaign/version -> { version, build } — `version` is
// `campaigns.version`, bumped by every write in the SAME transaction as the
// change it belongs to — the database is the only truth (ADR #13), so a
// write is the only thing that can move it. The app polls this and refetches
// when it changes (DECISIONS #9). `build` rides
// along on that existing poll: the app compares it with its own
// build id and offers a reload when a deploy left it with a stale bundle.
// Every /api response carries the same value as `x-grimoire-build`.
campaignRoutes.get("/campaigns/:campaign/version", async (c) => {
  const campaign = c.req.param("campaign");
  return c.json({ version: await campaignVersion(campaign), build: getBuildId() });
});
