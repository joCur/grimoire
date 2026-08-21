// Campaign metadata from the UI (issue #34, first small slice of the #15
// territory): name + description of `_campaign.md`.
//
// Two write paths, one dialog:
//
//   file exists  -> PATCH /frontmatter with the mtime the dialog read, so an
//                   external edit cannot be overwritten silently (409)
//   file missing -> POST /campaign-meta, which creates it with the directory
//                   name as `id` (the server never takes an id from us)
//
// Everything here is pure or a plain API call — no react, no query imports,
// so the rules are unit-testable.

import { createCampaignMeta, fetchFile, patchFrontmatter } from "@/api";
import { writeWithMtime, type MtimeWriteResult } from "@/lib/write-with-mtime";

/** Campaign-relative path of the metadata file (server: CAMPAIGN_FILE). */
export const CAMPAIGN_META_PATH = "_campaign.md";

export interface CampaignMetaValues {
  name: string;
  description: string;
}

/**
 * The frontmatter patch for an existing file. A description that is blank
 * after trimming DELETES the key (`null`) instead of writing an empty
 * string — an empty value would show up as an empty subtitle line.
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
 * Save name/description. `mtimeMs` is the mtime of the `_campaign.md` the
 * dialog is showing — `undefined` means there is no file yet, which is the
 * create path. A 409 from EITHER endpoint means nothing was written (the file
 * changed on disk, or it appeared while the dialog was open); the shared
 * protocol of write-with-mtime.ts re-reads it so the next attempt carries the
 * truth. Everything else throws.
 */
export function writeCampaignMeta(
  campaign: string,
  values: CampaignMetaValues,
  mtimeMs: number | undefined,
): Promise<MtimeWriteResult> {
  return writeWithMtime(
    () =>
      mtimeMs === undefined
        ? createCampaignMeta(campaign, values.name.trim(), values.description.trim())
        : patchFrontmatter(campaign, {
            path: CAMPAIGN_META_PATH,
            mtimeMs,
            patch: campaignMetaPatch(values),
          }),
    () => fetchFile(campaign, CAMPAIGN_META_PATH),
  );
}
