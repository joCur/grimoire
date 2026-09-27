// The query of the item prices. They belong to the instance, not to a
// campaign, and nothing writes them, so the key names no campaign and the
// campaign's version poll never invalidates it.

import { fetchItemPrices } from "./item-price-api";

/** Key and fetch of every item price. */
export function itemPricesQuery() {
  return { queryKey: ["item-prices"], queryFn: fetchItemPrices, staleTime: Infinity };
}
