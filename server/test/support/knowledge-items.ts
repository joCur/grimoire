// The knowledge items of a case, written through their own resource
// (decisions/resources) — for the cases that need a campaign's knowledge to be exactly
// something before a generator run.

import { expect } from "bun:test";
import type { KnowledgeItem, KnowledgeItemCreate } from "@grimoire/shared/knowledge-item";
import { app } from "../../src/server";

async function send(method: string, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Make the campaign's knowledge exactly `items`, in this order: every stored
 * item is deleted against its `rev`, then each of `items` is created at the
 * end.
 */
export async function setKnowledge(items: KnowledgeItemCreate[], campaign = "beispiel"): Promise<void> {
  const url = `/api/campaigns/${campaign}/knowledge-items`;
  const stored = (await (await app.request(url)).json()) as KnowledgeItem[];
  for (const item of stored) {
    expect((await send("DELETE", `${url}/${item.id}`, { rev: item.rev })).status).toBe(204);
  }
  for (const item of items) expect((await send("POST", url, item)).status).toBe(201);
}
