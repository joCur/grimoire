// An ITEM PRICE — what one magic item costs, from Saidoro's "Sane Magic Item
// Prices" — its one zod schema (decisions/resources).
//
// Item prices are reference data of the instance, not of a campaign
// (decisions/reference-data): the same list serves every campaign, the
// migration that ships them is their only writer, and the DM looks them up
// without editing them. So there is no create, patch or delete form here.

import { z } from "zod";

/**
 * The guide's five lists, in the order the guide gives them: items used up
 * when used, items that make the user better at fighting, items that solve
 * problems another way, items that summon creatures, and items that change
 * the campaign world.
 */
export const ITEM_PRICE_LISTS = [
  "consumable",
  "combat",
  "noncombat",
  "summoning",
  "gamechanging",
] as const;

export const itemPriceListSchema = z.enum(ITEM_PRICE_LISTS);

export type ItemPriceList = z.infer<typeof itemPriceListSchema>;

/**
 * An item price, exactly as `GET /api/item-prices/:id` answers it: `id` its
 * stable key, `name` the item as the guide names it (English, as in the
 * guide), `priceGp` the price in gold pieces, `list` the guide's list it
 * stands in, `note` what the price counts where the guide says so ("each",
 * "per dose") and otherwise empty, and `rev` the row version.
 */
export const itemPriceSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  priceGp: z.number().int().nonnegative(),
  list: itemPriceListSchema,
  note: z.string(),
  rev: z.number(),
});

export type ItemPrice = z.infer<typeof itemPriceSchema>;

/** Where the prices come from — named on the page and next to every item. */
export const ITEM_PRICE_SOURCE = {
  author: "Saidoro",
  title: "Sane Magic Item Prices",
  url: "https://www.giantitp.com/forums/showthread.php?424243",
} as const;
