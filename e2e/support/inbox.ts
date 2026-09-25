// The ideas in the suite: `…/inbox`, a list of rows plus the list's own
// guard token (ADR #26).

import type { InboxResponse } from "@grimoire/shared/types";
import { underCampaign, type Api } from "./api";

/** The ideas with the list's guard token. */
export function getInbox(api: Api): Promise<InboxResponse> {
  return api.get<InboxResponse>(underCampaign(api, "inbox"));
}
