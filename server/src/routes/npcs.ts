// The npcs: creating one.

import { Hono } from "hono";
import { createNpc } from "../store/npcs";
import { jsonBody, optionalText, requiredText } from "./http";

export const npcRoutes = new Hono();

// POST /api/campaigns/:campaign/npcs { name } -> 201 EntryResponse
// An EMPTY entry for the derived id — one the DM created and left empty — is
// FILLED instead of colliding; an entry with content answers 409. A RESERVED
// id answers 409 { code: "slug_reserved" } — same shape, different
// sentence.
npcRoutes.post("/campaigns/:campaign/npcs", async (c) => {
  const body = await jsonBody(c, ["name", "id"]);
  const name = requiredText(body.name, "name");
  return c.json(
    await createNpc(c.req.param("campaign"), name, optionalText(body.id, "id")),
    201,
  );
});
