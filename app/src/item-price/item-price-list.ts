// What the price page shows: the items that match the search and the chosen
// list, in the chosen order. Pure, for unit tests.

import type { ItemPrice, ItemPriceList } from "@grimoire/shared/item-price";

/** The page's orders: by name A to Z, or by price from cheapest. */
export type ItemPriceSort = "name" | "price";

/** Every list, or one of the guide's five. */
export type ItemPriceListFilter = ItemPriceList | "all";

/**
 * The items whose name contains every word of `search` (case-insensitive, in
 * any order), in `list`, sorted by `sort`. Items of the same price stand by
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
    .filter((item) => list === "all" || item.list === list)
    .filter((item) => {
      const name = item.name.toLocaleLowerCase("en");
      return words.every((word) => name.includes(word));
    })
    .sort((a, b) =>
      sort === "price" ? a.priceGp - b.priceGp || byName(a, b) : byName(a, b) || a.priceGp - b.priceGp,
    );
}
