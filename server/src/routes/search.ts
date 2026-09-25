// The search: one full-text query over a campaign.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import { requireCampaign } from "../store/campaigns";
import { searchCampaign } from "../store/search";

export const searchRoutes = new Hono();

// GET /api/campaigns/:campaign/search?q=... -> { results: SearchResult[] } (max 20)
// Full-text search over the FTS5 index: scenes, npcs, locations,
// chapters, the campaign and the GLOSSARY, ranked by bm25 with the
// index's own column weights. Every token is a prefix term, so a half-typed
// palette query still matches, and the tokenizer folds diacritics ("leucht"
// finds "Leuchtturm").
searchRoutes.get("/campaigns/:campaign/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (q === undefined || q === "") throw new ApiError(400, "missing q query parameter");
  const campaign = c.req.param("campaign");
  await requireCampaign(campaign); // 400 unsafe id, 404 unknown campaign
  return c.json({ results: await searchCampaign(campaign, q) });
});
