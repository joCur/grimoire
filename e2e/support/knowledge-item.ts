// A knowledge item in the suite: its resource `…/knowledge-items/:id`
// (ADR #31), every field flat — `{ id, kind, from, to, text, rev }` — and the
// order of the items on `…/knowledge-item-order`. The types are the ones
// `@grimoire/shared/knowledge-item` derives from the item's schema.

import type {
  KnowledgeItem,
  KnowledgeItemCreate,
  KnowledgeItemOrder,
} from "@grimoire/shared/knowledge-item";
import { underCampaign, type Api } from "./api";

/** The request path of one item, or, without an id, of the item list. */
export function knowledgeItemPath(api: Api, id?: string): string {
  return id === undefined
    ? underCampaign(api, "knowledge-items")
    : underCampaign(api, "knowledge-items", id);
}

/** The request path of the order of the items. */
export function knowledgeItemOrderPath(api: Api): string {
  return underCampaign(api, "knowledge-item-order");
}

/** Every item of the campaign, in the order of the prompt. */
export function getKnowledgeItems(api: Api): Promise<KnowledgeItem[]> {
  return api.get<KnowledgeItem[]>(knowledgeItemPath(api));
}

/** A new item at the end — a second writer, standing in for another tab. */
export function createKnowledgeItem(api: Api, input: KnowledgeItemCreate): Promise<KnowledgeItem> {
  return api.send<KnowledgeItem>("POST", knowledgeItemPath(api), input);
}

/** The order of the items and its guard. */
export function getKnowledgeItemOrder(api: Api): Promise<KnowledgeItemOrder> {
  return api.get<KnowledgeItemOrder>(knowledgeItemOrderPath(api));
}

/** Write the order against its current guard — a second writer's reorder. */
export async function putKnowledgeItemOrder(api: Api, items: string[]): Promise<KnowledgeItemOrder> {
  const { rev } = await getKnowledgeItemOrder(api);
  return api.send<KnowledgeItemOrder>("PUT", knowledgeItemOrderPath(api), { items, rev });
}
