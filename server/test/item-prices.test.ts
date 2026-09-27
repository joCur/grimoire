// The item-price resource (decisions/resources): `GET /api/item-prices` and
// `GET /api/item-prices/:id`, reference data of the instance
// (decisions/reference-data).
//
// Watched hardest:
//
//   * a fresh instance has the prices without a seed: the guide's, and the
//     SRD's rarity value for the items the guide has no price for;
//   * an item price answers every field flat;
//   * every campaign's search finds an item, and names it as an item price.

import { afterEach, describe, expect, test } from "bun:test";
import type { SearchResponse } from "@grimoire/shared";
import type { ItemPrice } from "@grimoire/shared/item-price";
import { app } from "../src/server";
import { dropStore, emptyStore, seedStore } from "./support/store";

async function json<T>(url: string, status = 200): Promise<T> {
  const answer = await app.request(url);
  expect(answer.status).toBe(status);
  return (await answer.json()) as T;
}

afterEach(() => {
  dropStore();
});

describe("reading item prices", () => {
  test("an empty instance has every price of both sources, sorted by name", async () => {
    await emptyStore();
    const prices = await json<ItemPrice[]>("/api/item-prices");
    expect(prices.filter((price) => price.source === "saidoro").length).toBe(307);
    expect(prices.filter((price) => price.source === "srd").length).toBe(41);
    const names = prices.map((price) => price.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(prices.map((price) => price.list))).toEqual(
      new Set(["consumable", "combat", "noncombat", "summoning", "gamechanging", null]),
    );
  });

  test("GET answers every field flat, with the guide's note where it gives one", async () => {
    await emptyStore();
    expect(await json<ItemPrice>("/api/item-prices/potion-of-healing")).toEqual({
      id: "potion-of-healing",
      name: "Potion of Healing",
      priceGp: 50,
      source: "saidoro",
      list: "consumable",
      rarity: null,
      note: "",
      rev: 1,
    });
    expect(await json<ItemPrice>("/api/item-prices/arrow-of-slaying")).toMatchObject({
      name: "Arrow of Slaying",
      priceGp: 600,
      note: "each",
    });
  });

  test("an item the guide has no price for carries the SRD value of its rarity", async () => {
    await emptyStore();
    expect(await json<ItemPrice>("/api/item-prices/staff-of-the-magi")).toEqual({
      id: "staff-of-the-magi",
      name: "Staff of the Magi",
      priceGp: 200000,
      source: "srd",
      list: null,
      rarity: "legendary",
      note: "",
      rev: 1,
    });
    // A consumable is worth half its rarity's value.
    expect(await json<ItemPrice>("/api/item-prices/potion-of-giant-strength-hill")).toMatchObject({
      priceGp: 200,
      rarity: "uncommon",
    });
  });

  test("an unknown item is a 404", async () => {
    await emptyStore();
    expect((await app.request("/api/item-prices/nope")).status).toBe(404);
  });
});

describe("searching item prices", () => {
  test("a campaign's search finds an item by name, named as an item price", async () => {
    await seedStore();
    const res = await app.request(`/api/campaigns/example/search?q=${encodeURIComponent("potion heal")}`);
    const { results } = (await res.json()) as SearchResponse;
    expect(results).toContainEqual(
      expect.objectContaining({ kind: "item-price", id: "potion-of-healing", title: "Potion of Healing" }),
    );
  });
});
