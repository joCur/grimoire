// Item-price imports: the item-price-import resource.
//
// An import is its own resource with its own type (decisions/resources,
// @grimoire/shared/item-price-import): one of the DM's own item lists, and
// the only writer of the item prices it brings. Like them it is reference
// data of the instance (decisions/reference-data): no campaign scopes it, and
// its items and their search-index rows carry none.
//
// An import writes its whole list at once: importing a list of the same name
// again replaces every item the list brought, and removing it removes them.
// An item whose id the price list already holds — a shipped item, an item of
// another list or an earlier item of the same list — keeps what it has and is
// named in the import's `skipped`.

import { asc, count, eq, sql } from "drizzle-orm";
import {
  itemPriceImportDeleteSchema,
  itemPriceImportListSchema,
  itemPriceImportSchema,
  type ItemPriceImport,
  type ItemPriceImportDelete,
  type ItemPriceImportList,
} from "@grimoire/shared/item-price-import";
import { rarityValueGp } from "@grimoire/shared/item-price";
import { isEntityId, toSlug } from "@grimoire/shared/slug";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { itemPriceImports, itemPrices } from "../db/schema";
import { getDb } from "./handle";
import { parseRequest, revConflict } from "./shared";

/** The search-index kind of an item price, whatever wrote it. */
const INDEX_KIND = "item-price";

/** One stored import row. */
type ItemPriceImportRow = typeof itemPriceImports.$inferSelect;

/** The import of a row, with the number of items it brought. */
function renderItemPriceImport(db: GrimoireDb, row: ItemPriceImportRow): ItemPriceImport {
  const items = db
    .select({ n: count() })
    .from(itemPrices)
    .where(eq(itemPrices.importId, row.id))
    .all()[0];
  return itemPriceImportSchema.parse({
    id: row.id,
    name: row.name,
    itemCount: items?.n ?? 0,
    skipped: JSON.parse(row.skipped) as unknown,
    rev: row.rev,
  });
}

function requireImportRow(db: GrimoireDb, id: string): ItemPriceImportRow {
  const row = db.select().from(itemPriceImports).where(eq(itemPriceImports.id, id)).all()[0];
  if (row === undefined) throw new ApiError(404, "item price import not found");
  return row;
}

/** GET /api/item-price-imports — every import, sorted by name. */
export async function listItemPriceImports(): Promise<ItemPriceImport[]> {
  const db = await getDb();
  return db
    .select()
    .from(itemPriceImports)
    .orderBy(asc(itemPriceImports.name))
    .all()
    .map((row) => renderItemPriceImport(db, row));
}

/** GET /api/item-price-imports/:id — 404 for an id no import has. */
export async function readItemPriceImport(id: string): Promise<ItemPriceImport> {
  const db = await getDb();
  return renderItemPriceImport(db, requireImportRow(db, id));
}

/** The body of a PUT, checked against the list's schema. */
export function readItemPriceImportList(raw: unknown): ItemPriceImportList {
  return parseRequest(itemPriceImportListSchema, raw, "item list");
}

/** The body of a DELETE, checked against its schema. */
export function readItemPriceImportDelete(raw: unknown): ItemPriceImportDelete {
  return parseRequest(itemPriceImportDeleteSchema, raw, "item list delete");
}

/**
 * PUT /api/item-price-imports/:id — writes `list` as the import `id`,
 * replacing every item an import of that id brought before. `id` must be the
 * slug of the list's name (400 otherwise).
 */
export async function writeItemPriceImport(
  id: string,
  list: ItemPriceImportList,
): Promise<ItemPriceImport> {
  if (!isEntityId(id) || toSlug(list.name) !== id) {
    throw new ApiError(400, `an item list named "${list.name}" is written under its slug, not ${id}`);
  }
  const db = await getDb();
  return db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const existing = tx.select().from(itemPriceImports).where(eq(itemPriceImports.id, id)).all()[0];
    if (existing === undefined) {
      tx.insert(itemPriceImports).values({ id, name: list.name }).run();
    } else {
      dropImportedItems(tx, id);
    }

    const taken = new Set(tx.select({ id: itemPrices.id }).from(itemPrices).all().map((row) => row.id));
    const skipped: string[] = [];
    for (const item of list.items) {
      const itemId = toSlug(item.name);
      if (itemId === "" || taken.has(itemId)) {
        skipped.push(item.name);
        continue;
      }
      taken.add(itemId);
      tx.insert(itemPrices)
        .values({
          id: itemId,
          name: item.name,
          priceGp: item.priceGp ?? rarityValueGp(item.rarity, item.consumable ?? false),
          list: null,
          rarity: item.rarity,
          source: item.priceGp === undefined ? "srd" : "import",
          note: item.note ?? "",
          importId: id,
        })
        .run();
      tx.run(sql`
        insert into search_fts (title, ref, tags, body, campaign_id, kind, entity_id)
        values (${item.name}, ${itemId}, '', '', null, ${INDEX_KIND}, ${itemId})
      `);
    }

    tx.update(itemPriceImports)
      .set({
        name: list.name,
        skipped: JSON.stringify(skipped),
        ...(existing === undefined ? {} : { rev: existing.rev + 1 }),
      })
      .where(eq(itemPriceImports.id, id))
      .run();
    return renderItemPriceImport(tx, requireImportRow(tx, id));
  }) as ItemPriceImport;
}

/**
 * DELETE /api/item-price-imports/:id { rev } — removes the import and every
 * item it brought. A stale `rev` is 409 with the current import and removes
 * nothing.
 */
export async function deleteItemPriceImport(id: string, request: ItemPriceImportDelete): Promise<void> {
  const db = await getDb();
  db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const row = requireImportRow(tx, id);
    if (row.rev !== request.rev) {
      throw revConflict(row.rev, "item list changed", { itemPriceImport: renderItemPriceImport(tx, row) });
    }
    dropImportedItems(tx, id);
    tx.delete(itemPriceImports).where(eq(itemPriceImports.id, id)).run();
  });
}

/** Remove the items the import `id` brought, and their search-index rows. */
function dropImportedItems(tx: GrimoireDb, id: string): void {
  tx.run(sql`
    delete from search_fts
    where campaign_id is null and kind = ${INDEX_KIND}
      and entity_id in (select id from item_prices where import_id = ${id})
  `);
  tx.delete(itemPrices).where(eq(itemPrices.importId, id)).run();
}
