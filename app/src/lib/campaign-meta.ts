// Campaign metadata from the UI (issue #34, first small slice of the #15
// territory): name + description of `_campaign.md`.
//
// ONE write path since issue #62: PATCH /properties with the guard token the
// dialog read, so an edit that happened meanwhile cannot be overwritten
// silently (409). The second path — POST /campaign-meta for a campaign that
// had no `_campaign.md` yet — is gone with the endpoint: since the cutover
// (#57) every campaign is a ROW, GET /file?path=_campaign.md always answers
// with a document and a token, and there is no "create" case left to serve.
//
// Everything here is pure or a plain API call — no react, no query imports,
// so the rules are unit-testable.

import { fetchFile, patchProperties } from "@/api";
import { writeWithRev, type RevWriteResult } from "@/lib/write-with-rev";

/** Campaign-relative path of the metadata document. */
export const CAMPAIGN_META_PATH = "_campaign.md";

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

/** The version the open dialog writes against. */
export interface CampaignMetaBase {
  rev: number;
}

/** What the file query knows: the document, or nothing yet. */
export type CampaignMetaAnswer = { rev: number } | undefined;

/**
 * Decide the base version ONCE, at the first answer of the file query.
 *
 * The file query keeps refetching while the dialog is open — the 5s version
 * poll (issue #8) invalidates it — so reading its token at save time would let
 * a concurrent edit of the campaign document advance the base silently: the
 * save would overwrite that edit instead of answering 409. Same trap the body
 * editor avoids (see `shouldAdvanceBase` in file-body.ts), same answer: freeze
 * it.
 *
 * `undefined` in, `undefined` out means "no answer yet, nothing to write
 * against". Once frozen the base never moves on its own — only the conflict
 * re-read replaces it, knowingly, in the caller.
 */
export function seedCampaignMetaBase(
  base: CampaignMetaBase | undefined,
  answer: CampaignMetaAnswer,
): CampaignMetaBase | undefined {
  if (base !== undefined) return base;
  if (answer === undefined) return undefined;
  return { rev: answer.rev };
}

/**
 * The name to PREFILL the dialog with. A stored name that is literally the id
 * is what an UNNAMED campaign looks like — the server synthesizes the id as
 * the display name so every surface has something to show (`GET /campaigns`
 * and `GET /file` agree on that since #62). The dialog must not propose it as
 * an authored value, so it starts empty with the id as the placeholder.
 */
export function prefillCampaignName(campaign: string, name: string | undefined): string {
  if (name === undefined || name === campaign) return "";
  return name;
}

/**
 * Save name/description. `rev` is the guard token of the campaign
 * document the dialog is showing. A 409 means nothing was written (it changed
 * meanwhile); the shared protocol of write-with-rev.ts re-reads it so the
 * next attempt carries the truth. Everything else throws.
 */
export function writeCampaignMeta(
  campaign: string,
  values: CampaignMetaValues,
  rev: number,
): Promise<RevWriteResult> {
  return writeWithRev(
    () =>
      patchProperties(campaign, {
        path: CAMPAIGN_META_PATH,
        rev,
        patch: campaignMetaPatch(values),
      }),
    () => fetchFile(campaign, CAMPAIGN_META_PATH),
  );
}
