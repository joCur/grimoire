// The helpers of the store that have no domain of their own.
//
// Value coercions for hand-editable properties, the closed-field and
// reference 400s, the `rev` guard's 409, the chronological order of two
// sessions and the ids a create endpoint hands out. Every one of them is
// needed by two or more domain modules and none of them touches the
// database, so this module imports nothing from the store.

import {
  CHAPTER_STATUSES,
  ENTITY_SLUG,
  NPC_STATUSES,
  SCENE_STATUSES,
  SCENE_TYPES,
  toSlug,
  type EntryResponse,
  type ErrorCode,
  type ErrorField,
  type ErrorKind,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import { localDateTimeToMs } from "./time";
import type { SessionRow } from "./render";

// --- defensive coercions (properties is hand-edited) ------------------------

export function asOptStr(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function asStr(value: unknown, fallback = ""): string {
  return asOptStr(value) ?? fallback;
}

export function asStrArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v) => v !== undefined && v !== null).map((v) => String(v));
}

export function asMap(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// --- append order of a list row ----------------------------------------------

export function nextPos(rows: Array<{ pos: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.pos), -1) + 1;
}

// --- closed fields -----------------------------------------------------------

/**
 * A CLOSED field a write may carry: one of the shared list, or nothing
 * (`null` deletes the key — which for a chapter removes the status and for a
 * scene or an npc falls back to the column's default).
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

/** The chapter's one closed field. That at most ONE chapter holds `active` is
 * a rule across rows, so it lives with the chapters (./chapters.ts). */
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
 * The body carries `code: "rev_conflict"` — `what` names WHICH entry moved
 * and stays English, as the technical fallback next to it. `current` is the
 * token to retry with, and `entry` is that entry as it stands now, so the
 * conflict dialog can show what is in the way without a second request.
 */
export function revConflict(current: number, what: string, entry?: EntryResponse): ApiError {
  return new ApiError(409, `${what} — reload before saving`, {
    code: "rev_conflict",
    rev: current,
    ...(entry === undefined ? {} : { entry }),
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

// --- the chronological order of two sessions ---------------------------------

// Two lists are ordered by it — the sessions of a campaign (./sessions.ts) and
// the campaign list's "last session" (./campaigns.ts) — so the rule lives
// here rather than in either of them.

/** The only three session columns the ordering rule below looks at. */
export type SessionOrderFields = Pick<SessionRow, "id" | "started" | "createdAt">;

/**
 * Chronological order key of a session in epoch milliseconds, or undefined
 * when the row says nothing usable about WHEN it started.
 *
 * `started` is the ONLY source. The id is an opaque random string
 * (db/schema.ts) and there is nothing in it to read, so a row without a
 * usable `started` wins nothing.
 *
 * Takes only the columns it reads, so callers that need nothing else of a
 * session (the campaign list) can select just those.
 */
export function sessionOrderKey(row: Pick<SessionOrderFields, "started">): number | undefined {
  return localDateTimeToMs(row.started);
}

/**
 * Newest-first comparator: `started` decides, and `createdAt` — the row's
 * insertion time in milliseconds — breaks the tie. Two sessions of the same
 * evening can share a `started` to the SECOND (start, end, start again), and
 * "the last started one" has to be the second of them, deterministically.
 * The opaque id cannot say which came first, so the row records it.
 *
 * Last resort for two rows that share both (migrated rows carry `createdAt`
 * 0): a plain string compare of the ids. Which of them then counts as newer
 * is arbitrary — but it is STABLE, and that is the property callers need.
 */
export function compareSessionsNewestFirst(
  a: SessionOrderFields,
  b: SessionOrderFields,
): number {
  const ka = sessionOrderKey(a) ?? -Infinity;
  const kb = sessionOrderKey(b) ?? -Infinity;
  if (ka !== kb) return kb - ka;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// --- creating content --------------------------------------------------------
//
// Five endpoints bring a row into existence on purpose — campaign, chapter,
// scene, npc and ort, each in its own domain module. The 409s and the id
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
//      entity `kind` as a stable token, the colliding `id`, its `path` (so the
//      app can link to what is there) and `suggestion`. The SENTENCE the DM
//      reads is the app's — what is here is its English fallback.
//   3. A NEW ROW HOLDS ONLY WHAT WAS TYPED. Everything else keeps its column
//      default, so `## Notizen`-style scaffolding nobody asked for cannot
//      appear. The only exception is a chapter's optional goal, which goes
//      into the section the chapter overview reads it from (`## Ziel des Kapitels`).
//
// EMPTY ENTRIES ARE FILLED, NOT COLLIDED WITH — for npc and ort, the two kinds
// that have an empty state at all. An entry that holds nothing but its id is
// one the DM created and did not fill in, and the npc-create action for
// exactly that id is what fills it. That is the same rule `createNpcStub` and the
// generator's apply step follow.
//
// …but only for the id the DM TYPED. An empty entry is empty, not unclaimed: a
// scene may reference it, so the id is already spoken for. Filling it is
// therefore the DM's own decision about that one id, never something a
// machine-made PROPOSAL may slide into: rule 2's `suggestion` skips every
// existing entry, empty ones included, so "Holm" next to a filled `holm` and
// an empty `holm-2` proposes `holm-3` — while typing "Holm 2" still fills
// `holm-2`.
//
// RESERVED IDS ARE NOT CREATABLE. `npcs`, `locations` and `sessions` are the
// address schema's first segments (store/paths, RESERVED_SEGMENTS), so a
// chapter with one of those ids would be a row whose own entry and scenes
// resolve to an entity kind instead — created, then unreachable forever. It is
// answered like a collision (same 409 shape, same one-click proposal) under its
// own code `slug_reserved`, because from the dialog's side it is the same
// situation — only the reason differs, and the reason is what the app says.

/**
 * The `slug_taken` 409 — see rule 2 above.
 *
 * `kind` is a stable TOKEN (`@grimoire/shared/error-codes`, ErrorKind), not a
 * label: the sentence the DM reads is built by the app from its own catalog in
 * the UI language. The `error` text here is the English technical
 * fallback that curl, the log and an unknown-code client get.
 */
export function slugTaken(kind: ErrorKind, id: string, suggestion: string, path: string): ApiError {
  return new ApiError(409, `${kind} "${id}" already exists — suggestion: "${suggestion}"`, {
    code: "slug_taken",
    kind,
    id,
    suggestion,
    path,
  });
}

/**
 * The reserved-id 409. Its own code — the app's collision
 * handling (lib/create.ts) treats it exactly like a taken id (one sentence
 * plus the free proposal as one click), but the SENTENCE is a different one
 * (the id is a reserved name), and a catalog cannot say that from a code
 * that also means "somebody else has it". `path` is "" because nothing is in
 * the way; there is no entry to link to.
 */
export function slugReserved(kind: ErrorKind, id: string, suggestion: string): ApiError {
  return new ApiError(409, `"${id}" is a reserved name — suggestion: "${suggestion}"`, {
    code: "slug_reserved",
    kind,
    id,
    suggestion,
    path: "",
  });
}

/**
 * The id of a new row: the caller's own `id` when it sent one, else the slug
 * of the typed name. `field` is the TOKEN of the input that has to change
 * (`name` or `title`), so the app's 400 sentence can point at it in the UI
 * language.
 *
 * An EXPLICIT id exists for exactly one flow: the `slug_taken` 409 hands the
 * app a free `suggestion`, and "diesen Vorschlag nehmen" has to be one click
 * rather than "now think of a different name". It is taken verbatim — no
 * derivation, no fallback — and has to be a slug, because it lands in the
 * format's one permanent field.
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
