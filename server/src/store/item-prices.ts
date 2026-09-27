// Item prices: the item-price resource.
//
// An item price is its own resource with its own type (decisions/resources,
// @grimoire/shared/item-price), and reference data of the instance
// (decisions/reference-data): no campaign scopes it, and nothing here writes —
// the rows and their search-index rows come with the migration that ships
// them.

import { asc, eq } from "drizzle-orm";
import { itemPriceSchema, type ItemPrice } from "@grimoire/shared/item-price";
import { ApiError } from "../api-error";
import { itemPrices } from "../db/schema";
import { getDb } from "./handle";

/** One stored item-price row. */
type ItemPriceRow = typeof itemPrices.$inferSelect;

/** The item price of a row: every field flat, the closed values checked against the schema. */
function renderItemPrice(row: ItemPriceRow): ItemPrice {
  return itemPriceSchema.parse({
    id: row.id,
    name: row.name,
    priceGp: row.priceGp,
    source: row.source,
    list: row.list,
    rarity: row.rarity,
    note: row.note,
    rev: row.rev,
  });
}

/** GET /api/item-prices — every item price, sorted by name. */
export async function listItemPrices(): Promise<ItemPrice[]> {
  const db = await getDb();
  return db.select().from(itemPrices).orderBy(asc(itemPrices.name)).all().map(renderItemPrice);
}

/** GET /api/item-prices/:id — 404 for an id the list does not have. */
export async function readItemPrice(id: string): Promise<ItemPrice> {
  const db = await getDb();
  const row = db.select().from(itemPrices).where(eq(itemPrices.id, id)).all()[0];
  if (row === undefined) throw new ApiError(404, "item price not found");
  return renderItemPrice(row);
}
