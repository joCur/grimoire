// The helpers of the store that have no domain of their own.
//
// The 400 of a request an entity's zod schema refuses, the append order of a
// row, the closed-field and reference 400s, the `rev` guard's 409, the stored
// form of a body and the ids a create endpoint hands out. None of them
// touches the database, so this module imports nothing from the store.

import type { z } from "zod";
import {
  CHAPTER_STATUSES,
  ENTITY_SLUG,
  NPC_STATUSES,
  SCENE_STATUSES,
  SCENE_TYPES,
  toSlug,
  type ErrorCode,
  type ErrorField,
  type ErrorKind,
} from "@grimoire/shared";
import { ApiError } from "../api-error";

// --- a request an entity's schema refuses -------------------------------------

/**
 * Parse a request body with an entity's zod schema (ADR #31) — or answer 400.
 * The message names every issue with its field (`name: Invalid input: …`, an
 * unknown key by its name), in English like every technical fallback.
 */
export function parseRequest<T extends z.ZodType>(schema: T, raw: unknown, what: string): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) =>
    issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
  );
  throw new ApiError(400, `invalid ${what} — ${issues.join("; ")}`);
}

// --- the stored form of a body -----------------------------------------------

/**
 * A non-empty body gets its closing newline. The text is handed to a
 * markdown editor and to the generator's prompt, and a body without its
 * final newline makes the next appended section run into the last line.
 * EXISTING trailing newlines are left alone, so a read/write roundtrip
 * changes nothing; an empty body stays empty.
 */
export function normalizeBody(markdown: string): string {
  return markdown === "" || markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

// --- append order of a row ---------------------------------------------------

export function nextPos(rows: Array<{ pos: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.pos), -1) + 1;
}

// --- closed fields -----------------------------------------------------------

/**
 * A CLOSED field a write may carry: one of the shared list, or nothing
 * (`null` clears the field — which for a chapter removes the status).
 *
 * These are the fields the format's degrade rule does not extend to on the
 * API. A value outside the list is still RENDERED verbatim wherever an older
 * database holds one, but the columns themselves are closed (ADR #25), so a
 * foreign value arriving on the wire can only be a typo — and the honest
 * answer to a typo is the 400 with a code the app has a sentence for, not
 * SQLite's "CHECK constraint failed" escaping as a 500.
 */
export function assertClosedValue(
  fields: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  code: ErrorCode,
  details: Record<string, unknown> = {},
): void {
  if (!(key in fields)) return;
  const value = fields[key];
  if (value === null || value === undefined) return;
  if (typeof value === "string" && allowed.includes(value)) return;
  throw new ApiError(400, `invalid ${key}: ${String(value)} — one of ${allowed.join(", ")}`, {
    code,
    value: String(value),
    allowed: [...allowed],
    ...details,
  });
}

/**
 * The chapter's one closed field. That at most ONE chapter holds `active` is
 * a rule across rows, so it lives with the chapters (./chapters.ts).
 */
export function assertChapterStatus(fields: Record<string, unknown>): void {
  assertClosedValue(fields, "status", CHAPTER_STATUSES, "status_not_allowed", { kind: "chapter" });
}

/** A scene's two closed fields. */
export function assertSceneClosedFields(fields: Record<string, unknown>): void {
  assertClosedValue(fields, "status", SCENE_STATUSES, "status_not_allowed", { kind: "scene" });
  assertClosedValue(fields, "type", SCENE_TYPES, "scene_type_not_allowed");
}

/** The npc's one closed field. */
export function assertNpcStatus(fields: Record<string, unknown>): void {
  assertClosedValue(fields, "status", NPC_STATUSES, "status_not_allowed", { kind: "npc" });
}

// --- references that name nothing --------------------------------------------

/**
 * The 400 a reference that names nothing answers — one shape for all of
 * them. `code` is the contract (`@grimoire/shared/error-codes`); the app
 * builds the sentence the DM reads from it and the `value`, and the English
 * text here is the technical fallback.
 */
export function unknownRef(code: ErrorCode, kind: string, value: string): ApiError {
  return new ApiError(400, `unknown ${kind}: ${value} — create it first`, { code, value });
}

// --- the rev guard -----------------------------------------------------------

/**
 * The optimistic-concurrency check: the row's `rev` must be the one read.
 *
 * The body carries `code: "rev_conflict"` — `what` names WHICH row moved
 * and stays English, as the technical fallback next to it. `current` is the
 * token to retry with, and `stored` is that row as it stands now, under the
 * key of its kind (`{ chapter }` for a chapter, `{ npc }` for an npc, …), so
 * the conflict dialog can show what is in the way without a second request.
 */
export function revConflict(
  current: number,
  what: string,
  stored: Record<string, unknown> = {},
): ApiError {
  return new ApiError(409, `${what} — reload before saving`, {
    code: "rev_conflict",
    rev: current,
    ...stored,
  });
}

export function guardRev(current: number, sent: number, what: string): void {
  if (current !== sent) throw revConflict(current, what);
}

