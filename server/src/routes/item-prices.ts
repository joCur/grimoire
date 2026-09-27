// The item prices: list and read.
//
// AN ITEM PRICE IS ITS OWN RESOURCE (decisions/resources): `/item-prices` and
// `/item-prices/:id`, answering the `ItemPrice` type —
// `{ id, name, priceGp, source, list, rarity, note, rev }`. Item prices are
// reference data of the instance (decisions/reference-data), so they hang
// under no campaign and have no write: Saidoro's "Sane Magic Item Prices" and,
// for the items it has no price for, the SRD 5.2's value for the rarity,
// shipped with the app.

import { Hono } from "hono";
import { listItemPrices, readItemPrice } from "../store/item-prices";

export const itemPriceRoutes = new Hono();

// GET /api/item-prices -> ItemPrice[]
// Every item price, sorted by name. The page searches, filters
// and sorts them itself.
itemPriceRoutes.get("/item-prices", async (c) => c.json(await listItemPrices()));

// GET /api/item-prices/:id -> ItemPrice
// One item price. 404 for an id the list does not have.
itemPriceRoutes.get("/item-prices/:id", async (c) => c.json(await readItemPrice(c.req.param("id"))));
