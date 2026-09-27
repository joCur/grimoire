// The API client of an item-price import (decisions/resources): the DM's own
// item lists, reference data of the instance (decisions/reference-data).
// Built from the shared HTTP helpers (../api.ts).

import type { ItemPriceImport, ItemPriceImportList } from "@grimoire/shared/item-price-import";
import { toSlug } from "@grimoire/shared/slug";

import { deleteJson, getJson, sendJson } from "@/api";

/** Every import, sorted by name. */
export function fetchItemPriceImports(): Promise<ItemPriceImport[]> {
  return getJson<ItemPriceImport[]>("/item-price-imports");
}

/**
 * Write a list as the import named by its name — replacing the
 * items a list of that name brought before. The answer names the items the
 * price list already held.
 */
export function putItemPriceImport(list: ItemPriceImportList): Promise<ItemPriceImport> {
  return sendJson<ItemPriceImport>("PUT", `/item-price-imports/${toSlug(list.name)}`, list);
}

/**
 * Remove ONE import and its items against the `rev` it was read with. A stale
 * `rev` is 409 with the current import; nothing is removed.
 */
export function deleteItemPriceImport(entry: Pick<ItemPriceImport, "id" | "rev">): Promise<void> {
  return deleteJson(`/item-price-imports/${encodeURIComponent(entry.id)}`, { rev: entry.rev });
}
