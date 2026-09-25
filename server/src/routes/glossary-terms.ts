// The glossary terms: list, read, create, write and delete.
//
// A GLOSSARY TERM IS ITS OWN RESOURCE (ADR #31): `…/glossary-terms` and
// `…/glossary-terms/:id`, answering the `GlossaryTerm` type —
// `{ id, term, explanation, rev }`. Every term carries its own guard, and a
// term stands in the glossary once. Terms stand in the order they were
// created; there is no order to write. The glossary page shows them sorted by
// term, and the prose above them is a field of the campaign
// (`glossaryIntro`, `PATCH /api/campaigns/:campaign`).

import { Hono } from "hono";
import { ApiError } from "../api-error";
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  listGlossaryTerms,
  patchGlossaryTerm,
  readGlossaryTerm,
  readGlossaryTermCreate,
  readGlossaryTermDelete,
  readGlossaryTermPatch,
} from "../store/glossary-terms";
import { jsonBody } from "./http";

export const glossaryTermRoutes = new Hono();

/**
 * A term is stored trimmed, and an empty one is a 400. Its explanation keeps
 * its lines: an explanation may span several (the example campaign has one),
 * and the prompt flattens it instead (store/knowledge-items.ts
 * `promptInline`).
 */
function termText(value: string): string {
  const term = value.trim();
  if (term === "") throw new ApiError(400, "term must be a non-empty string");
  return term;
}

// GET /api/campaigns/:campaign/glossary-terms -> GlossaryTerm[]
// Every term of the campaign in the order it was created. No terms answers an
// empty list (200).
glossaryTermRoutes.get("/campaigns/:campaign/glossary-terms", async (c) =>
  c.json(await listGlossaryTerms(c.req.param("campaign"))),
);

// GET /api/campaigns/:campaign/glossary-terms/:id -> GlossaryTerm
// `{ id, term, explanation, rev }`. 404 for an unknown campaign or term.
glossaryTermRoutes.get("/campaigns/:campaign/glossary-terms/:id", async (c) =>
  c.json(await readGlossaryTerm(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/glossary-terms { term, explanation? }
//   -> 201 GlossaryTerm
// A new term at the end; the id is the server's. `term` is trimmed, empty is
// 400; a term the glossary already has is 409 { code: "glossary_term_taken",
// term } and writes nothing. A key that is neither field, or a value of the
// wrong shape, is a 400 that names it. No `rev`: a new term overwrites
// nothing.
glossaryTermRoutes.post("/campaigns/:campaign/glossary-terms", async (c) => {
  const request = readGlossaryTermCreate(await jsonBody(c, null));
  const term = await createGlossaryTerm(c.req.param("campaign"), {
    ...request,
    term: termText(request.term),
  });
  return c.json(term, 201);
});

// PATCH /api/campaigns/:campaign/glossary-terms/:id
//   { rev, force?, id?, term?, explanation? } -> GlossaryTerm
// Rewords ONE term or its explanation: any subset of its fields in one row
// update against its `rev`, checked against the term's schema. A key that is
// not a field of a term, or a value of the wrong shape, is a 400 that names
// it; `term` follows the create's rule, and a term another one already reads
// is 409 { code: "glossary_term_taken", term }. Naming no field is 400
// { code: "nothing_to_write" }. The `id` may be echoed, never changed.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, glossaryTerm } and writes
// nothing — `glossaryTerm` is the term as it stands now. `force: true` writes
// the given fields on top of it instead. 404 for an unknown campaign or term.
glossaryTermRoutes.patch("/campaigns/:campaign/glossary-terms/:id", async (c) => {
  const patch = readGlossaryTermPatch(await jsonBody(c, null));
  return c.json(
    await patchGlossaryTerm(c.req.param("campaign"), c.req.param("id"), {
      ...patch,
      ...(patch.term === undefined ? {} : { term: termText(patch.term) }),
    }),
  );
});

// DELETE /api/campaigns/:campaign/glossary-terms/:id { rev } -> 204
// Removes ONE term, and with it its search hit. A stale `rev` is 409 { code:
// "rev_conflict", rev, glossaryTerm } and removes nothing. 404 for an unknown
// campaign or term.
glossaryTermRoutes.delete("/campaigns/:campaign/glossary-terms/:id", async (c) => {
  const request = readGlossaryTermDelete(await jsonBody(c, null));
  await deleteGlossaryTerm(c.req.param("campaign"), c.req.param("id"), request);
  return c.body(null, 204);
});
