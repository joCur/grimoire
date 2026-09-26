// The NPC run of the generator, the pure half: whether the id the DM pins is
// usable, and what the review shows of the proposed npc once changes lie on
// it. Pure, so every rule is unit-testable.

import { withNpcChange, type NpcChange, type NpcProposal } from "@grimoire/shared/npc";

import type { Translate } from "@/i18n";

/**
 * Is this string usable as an npc id? The npc generator's `id`
 * field is OPTIONAL — an empty field means "the model chooses" and is
 * therefore not an error. Everything else follows the same bar as a chapter
 * id (the server's kebab pattern) plus the one check only the client can do
 * cheaply: an id that already exists would be a 409, and saying so
 * before the run costs nothing.
 */
export function npcIdError(
  id: string,
  existingIds: readonly string[],
  t: Translate,
): string | undefined {
  if (id === "") return undefined;
  if (id.includes("/") || id.includes("\\")) return t("generate.input.npcId.slash");
  if (/\s/.test(id)) return t("generate.input.npcId.space");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return t("generate.input.npcId.charset");
  if (existingIds.includes(id)) return t("generate.input.npcId.exists");
  return undefined;
}

/**
 * What the review shows for one proposed npc: the npc the run proposed with
 * every change laid on top, in order — the job's stored change first, the
 * buffer the DM is typing in last (`withNpcChange`).
 */
export function npcOf(
  proposed: NpcProposal,
  ...changes: Array<NpcChange | undefined>
): NpcProposal {
  let out = proposed;
  for (const change of changes) {
    if (change === undefined) continue;
    out = withNpcChange(out, change) as NpcProposal;
  }
  return out;
}
