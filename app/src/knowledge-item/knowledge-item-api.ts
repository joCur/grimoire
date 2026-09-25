// The API client of a knowledge item (ADR #31): its resource — list,
// create, write, delete — and the order of the items, which has its own
// endpoint and its own guard. Built from the shared HTTP helpers (../api.ts).

import type {
  KnowledgeItem,
  KnowledgeItemChange,
  KnowledgeItemCreate,
  KnowledgeItemOrder,
} from "@grimoire/shared/knowledge-item";

import { campaignPath, deleteJson, getJson, postJson, sendJson } from "@/api";

/** The request path of a campaign's knowledge items, or of one of them. */
function itemsUrl(campaign: string, id?: string): string {
  const base = `${campaignPath(campaign)}/knowledge-items`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** The request path of the order of the campaign's knowledge items. */
function orderUrl(campaign: string): string {
  return `${campaignPath(campaign)}/knowledge-item-order`;
}

/** Every item of the campaign, in the order of the prompt. */
export function fetchKnowledgeItems(campaign: string): Promise<KnowledgeItem[]> {
  return getJson<KnowledgeItem[]>(itemsUrl(campaign));
}

/** A new item at the end of the order. No `rev`: a new item overwrites nothing. */
export function createKnowledgeItem(campaign: string, input: KnowledgeItemCreate): Promise<KnowledgeItem> {
  return postJson<KnowledgeItem>(itemsUrl(campaign), input);
}

/**
 * Write ONE item against the `rev` it was read with — or, with `force`, on
 * top of the stored one. A stale `rev` is 409 with the current item.
 */
export function patchKnowledgeItem(
  campaign: string,
  id: string,
  rev: number,
  change: KnowledgeItemChange,
  force = false,
): Promise<KnowledgeItem> {
  return sendJson<KnowledgeItem>("PATCH", itemsUrl(campaign, id), {
    ...change,
    rev,
    ...(force ? { force } : {}),
  });
}

/** Delete ONE item against the `rev` it was read with; same 409 as the patch. */
export function deleteKnowledgeItem(campaign: string, id: string, rev: number): Promise<void> {
  return deleteJson(itemsUrl(campaign, id), { rev });
}

/** The order of the items: every id, and the order's own guard. */
export function fetchKnowledgeItemOrder(campaign: string): Promise<KnowledgeItemOrder> {
  return getJson<KnowledgeItemOrder>(orderUrl(campaign));
}

/**
 * Write the whole order against the guard it was read with. `items` names
 * every item exactly once; a stale guard is 409 with the current order, and
 * no item's `rev` moves.
 */
export function putKnowledgeItemOrder(campaign: string, order: KnowledgeItemOrder): Promise<KnowledgeItemOrder> {
  return sendJson<KnowledgeItemOrder>("PUT", orderUrl(campaign), order);
}
