// Pure half of "Inhalte anlegen" (issue #56) — what the five create dialogs
// compute before and after the POST. No react, no query imports.
//
// The dialogs themselves only ever ask a NAME (plus a chapter for a scene and
// an optional goal for a chapter). The id the format needs is DERIVED from
// that name with the one slug rule (`@grimoire/shared/slug`), and it is shown
// while typing: an id is the permanent reference key, so the DM sees the one
// they are about to create rather than discovering it later in an address.
//
// The interesting case is the collision. The server answers
// `409 { code: "slug_taken" | "slug_reserved", kind, id, suggestion, path }`
// and writes nothing — deliberately not an automatic `-2`, because the id is
// permanent. So the dialog says what is in the way and offers the free
// proposal as ONE click: taking it re-sends the same name with an explicit
// `id`. The SENTENCE comes from the app's catalog via the code (issue #69,
// i18n/server-errors.ts) — the server is language-free.

import { toSlug } from "@grimoire/shared/slug";

import { ApiError } from "@/api";
import type { Translate } from "@/i18n/format";
import { serverErrorMessage } from "@/i18n/server-errors";

/** The id a typed name will produce ("" when the name yields none). */
export function derivedId(name: string): string {
  return toSlug(name);
}

/** What a slug 409 carries — the taken id, a free one, and its path. */
export interface CreateConflict {
  id: string;
  suggestion: string;
  path: string;
}

/**
 * The collision behind a failed create, or undefined for every other error.
 * Read defensively: this is a wire body, and a server that answers 409 without
 * a usable `suggestion` must not produce a button that sends nothing.
 */
export function createConflict(error: unknown): CreateConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const { code, id, suggestion, path } = error.details;
  // Both slug 409s offer the same interaction — a sentence plus one click on
  // the free proposal. Only the sentence differs, and that is the catalog's
  // job (i18n/server-errors.ts), not this function's.
  if (code !== "slug_taken" && code !== "slug_reserved") return undefined;
  if (typeof id !== "string" || typeof suggestion !== "string" || suggestion === "") {
    return undefined;
  }
  return { id, suggestion, path: typeof path === "string" ? path : "" };
}

/**
 * The sentence a failed create shows, in the UI language (issue #69 — the
 * translator is PASSED IN, so this module holds no copy of its own).
 *
 * The cases where the SERVER knows more than the client — the collision, the
 * reserved name, the 400 for a name that yields no id — are rendered from its
 * error `code` through the catalog (i18n/server-errors.ts), which also carries
 * the degrade to the body's English text for a code this app does not know.
 * A 500 or a dead socket gets the generic „Nicht angelegt": a stack detail in
 * a dialog helps nobody.
 */
export function createErrorMessage(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) return t("create.failed");
  if (error.status !== 409 && error.status !== 400) return t("create.failed");
  return serverErrorMessage(error, t, "create.failed");
}

/** A create may run once the required field carries a derivable name. */
export function canCreate(name: string): boolean {
  return derivedId(name) !== "";
}
