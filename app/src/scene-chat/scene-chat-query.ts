// The queries of the scene chat: the live chat of one scene, the cleared
// chats in the trash, and whether the instance has a model to ask. The first
// segments of the chat keys are what the campaign's version poll invalidates.
//
// The reply is written on the SERVER, so the tab is free to go; while a reply
// of the chat runs, the chat's query polls on its own until the reply stands
// — also in a hidden tab, because the campaign version poll pauses there and
// the reply's end has to be picked up anyway. The interval exists only while
// something runs.

import type { SceneChat } from "@grimoire/shared/scene-chat";
import type { QueryKey } from "@tanstack/react-query";

import { fetchLlmProvider } from "./llm-provider-api";
import { fetchSceneChat, fetchTrashedSceneChats } from "./scene-chat-api";

const CHAT = "scene-chat";
const TRASH = "scene-chat-trash";

/** The first segment of every scene chat query key — a scene's chat, and the trash. */
export const SCENE_CHAT_QUERY_ROOTS = [CHAT, TRASH] as const;

/** Poll cadence while a reply runs. */
export const SCENE_CHAT_POLL_MS = 2_000;

/** Whether a reply of the chat is still being written. */
export function replyRunning(chat: SceneChat | null | undefined): boolean {
  return chat?.messages.some((message) => message.status === "running") ?? false;
}

/** The query key of a scene's live chat. */
export function sceneChatKey(campaign: string, scene: string): QueryKey {
  return [CHAT, campaign, scene];
}

/** Key, fetch and poll of a scene's live chat (`null` while it has none). */
export function sceneChatQuery(campaign: string, scene: string) {
  return {
    queryKey: sceneChatKey(campaign, scene),
    queryFn: () => fetchSceneChat(campaign, scene),
    refetchInterval: (query: { state: { data: SceneChat | null | undefined } }) =>
      replyRunning(query.state.data) ? SCENE_CHAT_POLL_MS : false,
    refetchIntervalInBackground: true,
  };
}

/** The query key of the campaign's cleared chats. */
export function sceneChatTrashKey(campaign: string): QueryKey {
  return [TRASH, campaign];
}

/** Key and fetch of the campaign's chats in the trash. */
export function sceneChatTrashQuery(campaign: string) {
  return { queryKey: sceneChatTrashKey(campaign), queryFn: () => fetchTrashedSceneChats(campaign) };
}

/** Key and fetch of whether the instance has a model to ask. */
export function llmProviderQuery() {
  return { queryKey: ["llm-provider"], queryFn: fetchLlmProvider };
}
