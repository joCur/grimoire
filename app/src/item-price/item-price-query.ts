// The queries of the item prices and of the DM's item lists. They belong to
// the instance, not to a campaign, so their keys name no campaign and the
// campaign's version poll never invalidates them; only an import writes them,
// and it fetches both again (./ItemPriceImports.tsx).

import { fetchItemPriceImports } from "./item-price-import-api";
import { fetchItemPrices } from "./item-price-api";

/** Key and fetch of every item price. */
export function itemPricesQuery() {
  return { queryKey: ["item-prices"], queryFn: fetchItemPrices, staleTime: Infinity };
}

/** Key and fetch of every item list the DM imported. */
export function itemPriceImportsQuery() {
  return { queryKey: ["item-price-imports"], queryFn: fetchItemPriceImports, staleTime: Infinity };
}
