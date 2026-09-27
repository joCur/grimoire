// The item-price imports: list, read, write and remove the DM's own item lists.
//
// AN ITEM-PRICE IMPORT IS ITS OWN RESOURCE (decisions/resources):
// `/item-price-imports` and `/item-price-imports/:id`, answering the
// `ItemPriceImport` type — `{ id, name, itemCount, skipped, rev }`. Like the
// item prices it brings, it is reference data of the instance
// (decisions/reference-data), so it hangs under no campaign.

import { Hono } from "hono";
import {
  deleteItemPriceImport,
  listItemPriceImports,
  readItemPriceImport,
  readItemPriceImportDelete,
  readItemPriceImportList,
  writeItemPriceImport,
} from "../store/item-price-imports";
import { jsonBody } from "./http";

export const itemPriceImportRoutes = new Hono();

// GET /api/item-price-imports -> ItemPriceImport[]
// Every import, sorted by name.
itemPriceImportRoutes.get("/item-price-imports", async (c) => c.json(await listItemPriceImports()));

// GET /api/item-price-imports/:id -> ItemPriceImport
// One import. 404 for an id no import has.
itemPriceImportRoutes.get("/item-price-imports/:id", async (c) =>
  c.json(await readItemPriceImport(c.req.param("id"))),
);

// PUT /api/item-price-imports/:id { name, items } -> ItemPriceImport
// Writes the DM's item list as a whole: `id` is the slug of `name` (400
// otherwise), and each item `{ name, rarity, consumable?, priceGp?, note? }`
// becomes an item price, priced by `priceGp` or else by the SRD's value for
// its rarity, halved for a consumable. An import of that id already there is
// replaced — its old items go, the new ones come — and its `rev` moves; the
// body IS the whole list, so there is no guard to send. An item whose id the price list
// already holds keeps its price and is named in `skipped`. A list that does
// not match the shape is a 400 and writes nothing.
itemPriceImportRoutes.put("/item-price-imports/:id", async (c) => {
  const list = readItemPriceImportList(await jsonBody(c, null));
  return c.json(await writeItemPriceImport(c.req.param("id"), list));
});

// DELETE /api/item-price-imports/:id { rev } -> 204
// Removes the import and every item price it brought, with their search hits.
// A stale `rev` is 409 { code: "rev_conflict", rev, itemPriceImport } and
// removes nothing. 404 for an unknown import.
itemPriceImportRoutes.delete("/item-price-imports/:id", async (c) => {
  const request = readItemPriceImportDelete(await jsonBody(c, null));
  await deleteItemPriceImport(c.req.param("id"), request);
  return c.body(null, 204);
});
