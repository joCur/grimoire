// A scene's augment proposal, field by field (ADR #31): what the model
// changes against the scene as the run read it. Pure, so the rule is
// unit-testable.

import type { SceneProposal } from "@grimoire/shared/types";

import { formatPropertyValue, type FieldProposal } from "@/lib/augment";

/** "No value here" for any field of a scene: absent, blank text, an empty list. */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * One field value as it is COMPARED: its rendered text, trimmed. A list keeps
 * its order — a reordered `npcs` IS a change.
 */
function comparable(value: unknown): string {
  return formatPropertyValue(value).trim();
}

/**
 * Only a field that CHANGES is listed — a field repeated verbatim is no
 * decision, and a field the proposal leaves empty is no deletion either (the
 * augmentation rule deletes nothing). The `id` never changes, and `body` is
 * reviewed block by block. `type`, `chapter` and `status` always hold a
 * value, so a proposal for one of them is a `changed` field whose default is
 * to keep the stored one.
 */
export function sceneFieldProposals(
  current: SceneProposal,
  proposed: SceneProposal,
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
