import { describe, expect, test } from "bun:test";
import type { ItemPrice } from "@grimoire/shared/item-price";

import { visibleItemPrices } from "./item-price-list";

function item(
  id: string,
  name: string,
  priceGp: number,
  list: ItemPrice["list"],
  importId: string | null = null,
): ItemPrice {
  return list === null
    ? { id, name, priceGp, source: "srd", list, rarity: "legendary", note: "", importId, rev: 1 }
    : { id, name, priceGp, source: "saidoro", list, rarity: null, note: "", importId, rev: 1 };
}

const ITEMS: ItemPrice[] = [
  item("potion-of-speed", "Potion of Speed", 400, "consumable"),
  item("bag-of-holding", "Bag of Holding", 4000, "noncombat"),
  item("potion-of-healing", "Potion of Healing", 50, "consumable"),
  item("holy-avenger", "Holy Avenger", 165000, "combat"),
  item("staff-of-the-magi", "Staff of the Magi", 200000, null),
  item("vorpal-sword", "Vorpal Sword", 200000, null, "dmg"),
];

const ids = (items: ItemPrice[]) => items.map((it) => it.id);

describe("visibleItemPrices", () => {
  test("sorts by name, or by price from the cheapest", () => {
    expect(ids(visibleItemPrices(ITEMS, "", "all", "name"))).toEqual([
      "bag-of-holding",
      "holy-avenger",
      "potion-of-healing",
      "potion-of-speed",
      "staff-of-the-magi",
      "vorpal-sword",
    ]);
    expect(ids(visibleItemPrices(ITEMS, "", "all", "price"))).toEqual([
      "potion-of-healing",
      "potion-of-speed",
      "bag-of-holding",
      "holy-avenger",
      "staff-of-the-magi",
      "vorpal-sword",
    ]);
  });

  test("keeps the items of one list, the items priced by their rarity, or the imported items", () => {
    expect(ids(visibleItemPrices(ITEMS, "", "consumable", "name"))).toEqual([
      "potion-of-healing",
      "potion-of-speed",
    ]);
    expect(ids(visibleItemPrices(ITEMS, "", "rarity", "name"))).toEqual([
      "staff-of-the-magi",
      "vorpal-sword",
    ]);
    expect(ids(visibleItemPrices(ITEMS, "", "imported", "name"))).toEqual(["vorpal-sword"]);
  });

  test("matches every word of the search in any order, ignoring case", () => {
    expect(ids(visibleItemPrices(ITEMS, "HEAL potion", "all", "name"))).toEqual(["potion-of-healing"]);
    expect(ids(visibleItemPrices(ITEMS, "  ", "all", "name"))).toHaveLength(6);
    expect(visibleItemPrices(ITEMS, "potion", "combat", "name")).toEqual([]);
  });
});
