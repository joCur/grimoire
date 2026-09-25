// A location's augment proposal, field by field (ADR #31): what the model
// changes against the location as the run read it. Pure, so the rule is
// unit-testable.

import type { LocationProposal } from "@grimoire/shared/types";

import type { FieldProposal } from "@/lib/augment";

/** "No value here" — an absent field or blank text. */
function isEmptyText(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * Only a field that CHANGES is listed — a field repeated verbatim is no
 * decision, and a field the proposal leaves empty is no deletion either (the
 * augmentation rule deletes nothing). The `id` never changes, and `body` is
 * reviewed block by block.
 */
export function locationFieldProposals(
  current: LocationProposal,
  proposed: LocationProposal,
): FieldProposal[] {
  const { id: _id, body: _body, ...fields } = proposed;
  const out: FieldProposal[] = [];
  for (const [key, value] of Object.entries(fields) as Array<[keyof typeof fields, string | undefined]>) {
    const before = current[key];
    if (isEmptyText(value) || (before ?? "").trim() === (value ?? "").trim()) continue;
    out.push({
      key,
      ...(before === undefined ? {} : { current: before }),
      proposed: value,
      state: isEmptyText(before) ? "new" : "changed",
    });
  }
  return out;
}
