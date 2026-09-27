// An ITEM-PRICE IMPORT — one of the DM's own item lists — its one zod schema
// (decisions/resources).
//
// The magic items of the books the DM owns may not ship with Grimoire, so the
// DM brings them into their own instance as a list in JSON: a name for the
// list and, per item, its name and rarity. Each item becomes an item price
// (./item-price.ts) of the instance (decisions/reference-data), priced by the
// list's own price or by the SRD's value for its rarity. An item the price
// list already holds keeps the price it has, so a guide price is never
// overridden. Importing a list of the same name again replaces its items.

import { z } from "zod";
import { itemRaritySchema } from "./item-price";

/**
 * One item of the list: its `name`, its `rarity`, whether it is used up when
 * used (`consumable`, then the rarity's value is halved), and optionally the
 * DM's own `priceGp` and a `note` on what the price counts ("each").
 */
export const itemPriceImportItemSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  rarity: itemRaritySchema,
  consumable: z.boolean().optional(),
  priceGp: z.number().int().nonnegative().optional(),
  note: z.string().trim().max(200).optional(),
});

export type ItemPriceImportItem = z.infer<typeof itemPriceImportItemSchema>;

/**
 * The list the DM imports, as the body of `PUT /api/item-price-imports/:id`:
 * its `name` (its id is the name's slug) and its `items`.
 */
export const itemPriceImportListSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  items: z.array(itemPriceImportItemSchema).min(1).max(5000),
});

export type ItemPriceImportList = z.infer<typeof itemPriceImportListSchema>;

/**
 * An import, exactly as `GET /api/item-price-imports/:id` answers it: `id` the
 * slug of its name, `name` as the list gives it, `itemCount` how many of its
 * items stand in the price list, `skipped` the names of the items it left
 * out because the price list already held them (in the list's order), and
 * `rev` the row version.
 */
export const itemPriceImportSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  itemCount: z.number().int().nonnegative(),
  skipped: z.array(z.string()),
  rev: z.number(),
});

export type ItemPriceImport = z.infer<typeof itemPriceImportSchema>;

/** The body of `DELETE /api/item-price-imports/:id`: the guard of the read. */
export const itemPriceImportDeleteSchema = z.strictObject({ rev: z.number() });

export type ItemPriceImportDelete = z.infer<typeof itemPriceImportDeleteSchema>;
