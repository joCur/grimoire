// The API client of an item price (decisions/resources): its resource, read
// only — item prices are reference data of the instance
// (decisions/reference-data). Built from the shared HTTP helpers (../api.ts).

import type { ItemPrice } from "@grimoire/shared/item-price";

import { getJson } from "@/api";

/** Every item price, sorted by name. */
export function fetchItemPrices(): Promise<ItemPrice[]> {
  return getJson<ItemPrice[]>("/item-prices");
}
