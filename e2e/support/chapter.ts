// A chapter in the suite: its resource `…/chapters/:id` (ADR #31), every field
// flat, `body` among them, beside its guard. Its type is the one
// `@grimoire/shared/chapter` derives from the chapter's schema.

import type { Chapter, ChapterChange } from "@grimoire/shared/chapter";
import { exists, underCampaign, type Api } from "./api";

/** The request path of one chapter, or, without an id, of the chapter list. */
export function chapterPath(api: Api, id?: string): string {
  return id === undefined ? underCampaign(api, "chapters") : underCampaign(api, "chapters", id);
}

/** GET one chapter from its own resource; throws when it is unknown. */
export function getChapter(api: Api, id: string): Promise<Chapter> {
  return api.get<Chapter>(chapterPath(api, id));
}

/** Whether the campaign has a chapter with that id (404 = no). */
export function chapterExists(api: Api, id: string): Promise<boolean> {
  return exists(api, chapterPath(api, id));
}

/**
 * The ONE write of a chapter: PATCH its resource with `rev` and any subset of
 * its fields, `body` among them. Omitted, `rev` is read first — the helper
 * then plays the second writer.
 */
export async function patchChapter(
  api: Api,
  id: string,
  change: ChapterChange & { rev?: number; force?: boolean },
): Promise<Chapter> {
  const rev = change.rev ?? (await getChapter(api, id)).rev;
  return api.send<Chapter>("PATCH", chapterPath(api, id), { ...change, rev });
}
