import { describe, expect, test } from "bun:test";
import type { ItemPrice } from "@grimoire/shared/item-price";

import { visibleItemPrices } from "./item-price-list";

function item(id: string, name: string, priceGp: number, list: ItemPrice["list"]): ItemPrice {
  return { id, name, priceGp, list, note: "", rev: 1 };
}

const ITEMS: ItemPrice[] = [
  item("potion-of-speed", "Potion of Speed", 400, "consumable"),
  item("bag-of-holding", "Bag of Holding", 4000, "noncombat"),
  item("potion-of-healing", "Potion of Healing", 50, "consumable"),
  item("holy-avenger", "Holy Avenger", 165000, "combat"),
];

const ids = (items: ItemPrice[]) => items.map((it) => it.id);

describe("visibleItemPrices", () => {
  test("sorts by name, or by price from the cheapest", () => {
    expect(ids(visibleItemPrices(ITEMS, "", "all", "name"))).toEqual([
      "bag-of-holding",
      "holy-avenger",
      "potion-of-healing",
      "potion-of-speed",
    ]);
    expect(ids(visibleItemPrices(ITEMS, "", "all", "price"))).toEqual([
      "potion-of-healing",
      "potion-of-speed",
      "bag-of-holding",
      "holy-avenger",
    ]);
  });

  test("keeps the items of one list", () => {
    expect(ids(visibleItemPrices(ITEMS, "", "consumable", "name"))).toEqual([
      "potion-of-healing",
      "potion-of-speed",
    ]);
  });

  test("matches every word of the search in any order, ignoring case", () => {
    expect(ids(visibleItemPrices(ITEMS, "HEAL potion", "all", "name"))).toEqual(["potion-of-healing"]);
    expect(ids(visibleItemPrices(ITEMS, "  ", "all", "name"))).toHaveLength(4);
    expect(visibleItemPrices(ITEMS, "potion", "combat", "name")).toEqual([]);
  });
});
