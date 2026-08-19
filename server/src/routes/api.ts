// Read API routes (GitHub issue #2). Mounted under /api in server.ts.
// Response shapes are the contracts in @grimoire/shared (types.ts).

import { Hono } from "hono";
import { ApiError, buildTree, listCampaigns, readParsedFile } from "../campaign-fs";

export const api = new Hono();

// Map ApiError to a small JSON error body; anything else is a real 500.
api.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message }, err.status as 400 | 404);
  }
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});

// GET /api/campaigns -> CampaignSummary[]
api.get("/campaigns", async (c) => c.json(await listCampaigns()));

// GET /api/:campaign/tree -> CampaignTree
api.get("/:campaign/tree", async (c) => c.json(await buildTree(c.req.param("campaign"))));

// GET /api/:campaign/file?path=... -> FileResponse (ParsedFile + raw)
api.get("/:campaign/file", async (c) => {
  const rel = c.req.query("path");
  if (rel === undefined) throw new ApiError(400, "missing path query parameter");
  return c.json(await readParsedFile(c.req.param("campaign"), rel));
});
