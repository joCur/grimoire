// The glossary: term and explanation, read and written as a whole list.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import { readGlossary, writeGlossary } from "../store/glossary";
import { isPlainObject, jsonBody, requireRev } from "./http";

export const glossaryRoutes = new Hono();

// GET /api/campaigns/:campaign/glossary -> { entries: [{ term, explanation }], rev }
// The glossary is a structured TABLE: term → explanation, one row each, and
// this is the ONE way to read it (ADR #26) — the generator knowledge base
// builds on exactly these rows. `rev` is the LIST's guard token, the one
// PUT /glossary checks; it counts only the glossary's own writes, so an
// unrelated write during a session cannot invalidate an open edit.
glossaryRoutes.get("/campaigns/:campaign/glossary", async (c) => c.json(await readGlossary(c.req.param("campaign"))));

// PUT /api/campaigns/:campaign/glossary { entries: [{ term, explanation }], rev }
//   -> { entries, rev }
// Replaces the WHOLE list — the glossary is a short, hand-curated table that
// is edited as a whole, and that is also what makes REORDERING an ordinary
// save: the array order is the stored order, so there is no
// separate move endpoint. Of duplicate terms the FIRST one wins. `rev` is
// the list's guard token (the one GET /glossary hands out); a stale one is
// 409 { code: "rev_conflict", rev } and writes nothing. No `entry` rides
// along — the glossary is not one (ADR #26), and the glossary page reloads
// the list itself.
//
// This is the ONLY way the glossary is written: it has no address, so there
// is no entry PATCH that could reach it.
glossaryRoutes.put("/campaigns/:campaign/glossary", async (c) => {
  const body = await jsonBody(c, ["entries", "rev"]);
  const raw = body.entries;
  if (!Array.isArray(raw)) throw new ApiError(400, "entries must be an array");
  const entries: Array<{ term: string; explanation: string }> = [];
  for (const item of raw) {
    if (!isPlainObject(item)) throw new ApiError(400, "each entry must be an object");
    if (typeof item.term !== "string" || item.term.trim() === "") {
      throw new ApiError(400, "each entry needs a non-empty term");
    }
    if (item.explanation !== undefined && typeof item.explanation !== "string") {
      throw new ApiError(400, "explanation must be a string");
    }
    // NO single-line rule here, unlike the knowledge list (./knowledge.ts): a
    // glossary explanation may span several lines (the example campaign has
    // one), so a 400 would make such a glossary unsavable. `promptInline`
    // (store/knowledge.ts) flattens them for the prompt instead — the defence
    // that does not lose data.
    entries.push({ term: item.term, explanation: item.explanation ?? "" });
  }
  return c.json(await writeGlossary(c.req.param("campaign"), entries, requireRev(body.rev)));
});
