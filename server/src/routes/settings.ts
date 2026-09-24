// The instance settings: one settings object for the whole instance, read and
// written without a campaign.

import { Hono } from "hono";
import { readSettings, writeSettings } from "../store/settings";
import { jsonBody } from "./http";

export const settingsRoutes = new Hono();

// GET /api/settings -> InstanceSettings. Campaign-independent:
// the UI language belongs to the INSTANCE, and the app asks for it before it
// knows which campaign it is about to open (the cold start has none).
settingsRoutes.get("/settings", async (c) => c.json(await readSettings()));

// PUT /api/settings { locale } -> InstanceSettings. `null` clears the setting
// (back to "follow the browser"); anything but de/en/null is a 400.
// Stored in the `meta` table under `setting:locale` — no table of its own for
// one user with one settings object, and deliberately not localStorage: the
// language is server state (quality floor).
settingsRoutes.put("/settings", async (c) => {
  const body = await jsonBody(c, ["locale"]);
  return c.json(await writeSettings(body));
});
