// The API client of a scene chat (decisions/resources): its resource — the
// live chat of a scene, starting it, clearing it into the trash and taking it
// back out (decisions/trash). Built from the shared HTTP helpers (../api.ts).

import type { SceneChat } from "@grimoire/shared/scene-chat";

import { campaignPath, getJson, postJson, sendJson } from "@/api";

/** The request path of a campaign's scene chats, or of one of them. */
function chatsUrl(campaign: string, id?: string): string {
  const base = `${campaignPath(campaign)}/scene-chats`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** The live chat of a scene, or `null` while it has none. */
export async function fetchSceneChat(campaign: string, scene: string): Promise<SceneChat | null> {
  const chats = await getJson<SceneChat[]>(`${chatsUrl(campaign)}?scene=${encodeURIComponent(scene)}`);
  return chats[0] ?? null;
}

/** The chat of a scene, empty when this starts it; the live one when it has one. */
export function startSceneChat(campaign: string, scene: string): Promise<SceneChat> {
  return postJson<SceneChat>(chatsUrl(campaign), { scene });
}

/**
 * Clear ONE chat against the `rev` it was read with: it goes to the trash
 * with its messages. A stale `rev` is 409 with the current chat.
 */
export function clearSceneChat(campaign: string, chat: Pick<SceneChat, "id" | "rev">): Promise<SceneChat> {
  return sendJson<SceneChat>("DELETE", chatsUrl(campaign, chat.id), { rev: chat.rev });
}

/** The cleared chats of the campaign, the latest to go there first. */
export function fetchTrashedSceneChats(campaign: string): Promise<SceneChat[]> {
  return getJson<SceneChat[]>(`${chatsUrl(campaign)}?deleted=true`);
}

/**
 * Take ONE chat out of the trash against the `rev` it went there with. A
 * scene in the trash or a new chat of the scene stands in the way (409).
 */
export function restoreSceneChat(campaign: string, chat: Pick<SceneChat, "id" | "rev">): Promise<SceneChat> {
  return sendJson<SceneChat>("PATCH", chatsUrl(campaign, chat.id), { rev: chat.rev, deletedMs: null });
}
