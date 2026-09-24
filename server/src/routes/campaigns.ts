// The campaigns: the list of them, the one create that lives outside a
// campaign, the campaign entry itself, its tree and its version poll.

import { Hono } from "hono";
import { getBuildId } from "../config";
import { campaignVersion, createCampaign, listCampaigns } from "../store/campaigns";
import { buildTree } from "../store/chapters";
import { readEntry } from "../store/entries";
import { jsonBody, optionalText, requiredText } from "./http";

export const campaignRoutes = new Hono();

// GET /api/campaigns -> CampaignSummary[]
campaignRoutes.get("/campaigns", async (c) => c.json(await listCampaigns()));

// POST /api/campaigns { name, description? } -> 201 CampaignSummary
// The cold start (an empty instance is the normal first boot):
// this is the only create that does not live under a campaign.
campaignRoutes.post("/campaigns", async (c) => {
  const body = await jsonBody(c, ["name", "description", "id"]);
  const name = requiredText(body.name, "name");
  const description = optionalText(body.description, "description");
  return c.json(await createCampaign(name, description, optionalText(body.id, "id")), 201);
});

// GET /api/campaigns/:campaign -> EntryResponse of the campaign entry.
// The campaign's own address is `campaign`, so this is the shorter spelling of
// GET /campaigns/:campaign/entries/campaign and answers exactly the same body.
campaignRoutes.get("/campaigns/:campaign", async (c) =>
  c.json(await readEntry(c.req.param("campaign"), "campaign")),
);

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
