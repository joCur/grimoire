// The knowledge items: list, read, create, write, delete — and their order.
//
// A KNOWLEDGE ITEM IS ITS OWN RESOURCE (ADR #31): `…/knowledge-items` and
// `…/knowledge-items/:id`, answering the `KnowledgeItem` type —
// `{ id, kind, from, to, text, rev }`: a naming convention ("write <from> as
// <to>"), a fact or a style rule that outranks the source material. Its own
// entity next to the glossary term because it answers a different question:
// a glossary term translates a term, an item here overrides the source.
//
// The items stand in an ORDER the DM sets — the order of the prompt — and
// `…/knowledge-item-order` writes it, with a guard of its own.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  listKnowledgeItems,
  patchKnowledgeItem,
  readKnowledgeItem,
  readKnowledgeItemCreate,
  readKnowledgeItemDelete,
  readKnowledgeItemOrder,
  readKnowledgeItemOrderRequest,
  readKnowledgeItemPatch,
  writeKnowledgeItemOrder,
} from "../store/knowledge-items";
import { jsonBody } from "./http";

export const knowledgeItemRoutes = new Hono();

/**
 * The text fields of an item must be SINGLE LINE (400 otherwise).
 *
 * An item feeds the generator prompt, where it becomes one bullet in markdown
 * the model reads as INSTRUCTIONS (store/knowledge-items.ts knowledgeText). A
 * newline inside an item is therefore not a formatting detail: it lets an
 * item open lines of its own — a `## ` heading that poses as a section of the
 * prompt, for instance. The UI has single-line inputs and cannot produce
 * one, so refusing it costs the DM nothing and closes the door for every
 * other client. The prompt assembly stays defensive as well (`promptInline`)
 * — this is the validator, not the only line of defence.
 */
function assertSingleLine(fields: { from?: string; to?: string; text?: string }): void {
  for (const key of ["from", "to", "text"] as const) {
    if (/[\r\n]/u.test(fields[key] ?? "")) throw new ApiError(400, `${key} must be a single line`);
  }
}

// GET /api/campaigns/:campaign/knowledge-items -> KnowledgeItem[]
// Every item of the campaign in its order — the order of the prompt. No items
// answers an empty list (200).
knowledgeItemRoutes.get("/campaigns/:campaign/knowledge-items", async (c) =>
  c.json(await listKnowledgeItems(c.req.param("campaign"))),
);

// GET /api/campaigns/:campaign/knowledge-items/:id -> KnowledgeItem
// `{ id, kind, from, to, text, rev }`. 404 for an unknown campaign or item.
knowledgeItemRoutes.get("/campaigns/:campaign/knowledge-items/:id", async (c) =>
  c.json(await readKnowledgeItem(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/knowledge-items { kind, from?, to?, text? }
//   -> 201 KnowledgeItem
// A new item at the end of the order; the id is the server's, and a field
// left out is empty. `kind` is one of `naming`, `fact`, `style`; a key that is
// none of the fields, or a value of the wrong shape, is a 400 that names it,
// and so is a field with a line break in it. No `rev`: a new item overwrites
// nothing — but the order's guard moves, because the order gained an item.
//
// A `naming` item's pair may be HALF-FILLED on purpose — that is a convention
// the DM has not finished typing, and the prompt skips it
// (store/knowledge-items.ts knowledgeText).
knowledgeItemRoutes.post("/campaigns/:campaign/knowledge-items", async (c) => {
  const request = readKnowledgeItemCreate(await jsonBody(c, null));
  assertSingleLine(request);
  return c.json(await createKnowledgeItem(c.req.param("campaign"), request), 201);
});

// PATCH /api/campaigns/:campaign/knowledge-items/:id
//   { rev, force?, id?, kind?, from?, to?, text? } -> KnowledgeItem
// Changes ONE item: any subset of its fields in one row update against its
// `rev`, checked against the item's schema, with the create's single-line
// rule. A key that is not a field of an item, or a value of the wrong shape,
// is a 400 that names it. Naming no field is 400 { code: "nothing_to_write" }.
// The `id` may be echoed, never changed, and the order does not move.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, knowledgeItem } and
// writes nothing — `knowledgeItem` is the item as it stands now.
// `force: true` writes the given fields on top of it instead. 404 for an
// unknown campaign or item.
knowledgeItemRoutes.patch("/campaigns/:campaign/knowledge-items/:id", async (c) => {
  const patch = readKnowledgeItemPatch(await jsonBody(c, null));
  assertSingleLine(patch);
  return c.json(await patchKnowledgeItem(c.req.param("campaign"), c.req.param("id"), patch));
});

// DELETE /api/campaigns/:campaign/knowledge-items/:id { rev } -> 204
// Removes ONE item; the order loses it and its guard moves. A stale `rev` is
// 409 { code: "rev_conflict", rev, knowledgeItem } and removes nothing. 404
// for an unknown campaign or item.
knowledgeItemRoutes.delete("/campaigns/:campaign/knowledge-items/:id", async (c) => {
  const request = readKnowledgeItemDelete(await jsonBody(c, null));
  await deleteKnowledgeItem(c.req.param("campaign"), c.req.param("id"), request);
  return c.body(null, 204);
});

// GET /api/campaigns/:campaign/knowledge-item-order -> { items, rev }
// The order of the campaign's knowledge items: every item id in the order of
// the prompt, and the ORDER's own guard (`campaigns.knowledge_item_order_rev`).
knowledgeItemRoutes.get("/campaigns/:campaign/knowledge-item-order", async (c) =>
  c.json(await readKnowledgeItemOrder(c.req.param("campaign"))),
);

// PUT /api/campaigns/:campaign/knowledge-item-order { items, rev }
//   -> { items, rev }
// The order written as a whole: the array IS the order, and there is no
// per-item "move", because moving one item changes where its neighbours stand
// too. `items` must name every item of the campaign exactly once — anything
// else is a 400 and writes nothing.
//
// `rev` is the ORDER's own guard, and the answer carries the fresh one. A
// stale one is 409 { code: "rev_conflict", rev, knowledgeItemOrder } and
// writes nothing — `knowledgeItemOrder` is the order as it stands now. No
// item's `rev` moves: reordering the list around an open item is no conflict
// for it.
knowledgeItemRoutes.put("/campaigns/:campaign/knowledge-item-order", async (c) => {
  const request = readKnowledgeItemOrderRequest(await jsonBody(c, null));
  return c.json(await writeKnowledgeItemOrder(c.req.param("campaign"), request));
});
