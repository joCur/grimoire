// The queries of a campaign's knowledge items and of their order — the
// knowledge page and the generator's context line read the same keys, so an
// item saved on one shows up on the other. Their first segments are what the
// campaign's version poll invalidates.

import type { QueryKey } from "@tanstack/react-query";

import { fetchKnowledgeItemOrder, fetchKnowledgeItems } from "./knowledge-item-api";

const LIST = "knowledge-items";
const ORDER = "knowledge-item-order";

/** The first segments of every knowledge-item query key. */
export const KNOWLEDGE_ITEM_QUERY_ROOTS = [LIST, ORDER] as const;

/** The query key of the campaign's knowledge items. */
export function knowledgeItemsKey(campaign: string): QueryKey {
  return [LIST, campaign];
}

/** Key and fetch of the campaign's knowledge items. */
export function knowledgeItemsQuery(campaign: string) {
  return { queryKey: knowledgeItemsKey(campaign), queryFn: () => fetchKnowledgeItems(campaign) };
}

/** The query key of the order of the campaign's knowledge items. */
export function knowledgeItemOrderKey(campaign: string): QueryKey {
  return [ORDER, campaign];
}

/** Key and fetch of the order of the campaign's knowledge items. */
export function knowledgeItemOrderQuery(campaign: string) {
  return {
    queryKey: knowledgeItemOrderKey(campaign),
    queryFn: () => fetchKnowledgeItemOrder(campaign),
  };
}
