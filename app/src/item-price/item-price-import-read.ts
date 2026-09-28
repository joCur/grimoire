// Reading the DM's item list in the browser: the text the DM picked becomes
// the list the import sends, or the reason it cannot be one. Pure, for unit
// tests.

import {
  itemPriceImportListSchema,
  type ItemPriceImportList,
} from "@grimoire/shared/item-price-import";
import { toSlug } from "@grimoire/shared/slug";

/**
 * What a text holds: the list, or why it is none — no JSON at all, a list
 * whose name yields no id, or the first item (counted from one) that does not
 * match the format, or `item: null` where the list around the items does not.
 */
export type ReadItemList =
  | { ok: true; list: ItemPriceImportList }
  | { ok: false; reason: "json" }
  | { ok: false; reason: "name" }
  | { ok: false; reason: "shape"; item: number | null };

export function readItemList(text: string): ReadItemList {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "json" };
  }
  const parsed = itemPriceImportListSchema.safeParse(raw);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path ?? [];
    const index = path[0] === "items" && typeof path[1] === "number" ? path[1] + 1 : null;
    return { ok: false, reason: "shape", item: index };
  }
  if (toSlug(parsed.data.name) === "") return { ok: false, reason: "name" };
  return { ok: true, list: parsed.data };
}
