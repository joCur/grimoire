// The form of an npc — what its dialog, the edit surface of its reading view
// and the card of a proposed npc start with, and the write a save sends. Pure,
// so every rule is unit-testable.
//
// Only what the DM CHANGED is written: a field nobody touched keeps its
// stored value, whitespace around a value is no change, and a field left
// blank clears the value (`null`) instead of writing an empty one. The name
// and the status are the exceptions — an npc always has both: a blank name
// is no save, and the status is chosen from its closed list (decisions/constraints).
// `quickstats` follows the rules of a key/value field
// (components/fields/pairs.ts).

import type { NpcChange, NpcProposal, NpcStatus } from "@grimoire/shared/npc";

import { pairsIssue, pairsOf, pairsValue, samePairs, type Pair } from "@/components/fields/pairs";
import { textValue } from "@/components/fields/text";
import type { Translate } from "@/i18n/format";

/** The npc's fields that are edited as free text. */
type TextKey = Exclude<keyof NpcProposal, "id" | "body" | "status" | "quickstats">;

/**
 * The form's values — typed against the npc, so a field the form does not
 * handle does not compile. `id` is fixed at creation (decisions/constraints) and `body` has
 * its own editor.
 */
export type NpcFormValues = { [K in TextKey]-?: string } & {
  status: NpcStatus;
  quickstats: readonly Pair[];
};

const TEXT_FIELDS = {
  name: true,
  role: true,
  chapter: true,
  statblock: true,
  voice: true,
  appearance: true,
  motivation: true,
} satisfies Record<TextKey, true>;

const TEXT_KEYS = Object.keys(TEXT_FIELDS) as TextKey[];

/** What the form starts with — the npc's current values. */
export function npcFormValues(npc: NpcProposal): NpcFormValues {
  return {
    name: npc.name,
    role: npc.role ?? "",
    chapter: npc.chapter ?? "",
    status: npc.status,
    statblock: npc.statblock ?? "",
    quickstats: pairsOf(npc.quickstats),
    voice: npc.voice ?? "",
    appearance: npc.appearance ?? "",
    motivation: npc.motivation ?? "",
  };
}

/**
 * The form as the npc's write: every field named, each with the value it
 * writes — a blank name is left out, because an npc cannot lose it.
 */
function written(values: NpcFormValues): NpcChange {
  const change: NpcChange = {};
  for (const key of TEXT_KEYS) {
    const value = textValue(values[key]);
    if (key === "name") {
      if (value !== null) change.name = value;
    } else {
      change[key] = value;
    }
  }
  change.status = values.status;
  change.quickstats = pairsValue(values.quickstats);
  return change;
}

/** The fields whose written value moved, blank name included. */
function moved(initial: NpcFormValues, values: NpcFormValues): Array<keyof NpcFormValues> {
  return [
    ...TEXT_KEYS.filter((key) => textValue(initial[key]) !== textValue(values[key])),
    ...(initial.status === values.status ? [] : ["status" as const]),
    ...(samePairs(initial.quickstats, values.quickstats) ? [] : ["quickstats" as const]),
  ];
}

/** The write of a save: ONLY the fields that moved; a blank name is left out. */
export function npcFormChange(initial: NpcFormValues, values: NpcFormValues): NpcChange {
  const all = written(values);
  const change: NpcChange = {};
  for (const key of moved(initial, values)) {
    if (all[key] !== undefined) Object.assign(change, { [key]: all[key] });
  }
  return change;
}

/**
 * The form of a PROPOSED npc as the change the generator review keeps on its
 * job: every field named, so the change says what the form shows — a value
 * where the form holds one, `null` where an optional field was emptied. A
 * blank name is not named at all: the proposal's own name stands.
 */
export function npcProposalChange(values: NpcFormValues): NpcChange {
  return written(values);
}

/** What blocks the save, per field — the line under the field. */
export function npcFormIssues(
  values: NpcFormValues,
  t: Translate,
): Partial<Record<keyof NpcFormValues, string>> {
  const quickstats = pairsIssue(values.quickstats, t);
  return quickstats === undefined ? {} : { quickstats };
}

/**
 * Is there typed work a close would lose? An unfinished quickstat row counts:
 * it writes nothing yet, and it is exactly the work that must not disappear
 * on a stray Esc.
 */
export function npcFormDirty(
  initial: NpcFormValues,
  values: NpcFormValues,
  t: Translate,
): boolean {
  return moved(initial, values).length > 0 || Object.keys(npcFormIssues(values, t)).length > 0;
}

/** A blank name is not a save — the npc would lose its name. */
export function canSubmitNpcForm(values: NpcFormValues, t: Translate): boolean {
  return textValue(values.name) !== null && Object.keys(npcFormIssues(values, t)).length === 0;
}
