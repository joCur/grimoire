// A KNOWLEDGE ITEM — one rule of the campaign knowledge the generator has to
// apply even where the source material says otherwise — its one zod schema
// and the forms derived from it (ADR #31).
//
// `knowledgeItemSchema` is the item as
// `GET /api/campaigns/:c/knowledge-items/:id` answers it. The TypeScript type,
// the POST and the PATCH the resource accepts, and the item a fixture holds
// are each derived from it below with zod's own API.
//
// The ORDER of the items is the order of the generator prompt, and the DM
// sets it: it is no field of an item but the campaign's knowledge-item order,
// written on its own endpoint with its own guard
// (`PUT /api/campaigns/:c/knowledge-item-order`, `knowledgeItemOrderSchema`).

import { z } from "zod";

/**
 * The three kinds of knowledge item:
 *
 *   naming  a NAMING CONVENTION — `from` is the spelling the source material
 *           uses, `to` the one this campaign uses. The only kind the server
 *           can CHECK after a run, which is why it is a pair and not prose.
 *   fact    a campaign fact that outranks the source material.
 *   style   a style rule for the generated prose.
 *
 * `fact` and `style` carry `text`; `naming` carries `from` + `to`. The unused
 * fields are empty strings rather than absent — one row shape, and a kind
 * switched in the UI keeps what was already typed instead of dropping it.
 */
export const KNOWLEDGE_KINDS = ["naming", "fact", "style"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export function isKnowledgeKind(value: unknown): value is KnowledgeKind {
  return typeof value === "string" && (KNOWLEDGE_KINDS as readonly string[]).includes(value);
}

/**
 * A knowledge item, exactly as `GET /api/campaigns/:c/knowledge-items/:id`
 * answers it: `id` its stable key — an opaque id the server hands out —,
 * `kind` which rule it is, `from`/`to` the two spellings of a naming
 * convention, `text` the sentence of a fact or a style rule, and `rev` the
 * row version a PATCH or a DELETE sends back as its guard.
 */
export const knowledgeItemSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(KNOWLEDGE_KINDS),
  from: z.string(),
  to: z.string(),
  text: z.string(),
  rev: z.number(),
});

export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;

/**
 * An item without its guard: what a fixture holds
 * (`fixtures/<campaign>/knowledge-items/<id>.json`) and the seed writes.
 */
export const knowledgeItemSeedSchema = knowledgeItemSchema.omit({ rev: true });

export type KnowledgeItemSeed = z.infer<typeof knowledgeItemSeedSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/knowledge-items/:id`: the guard, the
 * optional `force`, and any subset of the fields. The id may be echoed, never
 * changed. Strict like the schema it comes from: a key that is none of these
 * is a 400 naming it.
 */
export const knowledgeItemPatchSchema = knowledgeItemSeedSchema
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional() });

export type KnowledgeItemPatch = z.infer<typeof knowledgeItemPatchSchema>;

/** The fields of one item write, guard and `force` aside — what an editing surface builds. */
export const knowledgeItemChangeSchema = knowledgeItemPatchSchema.omit({ rev: true, force: true });

export type KnowledgeItemChange = z.infer<typeof knowledgeItemChangeSchema>;

/**
 * The body of `DELETE /api/campaigns/:c/knowledge-items/:id`: the guard the
 * item was read with.
 */
export const knowledgeItemDeleteSchema = knowledgeItemSchema.pick({ rev: true });

export type KnowledgeItemDelete = z.infer<typeof knowledgeItemDeleteSchema>;

/**
 * The body of `POST /api/campaigns/:c/knowledge-items`: the kind and the
 * fields the DM filled in; a field left out is empty. A new item stands at
 * the end of the order.
 */
export const knowledgeItemCreateSchema = knowledgeItemSeedSchema
  .omit({ id: true })
  .partial({ from: true, to: true, text: true });

export type KnowledgeItemCreate = z.infer<typeof knowledgeItemCreateSchema>;

/**
 * The ORDER of the campaign's knowledge items, as
 * `GET`/`PUT /api/campaigns/:c/knowledge-item-order` answers and takes it:
 * `items` every item id of the campaign in the order of the prompt, and `rev`
 * the order's own guard — no item's `rev`, so reordering never turns an open
 * item into a conflict.
 */
export const knowledgeItemOrderSchema = z.strictObject({
  items: z.array(z.string()),
  rev: z.number(),
});

export type KnowledgeItemOrder = z.infer<typeof knowledgeItemOrderSchema>;
