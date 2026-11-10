// A scene chat in the suite: its resource `…/scene-chats/:id`
// (decisions/resources), every field flat — `{ id, scene, messages,
// deletedMs?, rev }`, its messages embedded. Its type is the one
// `@grimoire/shared/scene-chat` derives from the chat's schema.

import type { SceneChat } from "@grimoire/shared/scene-chat";
import { underCampaign, type Api } from "./api";

/** The request path of one chat, or, without an id, of the chat list. */
export function sceneChatPath(api: Api, id?: string): string {
  return id === undefined ? underCampaign(api, "scene-chats") : underCampaign(api, "scene-chats", id);
}

/** The live chat of a scene, or `undefined` while it has none. */
export async function getSceneChat(api: Api, scene: string): Promise<SceneChat | undefined> {
  const chats = await api.get<SceneChat[]>(`${sceneChatPath(api)}?scene=${encodeURIComponent(scene)}`);
  return chats[0];
}

/** The cleared chats of the campaign, the latest to go there first. */
export function getTrashedSceneChats(api: Api): Promise<SceneChat[]> {
  return api.get<SceneChat[]>(`${sceneChatPath(api)}?deleted=true`);
}

/**
 * A chat on the scene with one message and its reply written: start the
 * chat, send the message, and wait until no reply runs any more.
 */
export async function chatWithReply(api: Api, scene: string, text: string): Promise<SceneChat> {
  const chat = await api.send<SceneChat>("POST", sceneChatPath(api), { scene });
  await api.send("POST", `${sceneChatPath(api, chat.id)}/messages`, { text });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await api.get<SceneChat>(sceneChatPath(api, chat.id));
    if (current.messages.every((message) => message.status !== "running")) return current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the reply never stood");
}
