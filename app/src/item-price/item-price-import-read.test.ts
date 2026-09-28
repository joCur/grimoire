import { describe, expect, test } from "bun:test";

import { readItemList } from "./item-price-import-read";

describe("readItemList", () => {
  test("reads a list with its name and items", () => {
    const text = JSON.stringify({
      name: "My Book",
      items: [
        { name: "Lantern of the Drowned Bell", rarity: "legendary" },
        { name: "Tincture of Tidewalking", rarity: "rare", consumable: true },
      ],
    });
    expect(readItemList(text)).toEqual({
      ok: true,
      list: {
        name: "My Book",
        items: [
          { name: "Lantern of the Drowned Bell", rarity: "legendary" },
          { name: "Tincture of Tidewalking", rarity: "rare", consumable: true },
        ],
      },
    });
  });

  test("names why a text is no list", () => {
    expect(readItemList("name,rarity")).toEqual({ ok: false, reason: "json" });
    expect(
      readItemList(
        JSON.stringify({
          name: "My Book",
          items: [
            { name: "Lantern", rarity: "rare" },
            { name: "Tincture", rarity: "very rare" },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "shape", item: 2 });
    expect(readItemList(JSON.stringify({ items: [] }))).toEqual({ ok: false, reason: "shape", item: null });
    expect(
      readItemList(JSON.stringify({ name: "???", items: [{ name: "Lantern", rarity: "rare" }] })),
    ).toEqual({ ok: false, reason: "name" });
  });
});
