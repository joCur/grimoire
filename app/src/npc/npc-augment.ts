// An npc's augment proposal, field by field (ADR #31): what the model changes
// against the npc as the run read it. Pure, so the rule is unit-testable.

import type { NpcProposal } from "@grimoire/shared/types";

import { formatFieldValue, type FieldProposal } from "@/lib/augment";

/** "No value here" for any field of an npc: absent, blank text, no pair. */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * One field value as it is COMPARED: its rendered text, with the pairs of a
 * key/value set in key order — `quickstats` read back from a reply carries its
 * values as strings (`"2"`) where the stored npc may hold numbers (`2`), and
 * the order of the pairs is no change either.
 */
function comparable(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
    return formatFieldValue(sorted).trim();
  }
  return formatFieldValue(value).trim();
}

/**
 * Only a field that CHANGES is listed — a field repeated verbatim is no
 * decision, and a field the proposal leaves empty is no deletion either (the
 * augmentation rule deletes nothing). The `id` never changes, and `body` is
 * reviewed block by block. `status` always holds a value, so a proposed
 * status is a `changed` field whose default is to keep the stored one.
 */
export function npcFieldProposals(
  current: NpcProposal,
  proposed: NpcProposal,
): FieldProposal[] {
  const { id: _id, body: _body, ...fields } = proposed;
  const out: FieldProposal[] = [];
  for (const [key, value] of Object.entries(fields) as Array<[keyof typeof fields, unknown]>) {
    const before: unknown = current[key];
    if (isEmptyValue(value) || comparable(before) === comparable(value)) continue;
    out.push({
      key,
      ...(before === undefined ? {} : { current: before }),
      proposed: value,
      state: isEmptyValue(before) ? "new" : "changed",
    });
  }
  return out;
}
