// The form of the campaign — what its edit dialog starts with and the write a
// save sends. Pure, so every rule is unit-testable.
//
// Only what the DM CHANGED is written: a field nobody touched keeps its stored
// value, so a forced save after a conflict cannot reset a field somebody else
// just wrote. A description left blank clears it (`null`) instead of writing
// an empty line; a text left blank is stored as the empty string. The name
// carries the campaign, so a blank name is no save.

import type { Campaign, CampaignChange } from "@grimoire/shared/campaign";

import { textValue } from "@/components/fields/text";

/**
 * The form's values, one text per field — typed against the campaign, so a
 * field the form does not handle does not compile. `id` is fixed at creation
 * (ADR #21), and `glossaryIntro` — the prose above the glossary terms — is
 * not a field of this dialog.
 */
export type CampaignFormValues = {
  [K in Exclude<keyof Campaign, "id" | "rev" | "glossaryIntro">]-?: string;
};

/**
 * The name to PREFILL the dialog with. A stored name that is literally the id
 * is what an UNNAMED campaign looks like — the server answers the id as the
 * name so every surface has something to show. The dialog must not propose it
 * as an authored value, so it starts empty with the id as the placeholder.
 */
export function prefillCampaignName(campaign: string, name: string | undefined): string {
  if (name === undefined || name === campaign) return "";
  return name;
}

/** What the form starts with — the campaign's current values. */
export function campaignFormValues(campaign: Campaign): CampaignFormValues {
  return {
    name: prefillCampaignName(campaign.id, campaign.name),
    description: campaign.description ?? "",
    body: campaign.body,
  };
}

/**
 * The text a save writes: trimmed, ending in exactly one newline, and the
 * empty string when nothing is left — the overview reads "" as "no text",
 * where whitespace would render as an empty block.
 */
export function campaignBodyToWrite(body: string): string {
  const trimmed = body.trim();
  return trimmed === "" ? "" : `${trimmed}\n`;
}

/** The write: ONLY the fields that moved; a blank name is left out. */
export function campaignFormChange(
  initial: CampaignFormValues,
  values: CampaignFormValues,
): CampaignChange {
  const change: CampaignChange = {};
  const name = textValue(values.name);
  if (name !== textValue(initial.name) && name !== null) change.name = name;
  const description = textValue(values.description);
  if (description !== textValue(initial.description)) change.description = description;
  const body = campaignBodyToWrite(values.body);
  if (body !== campaignBodyToWrite(initial.body)) change.body = body;
  return change;
}

/** The name carries the campaign — a blank one is not a save. */
export function canSubmitCampaignForm(values: CampaignFormValues): boolean {
  return textValue(values.name) !== null;
}
