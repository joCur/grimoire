// Path safety for the addressing layer — all that is left of the pre-database
// read API (issues #57/#62).
//
// Three things live here, and nothing else: `ApiError`, the error type every
// route maps to a JSON body, and the two guards the store runs before it looks
// a row up. The file readers this module used to hold (campaignDir, buildTree,
// readParsedFile, the session scan, the tree walker, collectCampaignFiles) are
// gone with issue #62 — the store answers every endpoint from the database,
// and CAMPAIGN_ROOT is read by exactly one place left in the server: the
// one-time import (db/migrate-campaigns.ts, reached through `grimoire seed`
// and the first boot).
//
// The guards still matter after the cutover. A campaign id and a document path
// are ADDRESSES the client sends, and even though they now resolve to rows
// instead of files they must stay a single non-hidden segment / a relative
// `.md` path: the rules are the addressing contract the store's
// `locatorFromPath` is written against, and rejecting `..`, absolute paths,
// backslashes and NUL early keeps a hostile path from ever reaching a query.
// Both throw ApiError(400).

/**
 * Error with an HTTP status; route handlers map it to a JSON error body.
 * `extra` is merged into the body next to `error` (e.g. the current mtimeMs
 * on a 409 conflict).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// --- path safety -------------------------------------------------------------

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

/**
 * Lexical validation of a campaign-relative document path. Rejects absolute
 * paths (POSIX and Windows-style), backslashes, `..`/`.` segments, hidden
 * segments, and non-.md targets. Encoded traversal is already decoded by the
 * time the query value gets here, so it hits the same checks.
 */
export function assertSafeRelativeMdPath(rel: string): void {
  if (rel.length === 0) throw new ApiError(400, "missing path");
  if (rel.includes("\\") || rel.includes("\0")) throw new ApiError(400, "invalid path");
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) {
    throw new ApiError(400, "absolute paths are not allowed");
  }
  const segments = rel.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") throw new ApiError(400, "invalid path");
    if (isHidden(seg)) throw new ApiError(400, "invalid path");
  }
  if (!rel.endsWith(".md")) throw new ApiError(400, "only .md files are served");
}
