// The item-price resource (decisions/resources): `GET /api/item-prices` and
// `GET /api/item-prices/:id`, reference data of the instance
// (decisions/reference-data).
//
// Watched hardest:
//
//   * a fresh instance has the guide's prices without a seed;
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
  test("an empty instance has every price of the guide, sorted by name", async () => {
    await emptyStore();
    const prices = await json<ItemPrice[]>("/api/item-prices");
    expect(prices.length).toBe(307);
    const names = prices.map((price) => price.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(prices.map((price) => price.list))).toEqual(
      new Set(["consumable", "combat", "noncombat", "summoning", "gamechanging"]),
    );
  });

  test("GET answers every field flat, with the guide's note where it gives one", async () => {
    await emptyStore();
    expect(await json<ItemPrice>("/api/item-prices/potion-of-healing")).toEqual({
      id: "potion-of-healing",
      name: "Potion of Healing",
      priceGp: 50,
      list: "consumable",
      note: "",
      rev: 1,
    });
    expect(await json<ItemPrice>("/api/item-prices/arrow-of-slaying")).toMatchObject({
      name: "Arrow of Slaying",
      priceGp: 600,
      note: "each",
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
