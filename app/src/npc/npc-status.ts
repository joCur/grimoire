// The labels of an npc's `status` values (NPC_STATUSES), from the catalog —
// the translator is PASSED IN, so this module holds no copy of its own
// (i18n/index.ts, the lib-layer rule).
//
// `unknown` is one of the four stored values — the npc nobody has placed
// yet — and not a fallback: `npcs.status` is a CHECK constraint of its
// column, so the database cannot hold anything else (ADR #25).

import type { NpcStatus } from "@grimoire/shared/types";

import type { MessageKey, Translate } from "@/i18n";

const NPC_STATUS_KEYS: Record<NpcStatus, MessageKey> = {
  alive: "status.npc.alive",
  dead: "status.npc.dead",
  missing: "status.npc.missing",
  unknown: "status.npc.unknown",
};

export function npcStatusLabel(status: NpcStatus, t: Translate): string {
  return t(NPC_STATUS_KEYS[status]);
}
