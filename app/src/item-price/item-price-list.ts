// What the price page shows: the items that match the search and the chosen
// list, in the chosen order. Pure, for unit tests.

import type { ItemPrice, ItemPriceList } from "@grimoire/shared/item-price";

/** The page's orders: by name A to Z, or by price from cheapest. */
export type ItemPriceSort = "name" | "price";

/**
 * Every item, the items of one of the guide's five lists, the items priced by
 * their rarity, or the items of the DM's own item lists.
 */
export type ItemPriceListFilter = ItemPriceList | "all" | "rarity" | "imported";

/**
 * The items whose name contains every word of `search` (case-insensitive, in
 * any order), in `list` — or, for `rarity`, the items the SRD prices by their
 * rarity, and for `imported`, the items of the DM's own lists —, sorted by
 * `sort`. Items of the same price stand by
 * name; items of the same name by price.
 */
export function visibleItemPrices(
  items: readonly ItemPrice[],
  search: string,
  list: ItemPriceListFilter,
  sort: ItemPriceSort,
): ItemPrice[] {
  const words = search.toLocaleLowerCase("en").split(/\s+/).filter((word) => word !== "");
  const byName = (a: ItemPrice, b: ItemPrice) => a.name.localeCompare(b.name, "en");
  return items
    .filter((item) =>
      list === "all"
        ? true
        : list === "rarity"
          ? item.source === "srd"
          : list === "imported"
            ? item.importId !== null
            : item.list === list,
    )
    .filter((item) => {
      const name = item.name.toLocaleLowerCase("en");
      return words.every((word) => name.includes(word));
    })
    .sort((a, b) =>
      sort === "price" ? a.priceGp - b.priceGp || byName(a, b) : byName(a, b) || a.priceGp - b.priceGp,
    );
}
