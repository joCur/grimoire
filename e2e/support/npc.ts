// An npc in the suite: its resource `…/npcs/:id` (decisions/resources), every field
// flat, `body` among them, beside its guard. Its type is the one
// `@grimoire/shared/npc` derives from the npc's schema.

import type { Npc, NpcChange, NpcCreate } from "@grimoire/shared/npc";
import { exists, underCampaign, type Api } from "./api";

/** The request path of one npc, or, without an id, of the npc list. */
export function npcPath(api: Api, id?: string): string {
  return id === undefined ? underCampaign(api, "npcs") : underCampaign(api, "npcs", id);
}

/** GET one npc from its own resource; throws when it is unknown. */
export function getNpc(api: Api, id: string): Promise<Npc> {
  return api.get<Npc>(npcPath(api, id));
}

/** Whether the campaign has an npc with that id (404 = no). */
export function npcExists(api: Api, id: string): Promise<boolean> {
  return exists(api, npcPath(api, id));
}

/**
 * The ONE write of an npc: PATCH its resource with `rev` and any subset of
 * its fields, `body` among them. Omitted, `rev` is read first — the helper
 * then plays the second writer.
 */
export async function patchNpc(
  api: Api,
  id: string,
  change: NpcChange & { rev?: number; force?: boolean },
): Promise<Npc> {
  const rev = change.rev ?? (await getNpc(api, id)).rev;
  return api.send<Npc>("PATCH", npcPath(api, id), { ...change, rev });
}

/**
 * Create an npc: POST the list with `{ name, id?, body? }`; throws on a
 * non-2xx answer (a taken id is a 409 — `api.fetch` asserts that one).
 */
export function createNpc(api: Api, request: NpcCreate): Promise<Npc> {
  return api.send<Npc>("POST", npcPath(api), request);
}
