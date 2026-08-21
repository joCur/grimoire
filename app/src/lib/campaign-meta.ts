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

import type { FileResponse } from "@grimoire/shared/types";

import { createCampaignMeta, fetchFile, patchFrontmatter } from "@/api";
// The conflict message is the app's ONE wording for "the file moved under
// you" — it lives with the scene-status write flow that first needed it.
import { STALE_FILE_MESSAGE, isStaleFileError } from "@/lib/scene-status";

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

export type CampaignMetaWriteResult =
  /** Written: the server's fresh file, ready to seed into the query cache. */
  | { ok: true; file: FileResponse }
  /**
   * NOT written — the file changed on disk (or appeared while the dialog was
   * open). `file` is the re-read file when the reload worked; its mtime makes
   * the next attempt succeed.
   */
  | { ok: false; file?: FileResponse };

export { STALE_FILE_MESSAGE };

/**
 * Save name/description. `mtimeMs` is the mtime of the `_campaign.md` the
 * dialog is showing — `undefined` means there is no file yet, which is the
 * create path. A 409 from either endpoint means nothing was written; the file
 * is re-read so the next attempt carries the truth. Everything else throws.
 */
export async function writeCampaignMeta(
  campaign: string,
  values: CampaignMetaValues,
  mtimeMs: number | undefined,
): Promise<CampaignMetaWriteResult> {
  try {
    const description = values.description.trim();
    const file =
      mtimeMs === undefined
        ? await createCampaignMeta(campaign, values.name.trim(), description)
        : await patchFrontmatter(campaign, {
            path: CAMPAIGN_META_PATH,
            mtimeMs,
            patch: campaignMetaPatch(values),
          });
    return { ok: true, file };
  } catch (error) {
    if (!isStaleFileError(error)) throw error;
    try {
      return { ok: false, file: await fetchFile(campaign, CAMPAIGN_META_PATH) };
    } catch {
      // The reload failed too (server gone): the conflict message stands.
      return { ok: false };
    }
  }
}
