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
// `409 { code: "slug_taken", id, suggestion, path }` and writes nothing —
// deliberately not an automatic `-2`, because the id is permanent. So the
// dialog says what is in the way in German and offers the free proposal as ONE
// click: taking it re-sends the same name with an explicit `id`.

import { toSlug } from "@grimoire/shared/slug";

import { ApiError } from "@/api";
import type { Translate } from "@/i18n/format";

/** The id a typed name will produce ("" when the name yields none). */
export function derivedId(name: string): string {
  return toSlug(name);
}

/**
 * The address the derived id will have — the quiet line under the name field.
 * `undefined` while the name yields no id at all, so the dialog stays silent
 * instead of showing half a path.
 */
export function derivedAddress(name: string, prefix: string): string | undefined {
  const id = derivedId(name);
  return id === "" ? undefined : `${prefix}${id}`;
}

/** What a `slug_taken` 409 carries — the taken id, a free one, and its path. */
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
  if (code !== "slug_taken") return undefined;
  if (typeof id !== "string" || typeof suggestion !== "string" || suggestion === "") {
    return undefined;
  }
  return { id, suggestion, path: typeof path === "string" ? path : "" };
}

/**
 * The sentence a failed create shows, in the UI language (issue #69 — the
 * translator is PASSED IN, so this module holds no copy of its own). The
 * server's own message is still used for the two cases where it KNOWS more
 * than the client (the collision and the 400 for a name that yields no id —
 * both naming the value); everything else degrades to "not created", because
 * a stack detail in a dialog helps nobody.
 *
 * Those two server sentences are still German whatever the UI language is —
 * server strings get stable `code`s in Scheibe 3 of #69, and only then can
 * the app render them from the catalog.
 */
export function createErrorMessage(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) return t("create.failed");
  const message = typeof error.details.error === "string" ? error.details.error : "";
  if ((error.status === 409 || error.status === 400) && message !== "") return message;
  return t("create.failed");
}

/** A create may run once the required field carries a derivable name. */
export function canCreate(name: string): boolean {
  return derivedId(name) !== "";
}
