// The labels and colors of an npc's `status` values (NPC_STATUSES), from the
// catalog — the translator is PASSED IN, so this module holds no copy of its
// own (i18n/index.ts, the lib-layer rule). The colors are design tokens, not
// copy.
//
// `unknown` is one of the four stored values — the npc nobody has placed
// yet — and not a fallback: `npcs.status` is a CHECK constraint of its
// column, so the database cannot hold anything else (decisions/constraints).

import { NPC_STATUSES, type NpcStatus } from "@grimoire/shared/npc";

import type { StatusMeta } from "@/components/StatusMenu";
import type { MessageKey, Translate } from "@/i18n";

/** Catalog key + dot/text colors per status. */
const NPC_STATUS_META: Record<NpcStatus, { key: MessageKey; dot: string; text: string }> = {
  alive: { key: "status.npc.alive", dot: "bg-success", text: "text-success-text" },
  dead: { key: "status.npc.dead", dot: "bg-faint", text: "text-muted-foreground" },
  missing: { key: "status.npc.missing", dot: "bg-warn", text: "text-body-secondary" },
  unknown: { key: "status.npc.unknown", dot: "bg-muted-foreground", text: "text-dim" },
};

export function npcStatusLabel(status: NpcStatus, t: Translate): string {
  return t(NPC_STATUS_META[status].key);
}

/** Label + colors for a status value — what the status menu of the edit mode shows. */
export function npcStatusMeta(status: NpcStatus, t: Translate): StatusMeta {
  const { key, dot, text } = NPC_STATUS_META[status];
  return { label: t(key), dot, text };
}

/** The four selectable options, in the order of NPC_STATUSES. */
export function npcStatusOptions(t: Translate): ReadonlyArray<{ value: NpcStatus; label: string }> {
  return NPC_STATUSES.map((value) => ({ value, label: t(NPC_STATUS_META[value].key) }));
}
