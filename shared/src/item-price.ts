// An ITEM PRICE — what one magic item costs — its one zod schema
// (decisions/resources).
//
// Two shipped sources price the items: Saidoro's "Sane Magic Item Prices",
// which prices each item on its own, and, for the items the guide has no price
// for, the SRD 5.2's value for the item's rarity. Beside them stand the items
// of the DM's own item lists (./item-price-import.ts), priced by the list's own
// price or by the SRD's value for their rarity. Item prices are reference data
// of the instance, not of a campaign (decisions/reference-data): the same list
// serves every campaign, and the DM looks them up without editing them. The
// migration writes the shipped rows and an import writes its own, so there is
// no create, patch or delete form here.

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

/** The rarities an SRD price stands for, from the cheapest. */
export const ITEM_RARITIES = ["common", "uncommon", "rare", "very-rare", "legendary"] as const;

export const itemRaritySchema = z.enum(ITEM_RARITIES);

export type ItemRarity = z.infer<typeof itemRaritySchema>;

/**
 * What an item's rarity is worth by the SRD 5.2, in gold pieces. A consumable
 * is worth half of it.
 */
export const ITEM_RARITY_VALUE_GP: Record<ItemRarity, number> = {
  common: 100,
  uncommon: 400,
  rare: 4000,
  "very-rare": 40000,
  legendary: 200000,
};

/** The SRD's value of an item of `rarity`: half of it for a consumable. */
export function rarityValueGp(rarity: ItemRarity, consumable: boolean): number {
  const value = ITEM_RARITY_VALUE_GP[rarity];
  return consumable ? value / 2 : value;
}

/**
 * Where a price comes from: Saidoro's guide, the SRD's rarity value, or the
 * price the DM's own item list gives.
 */
export const ITEM_PRICE_SOURCES = ["saidoro", "srd", "import"] as const;

export const itemPriceSourceSchema = z.enum(ITEM_PRICE_SOURCES);

export type ItemPriceSource = z.infer<typeof itemPriceSourceSchema>;

/**
 * An item price, exactly as `GET /api/item-prices/:id` answers it: `id` its
 * stable key, `name` the item as its source names it, `priceGp` the price in
 * gold pieces, `source` where the price comes from, `list` the guide's list
 * for a guide price and null otherwise, `rarity` the item's rarity where its
 * source names one (every SRD and every imported item) and null for a guide
 * price, `note` what the price counts where the source says so ("each",
 * "without the base item") and otherwise empty, `importId` the DM's item list
 * the item comes from and null for a shipped item, and `rev` the row version.
 */
export const itemPriceSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  priceGp: z.number().int().nonnegative(),
  source: itemPriceSourceSchema,
  list: itemPriceListSchema.nullable(),
  rarity: itemRaritySchema.nullable(),
  note: z.string(),
  importId: z.string().nullable(),
  rev: z.number(),
});

export type ItemPrice = z.infer<typeof itemPriceSchema>;

/**
 * The two sources, named on the page and next to every item. The SRD's
 * `attribution` is the statement its license asks for, verbatim.
 */
export const ITEM_PRICE_SOURCE = {
  saidoro: {
    author: "Saidoro",
    title: "Sane Magic Item Prices",
    url: "https://www.giantitp.com/forums/showthread.php?424243",
  },
  srd: {
    author: "Wizards of the Coast",
    title: "SRD 5.2",
    url: "https://www.dndbeyond.com/srd",
    attribution:
      "This work includes material from the System Reference Document 5.2 (“SRD 5.2”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.",
  },
} as const;
