// The item-price-import resource (decisions/resources): the DM's own item
// lists, reference data of the instance (decisions/reference-data).
//
// Watched hardest:
//
//   * an imported item is priced by the list's own price or else by the SRD's
//     value for its rarity, halved for a consumable;
//   * an item the price list already holds keeps its price and is named as
//     skipped — a guide price is never overridden;
//   * importing a list of the same name again replaces its items;
//   * removing a list removes its items and their search hits, guarded by
//     `rev`.

import { afterEach, describe, expect, test } from "bun:test";
import type { SearchResponse } from "@grimoire/shared";
import type { ItemPrice } from "@grimoire/shared/item-price";
import type { ItemPriceImport, ItemPriceImportList } from "@grimoire/shared/item-price-import";
import { app } from "../src/server";
import { dropStore, emptyStore, seedStore } from "./support/store";

async function json<T>(url: string, status = 200): Promise<T> {
  const answer = await app.request(url);
  expect(answer.status).toBe(status);
  return (await answer.json()) as T;
}

function send(method: "PUT" | "DELETE", url: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function put(id: string, list: unknown, status = 200): Promise<ItemPriceImport> {
  const answer = await send("PUT", `/api/item-price-imports/${id}`, list);
  expect(answer.status).toBe(status);
  return (await answer.json()) as ItemPriceImport;
}

const BOOK: ItemPriceImportList = {
  name: "My Book",
  items: [
    { name: "Lantern of the Drowned Bell", rarity: "legendary" },
    { name: "Tincture of Tidewalking", rarity: "rare", consumable: true },
    { name: "Gull-Feather Cloak", rarity: "uncommon", priceGp: 900, note: "each" },
    { name: "Potion of Healing", rarity: "common", consumable: true },
    { name: "lantern of the drowned bell", rarity: "rare" },
  ],
};

afterEach(() => {
  dropStore();
});

describe("importing an item list", () => {
  test("prices each item by its own price or by its rarity, and names the ones already there", async () => {
    await emptyStore();
    expect(await put("my-book", BOOK)).toEqual({
      id: "my-book",
      name: "My Book",
      itemCount: 3,
      skipped: ["Potion of Healing", "lantern of the drowned bell"],
      rev: 1,
    });
    expect(await json<ItemPrice>("/api/item-prices/lantern-of-the-drowned-bell")).toEqual({
      id: "lantern-of-the-drowned-bell",
      name: "Lantern of the Drowned Bell",
      priceGp: 200000,
      source: "srd",
      list: null,
      rarity: "legendary",
      note: "",
      importId: "my-book",
      rev: 1,
    });
    // A consumable is worth half its rarity's value.
    expect(await json<ItemPrice>("/api/item-prices/tincture-of-tidewalking")).toMatchObject({
      priceGp: 2000,
      source: "srd",
    });
    expect(await json<ItemPrice>("/api/item-prices/gull-feather-cloak")).toMatchObject({
      priceGp: 900,
      source: "import",
      rarity: "uncommon",
      note: "each",
      importId: "my-book",
    });
    // The guide's price stays.
    expect(await json<ItemPrice>("/api/item-prices/potion-of-healing")).toMatchObject({
      priceGp: 50,
      source: "saidoro",
      importId: null,
    });
    expect(await json<ItemPriceImport[]>("/api/item-price-imports")).toHaveLength(1);
  });

  test("importing the same list again replaces its items", async () => {
    await emptyStore();
    await put("my-book", BOOK);
    const again = await put("my-book", {
      name: "My Book",
      items: [{ name: "Tide Chart of Hollow Reef", rarity: "uncommon" }],
    });
    expect(again).toMatchObject({ itemCount: 1, skipped: [], rev: 2 });
    expect((await app.request("/api/item-prices/lantern-of-the-drowned-bell")).status).toBe(404);
    expect(await json<ItemPrice>("/api/item-prices/tide-chart-of-hollow-reef")).toMatchObject({ priceGp: 400 });
  });

  test("an item another list brought keeps that list's price", async () => {
    await emptyStore();
    await put("my-book", BOOK);
    const other = await put("other-book", {
      name: "Other Book",
      items: [{ name: "Lantern of the Drowned Bell", rarity: "rare", priceGp: 5 }],
    });
    expect(other).toMatchObject({ itemCount: 0, skipped: ["Lantern of the Drowned Bell"] });
    expect(await json<ItemPrice>("/api/item-prices/lantern-of-the-drowned-bell")).toMatchObject({ importId: "my-book" });
  });

  test("a list that does not match the shape, or an id that is not its name's, writes nothing", async () => {
    await emptyStore();
    await put("my-book", { name: "My Book", items: [{ name: "Wand of Wonder", rarity: "artifact" }] }, 400);
    await put("my-book", { name: "My Book", items: [{ name: "Wand", rarity: "rare", source: "DMG" }] }, 400);
    await put("my-book", { name: "My Book", items: [] }, 400);
    await put("another-id", BOOK, 400);
    expect(await json<ItemPriceImport[]>("/api/item-price-imports")).toEqual([]);
    expect((await app.request("/api/item-price-imports/my-book")).status).toBe(404);
  });
});

describe("removing an item list", () => {
  test("removes its items; a stale rev is a 409 with the current list", async () => {
    await emptyStore();
    await put("my-book", BOOK);
    await put("my-book", BOOK);

    const stale = await send("DELETE", "/api/item-price-imports/my-book", { rev: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "rev_conflict",
      rev: 2,
      itemPriceImport: { id: "my-book", itemCount: 3 },
    });

    expect((await send("DELETE", "/api/item-price-imports/my-book", { rev: 2 })).status).toBe(204);
    expect((await app.request("/api/item-prices/lantern-of-the-drowned-bell")).status).toBe(404);
    expect(await json<ItemPrice>("/api/item-prices/potion-of-healing")).toMatchObject({ priceGp: 50 });
    expect((await send("DELETE", "/api/item-price-imports/my-book", { rev: 2 })).status).toBe(404);
  });
});

describe("searching imported items", () => {
  test("a campaign's search finds an imported item until its list is removed", async () => {
    await seedStore();
    await put("my-book", BOOK);
    const search = async () => {
      const res = await app.request(`/api/campaigns/example/search?q=${encodeURIComponent("drowned bell")}`);
      return ((await res.json()) as SearchResponse).results;
    };
    expect(await search()).toContainEqual(
      expect.objectContaining({ kind: "item-price", id: "lantern-of-the-drowned-bell", title: "Lantern of the Drowned Bell" }),
    );
    await put("my-book", { name: "My Book", items: [{ name: "Tide Chart of Hollow Reef", rarity: "uncommon" }] });
    expect(await search()).not.toContainEqual(expect.objectContaining({ id: "lantern-of-the-drowned-bell" }));
  });
});
