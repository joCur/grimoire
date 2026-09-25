// Campaign-id hygiene: the guard the store runs before it looks a campaign
// up.
//
// A campaign id is a string the CLIENT sends, and even though it resolves to
// a row it must stay a single non-hidden segment: rejecting `..`, separators,
// backslashes and NUL early keeps a hostile value from ever reaching a
// query. It throws ApiError(400).

import { ApiError } from "./api-error";

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

/**
 * A campaign id must be a single, non-hidden path segment. Rejects `..`,
 * separators, backslashes and anything else that is a traversal attempt
 * rather than an id. (Hono decodes the URL param, so encoded traversal like
 * %2e%2e arrives here as the literal characters and is caught too.)
 */
export function assertSafeCampaignId(id: string): void {
  if (
    id.length === 0 ||
    isHidden(id) ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0") ||
    id === ".." ||
    id.includes("..")
  ) {
    throw new ApiError(400, "invalid campaign id");
  }
}
