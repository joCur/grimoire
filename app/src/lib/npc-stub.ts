// "Stub anlegen" from a missing-NPC placeholder (issue #26).
//
// The card's action has ONE goal: after it, npcs/<id>.md exists. So a 409
// ("slug exists") is the goal state, not a failure — the placeholder was
// simply looking at a stale 404 (someone else created the file, another tab,
// the generator). The caller reloads the file either way; only a `undefined`
// return says "nothing was written by us".

import { ApiError, createNpcStub } from "@/api";
import type { FileResponse } from "@grimoire/shared/types";

export async function ensureNpcStub(
  campaign: string,
  id: string,
): Promise<FileResponse | undefined> {
  try {
    return await createNpcStub(campaign, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return undefined;
    throw error;
  }
}
