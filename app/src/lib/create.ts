// Pure half of the create surfaces — what the create dialogs compute before
// and after the POST. No react, no query imports.
//
// The dialogs only ever ask a NAME (plus, for a chapter and a campaign, an
// optional description). The id the format needs is DERIVED from that name
// with the one slug rule (`@grimoire/shared/slug`), and it is shown while
// typing: an id is the permanent reference key, so the DM sees the one they
// are about to create rather than discovering it later. Overriding that
// derivation by hand is the id line's own business (lib/id-field.ts).
//
// The interesting case is the collision. The server answers
// `409 { code: "slug_taken", kind, id, suggestion }` and writes nothing —
// deliberately not an automatic `-2`, because the id is permanent. So the
// dialog says what is in the way and offers the free proposal as ONE click:
// taking it re-sends the same name with an explicit `id`. The SENTENCE comes
// from the app's catalog via the code (i18n/server-errors.ts) — the server is
// language-free.

import { toSlug } from "@grimoire/shared/slug";

import { ApiError } from "@/api";
import type { Translate } from "@/i18n/format";
import { serverErrorMessage } from "@/i18n/server-errors";

/** The id a typed name will produce ("" when the name yields none). */
export function derivedId(name: string): string {
  return toSlug(name);
}

/** What a slug 409 carries — the taken id and a free one. */
export interface CreateConflict {
  id: string;
  suggestion: string;
}

/**
 * The collision behind a failed create, or undefined for every other error.
 * Read defensively: this is a wire body, and a server that answers 409 without
 * a usable `suggestion` must not produce a button that sends nothing.
 */
export function createConflict(error: unknown): CreateConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const { code, id, suggestion } = error.details;
  if (code !== "slug_taken") return undefined;
  if (typeof id !== "string" || typeof suggestion !== "string" || suggestion === "") {
    return undefined;
  }
  return { id, suggestion };
}

/**
 * The sentence a failed create shows, in the UI language — the translator is
 * PASSED IN, so this module holds no copy of its own.
 *
 * The cases where the SERVER knows more than the client — the collision and
 * the 400 for a name that yields no id — are rendered from its
 * error `code` through the catalog (i18n/server-errors.ts), which also carries
 * the degrade to the body's English text for a code this app does not know.
 * A 500 or a dead socket gets the generic "not created" sentence: a stack
 * detail in a dialog helps nobody.
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
