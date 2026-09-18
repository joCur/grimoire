// Campaign name and description from the UI — the rules behind the edit dialog
// of the campaign entry.
//
// The write is the shared editing session (lib/use-entry-edit.ts): both values
// are properties of the campaign entry, so one guarded PATCH carries them.
// Every campaign HAS that entry (it is the campaign row), so reading it always
// answers with values and a version — there is no "create" case.
//
// Everything here is pure, so the rules are unit-testable.

/** Address of the campaign entry. */
export const CAMPAIGN_META_PATH = "campaign";

export interface CampaignMetaValues {
  name: string;
  description: string;
}

/**
 * The properties patch. A description that is blank after trimming DELETES
 * the key (`null`) instead of writing an empty string — an empty value would
 * show up as an empty subtitle line.
 */
export function campaignMetaPatch(values: CampaignMetaValues): Record<string, unknown> {
  const description = values.description.trim();
  return {
    name: values.name.trim(),
    description: description === "" ? null : description,
  };
}

/** The name carries the campaign — an empty one is not a save. */
export function canSubmitCampaignMeta(values: CampaignMetaValues): boolean {
  return values.name.trim() !== "";
}

/**
 * The name to PREFILL the dialog with. A stored name that is literally the id
 * is what an UNNAMED campaign looks like — the server synthesizes the id as
 * the display name so every surface has something to show (`GET /campaigns`
 * and `GET /entry` agree on that since #62). The dialog must not propose it as
 * an authored value, so it starts empty with the id as the placeholder.
 */
export function prefillCampaignName(campaign: string, name: string | undefined): string {
  if (name === undefined || name === campaign) return "";
  return name;
}