// --- a chapter id ------------------------------------------------------------

/** A chapter id must be one non-hidden path segment (like a campaign id). */
export function assertSafeChapterId(chapter: string): void {
  if (
    chapter.length === 0 ||
    chapter.startsWith(".") ||
    chapter.includes("/") ||
    chapter.includes("\\") ||
    chapter.includes("\0") ||
    chapter.includes("..")
  ) {
    throw new ApiError(400, "invalid chapter");
  }
}

// --- creating content --------------------------------------------------------
//
// Five endpoints bring a row into existence on purpose — campaign, chapter,
// scene, npc and location, each in its own domain module. The 409s and the id
// derivation they share are here, and so are the rules behind them.
//
// THE THREE RULES they all share, and they are the whole design:
//
//   1. THE DM TYPES A NAME, NOT AN ID. An id is derived from it with the one
//      slug rule (`@grimoire/shared/slug` — the app derives the same one and
//      shows it, so nothing is a surprise). An id is never invented: a title
//      that yields no slug at all (only punctuation, or a script no fold maps
//      into a-z0-9) is a 400 that says so, because guessing "eintrag-1" would
//      put an unfindable key into the format's most permanent field.
//   2. A TAKEN ID IS A 409 WITH A FREE PROPOSAL. Not an automatic `-2`: the
//      id is the permanent reference key, so the DM decides — either the
//      proposal or another name. The body carries `code: "slug_taken"`, the
//      entity `kind` as a stable token, the colliding `id` (so the app can
//      link to what is there) and `suggestion`. The SENTENCE the DM reads is
//      the app's — what is here is its English fallback.
//   3. A NEW ROW HOLDS ONLY WHAT WAS TYPED. Everything else keeps its column
//      default, so scaffolding nobody asked for (a heading, an empty section)
//      cannot appear. A chapter's optional `body` is typed, too: it becomes
//      the chapter's text as it stands, without a heading around it.
//
// AN EMPTY NPC OR LOCATION IS FILLED, NOT COLLIDED WITH — the two entities
// that have an empty state at all. One that holds nothing but its id is one
// the DM created and did not fill in, and creating exactly that id again is
// what fills it. The generator's accept follows the same rule.
//
// …but only for the id the DM TYPED. An empty npc is empty, not unclaimed: a
// scene may reference it, so the id is already spoken for. Filling it is
// therefore the DM's own decision about that one id, never something a
// machine-made PROPOSAL may slide into: rule 2's `suggestion` skips every
// existing row, empty ones included, so "Holm" next to a filled `holm` and
// an empty `holm-2` proposes `holm-3` — while typing "Holm 2" still fills
// `holm-2`.
//

/**
 * The `slug_taken` 409 — see rule 2 above.
 *
 * `kind` is a stable TOKEN (`@grimoire/shared/error-codes`, ErrorKind), not a
 * label: the sentence the DM reads is built by the app from its own catalog in
 * the UI language. The `error` text here is the English technical
 * fallback that curl, the log and an unknown-code client get. What is in the
 * way is named by `kind` and `id`: each entity is its own resource (ADR #31).
 */
export function slugTaken(kind: ErrorKind, id: string, suggestion: string): ApiError {
  return new ApiError(409, `${kind} "${id}" already exists — suggestion: "${suggestion}"`, {
    code: "slug_taken",
    kind,
    id,
    suggestion,
  });
}

/**
 * The id of a new row: the caller's own `id` when it sent one, else the slug
 * of the typed name. `field` is the TOKEN of the input that has to change
 * (`name` or `title`), so the app's 400 sentence can point at it in the UI
 * language.
 *
 * An EXPLICIT id serves two callers, and it means the same thing to both: the
 * DM decided this id, so nothing derives one for them.
 *
 *   - the `slug_taken` 409 hands the app a free `suggestion`, and taking that proposal is one click rather than "now
 *     think of a different name".
 *   - the create dialog's id field, where the DM sets the id instead of
 *     accepting the one the name yields. This is the only moment an id is
 *     chosen (ADR #21 — no endpoint ever changes one).
 *
 * Either way it is taken verbatim — no derivation, no fallback — and has to be
 * a slug, because it lands in the format's one permanent field. A typed id
 * that is already taken comes back as the same 409 as any other collision, so
 * the two callers close a loop rather than needing separate handling here.
 */
export function resolveNewId(
  explicit: string | undefined,
  name: string,
  kind: ErrorKind,
  field: ErrorField,
): string {
  if (explicit !== undefined) {
    if (!ENTITY_SLUG.test(explicit)) {
      throw new ApiError(400, "id must be a kebab-case slug (a-z, 0-9, single dashes)");
    }
    return explicit;
  }
  const id = toSlug(name);
  if (id === "") {
    throw new ApiError(400, `the ${field} yields no id — use letters or digits`, {
      code: "slug_empty",
      kind,
      field,
    });
  }
  return id;
}
