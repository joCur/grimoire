// The write side of the store: every write endpoint as database statements.
//
// What is UNCHANGED (this is the contract the ported tests pin):
//
//   * the response of every write is still the `EntryResponse` of the row it
//     touched, rendered by ./render;
//   * optimistic concurrency still answers `409 { error, rev }` — only
//     the token behind `rev` is now the row's `rev` instead of a file
//     rev. That is what fixes the same-second race: two writes inside the
//     same second used to see the same rev and both went through; two writes
//     against the same `rev` cannot;
//   * the session state machine keeps its answers and codes
//     (`session_running`, `session_not_empty` — `session_ended` is gone with
//     the resume semantics), and
//     `clock.ts` is untouched — session ids, `started`/`ended` and log times
//     stay zone-less local strings produced by the server;
//   * append-only stays append-only: log lines and inbox entries grow by
//     rows through their own endpoints, and the one documented exception
//     (an inbox entry marked done) is the `done` flag.
//
// What is NEW: a write is one TRANSACTION that also bumps
// `campaigns.version` — the counter `GET /version` answers, which replaced
// the chokidar watcher (DECISIONS #9). Both the content
// change and the version bump commit together, so a client poll can never
// see a bumped version without the change.

import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  CHAPTER_STATUSES,
  ENTITY_SLUG,
  freeSlug,
  isEnded,
  isSessionEmpty,
  toSlug,
  type CampaignSummary,
  type ErrorCode,
  type ErrorField,
  type ErrorKind,
  type EntryResponse,
  type GlossaryResponse,
  type KnowledgeEntry,
  type KnowledgeResponse,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import { assertSafeAddress, assertSafeCampaignId } from "../addressing";
import { localDate, localDateTimeSeconds, localTime, now } from "../clock";
import type { GrimoireDb } from "../db/client";
import { logLineShortHash, parseGlossaryBody } from "./body-parse";
import {
  campaignKnowledge,
  campaigns,
  chapters,
  generateJobs,
  glossary,
  inboxEntries,
  locations,
  logEntries,
  npcs,
  packJson,
  sceneNpcs,
  sceneTags,
  scenes,
  sessionPauses,
  sessionScenesPlayed,
  sessions,

} from "../db/schema";
import { indexEntity } from "./fts";
import { expandBodyRefs, referrersOf, type RefBodyKind } from "./refs";
import { getDb } from "./handle";
import {
  campaignRow,
  glossaryRows,
  inboxRows,
  knowledgeEntry,
  knowledgeRows,
  logRows,
  pauseRows,
  pickSession,
  playedScenes,
  renderSessionRow,
  requireCampaign,
  sessionRow,
} from "./read";
import {
  addressIdentity,
  chapterPath,
  locationPath,
  locatorFromPath,
  npcPath,
  RESERVED_SEGMENTS,
  sceneAddress,
  scenePath,
  sessionPath,
  CAMPAIGN_PATH,
  type Locator,
} from "./paths";
import {
  campaignDisplayName,
  renderCampaign,
  renderChapter,
  renderGlossary,
  renderInbox,
  renderLocation,
  renderNpc,
  renderScene,
  type CampaignRow,
  type ChapterRow,
  type LocationRow,
  type NpcRow,
  type SceneRow,
  type SessionRow,
} from "./render";

export { logLineShortHash };

// --- chapter status ----------------------------------------------------------

/**
 * The ONE chapter status the app acts on (the overview's control, the session
 * view's „which chapter is running"). There is at most one per campaign, and
 * every write that sets it clears the previous one in the same transaction.
 */
const CHAPTER_ACTIVE = "active";

/**
 * Where a chapter starts, and where the swap puts the one it takes `active`
 * from. Not NULL: the overview renders a chapter's status and nothing renders
 * nothing, so a chapter without one would look less planned than its
 * siblings. A NULL only survives on an older chapter, which the app reads as
 * `planned`.
 */
const CHAPTER_PLANNED = "planned";

/**
 * Take `active` off every OTHER chapter of the campaign — the swap half of
 * „exactly one active chapter".
 *
 * Both writes that can set `active` call this inside their own transaction:
 * `POST /chapters/:id/active` (the overview's status control) and a
 * `PATCH /properties` whose status ends up `active` (the chapter properties
 * dialog). The invariant belongs to the COLUMN, not to one endpoint —
 * otherwise the dialog is a second door past it.
 */
function clearOtherActiveChapters(tx: GrimoireDb, campaign: string, keep: string): void {
  const previous = tx
    .select()
    .from(chapters)
    .where(and(eq(chapters.campaignId, campaign), eq(chapters.status, CHAPTER_ACTIVE)))
    .all() as ChapterRow[];
  for (const row of previous) {
    if (row.id === keep) continue;
    tx.update(chapters)
      .set({ status: CHAPTER_PLANNED, rev: row.rev + 1 })
      .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, row.id)))
      .run();
  }
}

/**
 * A chapter status a WRITE may carry: one of the known trio, or nothing
 * (`null` deletes the key, which is how a chapter loses its status).
 *
 * This is the one place the format's degrade rule does not extend to the API.
 * A stored value outside the trio is still shown verbatim — the overview's
 * control shows it and the reading view prints it, exactly like an unknown
 * scene status — but the chapter status has three positions now, so a fourth
 * value arriving on the wire can only be a typo, and the honest answer to a
 * typo is the 400.
 */
function assertChapterStatus(patch: Record<string, unknown>): void {
  if (!("status" in patch)) return;
  const value = patch.status;
  if (value === null || value === undefined) return;
  if (typeof value === "string" && (CHAPTER_STATUSES as readonly string[]).includes(value)) return;
  throw new ApiError(
    400,
    `invalid chapter status: ${String(value)} — one of ${CHAPTER_STATUSES.join(", ")}`,
  );
}

// --- transaction plumbing ----------------------------------------------------

/**
 * Run `fn` in one transaction and bump the campaign's version counter in the
 * same commit. The driver is synchronous (db/driver.ts), so `fn` must be too
 * — no `await` may happen inside a transaction.
 */
async function mutate<T>(campaign: string, fn: (db: GrimoireDb) => T): Promise<T> {
  await requireCampaign(campaign);
  const db = await getDb();
  return db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const result = fn(tx);
    tx.update(campaigns)
      .set({ version: sql`${campaigns.version} + 1` })
      .where(eq(campaigns.id, campaign))
      .run();
    return result;
  }) as T;
}

/**
 * The optimistic-concurrency check: the row's `rev` must be the one read.
 *
 * The body carries `code: "rev_conflict"` — `what` names WHICH entry moved
 * and stays English, as the technical fallback next to it.
 */
function guardRev(current: number, sent: number, what: string): void {
  if (current !== sent) {
    throw new ApiError(409, `${what} — reload before saving`, {
      code: "rev_conflict",
      rev: current,
    });
  }
}

/** Keys that would hit Object.prototype machinery instead of data. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// --- defensive coercions (properties is hand-edited) ------------------------

function asOptStr(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function asStr(value: unknown, fallback = ""): string {
  return asOptStr(value) ?? fallback;
}

function asStrArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v) => v !== undefined && v !== null).map((v) => String(v));
}

function asMap(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Apply a flat properties patch to a rendered properties mapping (`null`
 * deletes a key) — the same semantics the raw-text patcher had, minus the
 * YAML round trip: the columns are the values now.
 */
function applyPatch(
  fm: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...fm };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "" || UNSAFE_KEYS.has(key)) throw new ApiError(400, `invalid patch key: ${key}`);
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

// --- FTS helpers per kind ----------------------------------------------------

/**
 * Re-index everything whose BODY references `slug`.
 *
 * The indexed text of a referring entity contains the referenced entity's
 * DISPLAY NAME (store/refs.ts explains why), so a name or id change makes
 * other entities' index rows stale. Every write of a referenceable entity
 * therefore ends here.
 *
 * The `cascading` latch stops the obvious infinite loop: re-indexing a
 * referrer is a write of a referenceable entity too, and two entities that
 * mention each other would ping-pong forever. One level is all this needs —
 * the referrer's own name did not change. Safe as a module flag because a
 * transaction is strictly synchronous (see `mutate`).
 */
let cascading = false;

function reindexReferrers(tx: GrimoireDb, campaign: string, slug: string): void {
  if (cascading) return;
  cascading = true;
  try {
    for (const referrer of referrersOf(tx, campaign, slug)) {
      reindexEntity(tx, campaign, referrer.kind, referrer.id);
    }
  } finally {
    cascading = false;
  }
}

function indexScene(tx: GrimoireDb, campaign: string, row: SceneRow, tags: string[]): void {
  indexEntity(tx, campaign, {
    kind: "scene",
    entityId: row.id,
    title: row.title === "" ? row.id : row.title,
    ref: row.id,
    tags: tags.join(" "),
    body: expandBodyRefs(tx, campaign, row.body),
  });
  reindexReferrers(tx, campaign, row.id);
}

function indexNpc(tx: GrimoireDb, campaign: string, row: NpcRow): void {
  indexEntity(tx, campaign, {
    kind: "npc",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: row.role ?? "",
    body: expandBodyRefs(tx, campaign, row.body),
  });
  reindexReferrers(tx, campaign, row.id);
}

function indexLocation(tx: GrimoireDb, campaign: string, row: LocationRow): void {
  indexEntity(tx, campaign, {
    kind: "location",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: "",
    body: expandBodyRefs(tx, campaign, row.body),
  });
  reindexReferrers(tx, campaign, row.id);
}

// A chapter is NOT referenceable (@grimoire/shared/refs), so nothing has to be
// re-indexed for it — but its body may CONTAIN references like any other.
function indexChapter(tx: GrimoireDb, campaign: string, row: ChapterRow): void {
  indexEntity(tx, campaign, {
    kind: "chapter",
    entityId: row.id,
    title: row.title === "" ? row.id : row.title,
    ref: row.id,
    tags: "",
    body: expandBodyRefs(tx, campaign, row.body),
  });
}

// The campaign file is not referenceable either — but its note body CONTAINS
// references like any other, and store/refs.ts scans it for them, so nothing
// here is half-supported any more.
export function indexCampaign(tx: GrimoireDb, row: CampaignRow): void {
  indexEntity(tx, row.id, {
    kind: "campaign",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: "",
    body: expandBodyRefs(tx, row.id, row.body),
  });
}

export function indexGlossaryTerm(
  tx: GrimoireDb,
  campaign: string,
  term: string,
  explanation: string,
): void {
  indexEntity(tx, campaign, {
    kind: "glossary",
    entityId: term,
    title: term,
    ref: term,
    tags: "",
    body: explanation,
  });
}

// --- row loaders inside a transaction ----------------------------------------

function chapterRowOf(tx: GrimoireDb, campaign: string, id: string): ChapterRow | undefined {
  return tx
    .select()
    .from(chapters)
    .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, id)))
    .all()[0] as ChapterRow | undefined;
}

function sceneRowOf(tx: GrimoireDb, campaign: string, id: string): SceneRow | undefined {
  return tx
    .select()
    .from(scenes)
    .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, id)))
    .all()[0] as SceneRow | undefined;
}

/**
 * The scene a `{ kind: "scene" }` locator addresses — by ID, which is the
 * key. The chapter and group segments used to have to match the
 * row, because a group was an independent value and a link with the wrong
 * one was a link to nothing. The group is `location` now: it MOVES when the
 * DM corrects the location, so every address handed out before that move is
 * a stale address for a scene that still exists. Resolving by id is what
 * makes the correction non-destructive — the response carries the current
 * address in `path`, and the app replaces the URL with it (ADR #17).
 *
 * The write is not unguarded by this: `rev` is the guard that a write which
 * has not seen the current entry is refused (ADR #4).
 */
function sceneRowAt(
  tx: GrimoireDb,
  campaign: string,
  locator: Extract<Locator, { kind: "scene" }>,
): SceneRow {
  const row = sceneRowOf(tx, campaign, locator.id);
  if (row === undefined) throw new ApiError(404, "entry not found");
  return row;
}

function npcRowOf(tx: GrimoireDb, campaign: string, id: string): NpcRow | undefined {
  return tx
    .select()
    .from(npcs)
    .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, id)))
    .all()[0] as NpcRow | undefined;
}

function locationRowOf(tx: GrimoireDb, campaign: string, id: string): LocationRow | undefined {
  return tx
    .select()
    .from(locations)
    .where(and(eq(locations.campaignId, campaign), eq(locations.id, id)))
    .all()[0] as LocationRow | undefined;
}

function chapterIdExists(tx: GrimoireDb, campaign: string, id: string): boolean {
  return chapterRowOf(tx, campaign, id) !== undefined;
}

/**
 * The 400 a reference that names nothing answers — one shape for all of
 * them. `code` is the contract (`@grimoire/shared/error-codes`); the app
 * builds the sentence the DM reads from it and the `value`, and the English
 * text here is the technical fallback.
 */
function unknownRef(code: ErrorCode, kind: string, value: string): ApiError {
  return new ApiError(400, `unknown ${kind}: ${value} — create it first`, { code, value });
}

/** A `chapter:` — of a scene, an npc or a location — has to name a chapter. */
function assertChapterRef(tx: GrimoireDb, campaign: string, declared: string | null): void {
  if (declared === null) return;
  if (chapterIdExists(tx, campaign, declared)) return;
  throw unknownRef("chapter_unknown", "chapter", declared);
}

/** A scene's `location` has to name a location entry. */
function assertLocationRef(tx: GrimoireDb, campaign: string, id: string | null): void {
  if (id === null) return;
  if (locationRowOf(tx, campaign, id) !== undefined) return;
  throw unknownRef("location_unknown", "location", id);
}

/**
 * Every entry of a scene's `npcs` has to name an npc entry.
 *
 * This is also what answers a NAME typed where an id belongs („Alte
 * Fischerin"): no npc has that id, so the list names something that does not
 * exist — one rule, one sentence, instead of a second error about the shape
 * of the value.
 */
function assertNpcRefs(tx: GrimoireDb, campaign: string, ids: readonly string[]): void {
  for (const id of ids) {
    if (id === "" || npcRowOf(tx, campaign, id) !== undefined) continue;
    throw unknownRef("npc_unknown", "npc", id);
  }
}

/**
 * A scene a session names — the scene of a quick note, or one in the played
 * list. Two codes for one check, because the two sentences differ: one is
 * about the note being written, the other about a list being saved.
 */
function assertSceneRef(
  tx: GrimoireDb,
  campaign: string,
  id: string,
  code: "log_scene_unknown" | "played_scene_unknown",
): void {
  if (sceneRowOf(tx, campaign, id) !== undefined) return;
  throw unknownRef(code, "scene", id);
}

function nextPos(rows: Array<{ pos: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.pos), -1) + 1;
}

// --- references, and what an entry is ---------------------------------------
//
// A reference names an entry that EXISTS — the database says so (schema.ts
// rule 3), and the assertions above are what turns a write that names
// something else into one readable sentence instead of a constraint error.
//
// Nothing here creates an entry as a side effect. The paths that DO create
// one are countable: the create endpoints at the bottom of this file,
// `createNpcStub` (the review's „#npc line becomes an npc", which the DM
// clicks), and accepting a generator proposal — including `ensureChapterRow`
// inside that accept, which writes the chapter the run itself decided on
// (ADR #18). Nowhere else.
//
// A `[[slug]]` in a body is not a reference in this sense. It is text, it
// stays text, and an unknown one renders as exactly what the DM typed.

/**
 * The `npcs.status` column default (schema.ts) — "nothing is claimed". Named
 * here because emptiness is defined against it (`isEmptyNpcRow`).
 */
const NPC_DEFAULT_STATUS = "unknown";

/**
 * The chapter of a GENERATED scene, created if it has none of its own.
 *
 * The ONE write that brings an entry into existence without the DM naming it
 * in a dialog, and it is not a mention creating anything: the run itself
 * decided the chapter (and, for a „Neues Kapitel" run, its title), so
 * accepting the proposal has to be able to write it. Without this a scene
 * ends up under a chapter that has no entry — and the overview lists
 * chapters, so the chapter and every scene in it would be unreachable.
 *
 * Idempotent and quiet: false when the chapter is already there, and false
 * for an id that is no entity slug — `assertChapterRef` then answers for it.
 * `planned` like every other creation path: a chapter the run brought is
 * upcoming, never the active one.
 */
function ensureChapterRow(
  tx: GrimoireDb,
  campaign: string,
  id: string,
  title?: string,
): boolean {
  if (!ENTITY_SLUG.test(id)) return false;
  if (chapterRowOf(tx, campaign, id) !== undefined) return false;
  const display = title?.trim();
  tx.insert(chapters)
    .values({
      campaignId: campaign,
      id,
      title: display === undefined || display === "" ? id : display,
      status: CHAPTER_PLANNED,
      pos: nextPos(
        tx.select({ pos: chapters.pos }).from(chapters).where(eq(chapters.campaignId, campaign)).all(),
      ),
    })
    .run();
  const row = chapterRowOf(tx, campaign, id);
  if (row !== undefined) indexChapter(tx, campaign, row);
  return true;
}

/**
 * A scene's `location`, validated: an entity id, or null.
 *
 * `location` is a REFERENCE — it is the scene's group and its address — so a
 * value that cannot be an id cannot be a group either. Free text is a 400
 * that carries the slug it would have been, so the app can say which id to
 * use; whether that id HAS an entry is the next question
 * (`assertLocationRef`).
 */
function sceneLocation(value: unknown): string | null {
  const raw = asOptStr(value);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!ENTITY_SLUG.test(trimmed)) {
    const suggestion = toSlug(trimmed);
    throw new ApiError(
      400,
      `location "${trimmed}" is not a location id — a scene's location is a reference` +
        (suggestion === "" ? "" : `; use "${suggestion}" and create that location first`),
      suggestion === ""
        ? { code: "location_not_an_id", value: trimmed }
        : { code: "location_not_an_id", value: trimmed, suggestion },
    );
  }
  return trimmed;
}

/**
 * An entry that holds NOTHING but its id — what a DM leaves behind by
 * creating an entry and not filling it in.
 *
 * The generator's apply step FILLS such an entry instead of answering the
 * documented `409 { conflicts }` for a target that has no content to lose,
 * and so does „NPC anlegen“ for that same id.
 *
 * `status` COUNTS as information. An entry the DM only ever set to `dead` is
 * still a statement about that npc — the one field the live view acts on — so
 * an apply must not overwrite it silently; it answers the documented 409 like
 * any other filled row. Only the column DEFAULT is emptiness.
 */
function isEmptyNpcRow(row: NpcRow): boolean {
  return (
    row.name === "" &&
    row.status === NPC_DEFAULT_STATUS &&
    row.role === null &&
    row.chapterId === null &&
    row.statblock === null &&
    row.voice === null &&
    row.appearance === null &&
    row.body.trim() === "" &&
    isEmptyJsonObject(row.quickstats)
  );
}

function isEmptyLocationRow(row: LocationRow): boolean {
  return (
    row.name === "" &&
    row.chapterId === null &&
    row.roll20Page === null &&
    row.body.trim() === ""
  );
}

function isEmptyJsonObject(packed: string): boolean {
  const trimmed = packed.trim();
  return trimmed === "" || trimmed === "{}";
}

// --- scene reference tables ---------------------------------------------------

/**
 * Replace a scene's reference rows. The caller has checked the npc ids
 * (`assertNpcRefs`); the rows are deleted and rewritten because `pos` — the
 * authored order — is part of the content.
 */
function replaceSceneRefs(
  tx: GrimoireDb,
  campaign: string,
  sceneId: string,
  npcRefs: string[],
  tags: string[],
): void {
  tx.delete(sceneNpcs)
    .where(and(eq(sceneNpcs.campaignId, campaign), eq(sceneNpcs.sceneId, sceneId)))
    .run();
  const seenNpcs = new Set<string>();
  npcRefs.forEach((npcId, pos) => {
    if (npcId === "" || seenNpcs.has(npcId)) return;
    seenNpcs.add(npcId);
    tx.insert(sceneNpcs).values({ campaignId: campaign, sceneId, npcId, pos }).run();
  });
  tx.delete(sceneTags)
    .where(and(eq(sceneTags.campaignId, campaign), eq(sceneTags.sceneId, sceneId)))
    .run();
  const seenTags = new Set<string>();
  tags.forEach((tag, pos) => {
    if (tag === "" || seenTags.has(tag)) return;
    seenTags.add(tag);
    tx.insert(sceneTags).values({ campaignId: campaign, sceneId, tag, pos }).run();
  });
}

/**
 * Re-index one entity from its current row — the index row's `title` too,
 * not only its id.
 *
 * `campaign` is a kind here because the campaign FILE is a referring body
 * like any other (store/refs.ts `REF_BODY_KINDS`): a note in `campaign`
 * that says `[[jorna]]` has the resolved name in its index row, so it goes
 * stale with everybody else's.
 */
export function reindexEntity(
  tx: GrimoireDb,
  campaign: string,
  kind: RefBodyKind,
  id: string,
): void {
  if (kind === "campaign") {
    const row = campaignRow(tx, campaign);
    if (row !== undefined) indexCampaign(tx, row);
    return;
  }
  if (kind === "npc") {
    const row = npcRowOf(tx, campaign, id);
    if (row !== undefined) indexNpc(tx, campaign, row);
    return;
  }
  if (kind === "location") {
    const row = locationRowOf(tx, campaign, id);
    if (row !== undefined) indexLocation(tx, campaign, row);
    return;
  }
  if (kind === "chapter") {
    const row = chapterRowOf(tx, campaign, id);
    if (row !== undefined) indexChapter(tx, campaign, row);
    return;
  }
  const row = sceneRowOf(tx, campaign, id);
  if (row !== undefined) indexScene(tx, campaign, row, refTags(tx, campaign, id));
}

// --- PATCH /api/:campaign/properties ----------------------------------------

/**
 * THE CONTRACT KEYS per kind — the complete set of properties a stored entry
 * can carry, in the README's order. There is nothing beside them: a key that
 * is not on its kind's list has no field behind it, so a patch naming one is
 * a 400 and a seed naming one is refused.
 */
const SCENE_KEYS = [
  "id",
  "title",
  "type",
  "trigger",
  "chapter",
  "location",
  "npcs",
  "handouts",
  "tags",
  "status",
] as const;
const NPC_KEYS = [
  "id",
  "name",
  "role",
  "chapter",
  "status",
  "statblock",
  "quickstats",
  "voice",
  "appearance",
] as const;
const LOCATION_KEYS = ["id", "name", "chapter", "roll20-page"] as const;
const CHAPTER_KEYS = ["id", "title", "status"] as const;
const CAMPAIGN_KEYS = ["id", "name", "description"] as const;
const SESSION_KEYS = ["id", "started", "ended", "scenes_played", "pauses", "reviewed"] as const;

/** The same lists by kind, for callers that look one up (db/seed.ts). */
export const PROPERTY_CONTRACT = {
  campaign: CAMPAIGN_KEYS,
  chapter: CHAPTER_KEYS,
  scene: SCENE_KEYS,
  npc: NPC_KEYS,
  location: LOCATION_KEYS,
  session: SESSION_KEYS,
} as const satisfies Record<string, readonly string[]>;

/**
/**
 * A patch may only name keys the CONTRACT names (schema.ts rule 1). There is
 * no field behind anything else, and a typo would otherwise become a silent
 * new key.
 */
function rejectUnknownKeys(patch: Record<string, unknown>, contract: readonly string[]): void {
  for (const key of Object.keys(patch)) {
    if (contract.includes(key)) continue;
    throw new ApiError(400, `unknown property "${key}" — the entry has no such field`);
  }
}

function rejectIdPatch(patch: Record<string, unknown>, current: string): void {
  if (!("id" in patch)) return;
  const next = patch.id;
  if (typeof next === "string" && next === current) return; // a no-op patch is fine
  throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
}

export async function patchProperties(
  campaign: string,
  rel: string,
  rev: number,
  patch: Record<string, unknown>,
): Promise<EntryResponse> {
  assertSafeAddress(rel);
  const locator = locatorFromPath(rel);
  return mutate(campaign, (tx) => patchLocator(tx, campaign, locator, rev, patch));
}

function patchLocator(
  tx: GrimoireDb,
  campaign: string,
  locator: Locator,
  rev: number,
  patch: Record<string, unknown>,
): EntryResponse {
  switch (locator.kind) {
    case "campaign": {
      const row = campaignRow(tx, campaign);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardRev(row.rev, rev, "campaign changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, CAMPAIGN_KEYS);
      const fm = applyPatch(renderCampaign(row).properties, patch);
      const name = asStr(fm.name);
      // Accepted by design: a name that EQUALS the id is stored as "" — the
      // empty name means "fall back to the id" everywhere it is rendered
      // (./render, ./read), so the round trip shows the same name back and
      // the row carries no redundant copy of its own key.
      const next: CampaignRow = {
        ...row,
        name: name === row.id ? "" : name,
        description: asOptStr(fm.description),
        rev: row.rev + 1,
      };
      tx.update(campaigns)
        .set({ name: next.name, description: next.description, rev: next.rev })
        .where(eq(campaigns.id, campaign))
        .run();
      indexCampaign(tx, next);
      return renderCampaign(next);
    }
    case "chapter": {
      const row = chapterRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardRev(row.rev, rev, "chapter changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, CHAPTER_KEYS);
      // Only the known trio may be WRITTEN; what is already stored is still
      // shown verbatim.
      assertChapterStatus(patch);
      const fm = applyPatch(renderChapter(row).properties, patch);
      const next: ChapterRow = {
        ...row,
        title: asStr(fm.title, row.id),
        status: asOptStr(fm.status),
        rev: row.rev + 1,
      };
      // Setting `active` HERE performs the same swap the dedicated endpoint
      // does, in this transaction: the properties dialog must not be a way
      // past the one-active rule.
      if (next.status === CHAPTER_ACTIVE) clearOtherActiveChapters(tx, campaign, row.id);
      tx.update(chapters)
        .set({ title: next.title, status: next.status, rev: next.rev })
        .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, row.id)))
        .run();
      indexChapter(tx, campaign, next);
      return renderChapter(next);
    }
    case "scene": {
      const row = sceneRowAt(tx, campaign, locator);
      guardRev(row.rev, rev, "scene changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, SCENE_KEYS);
      const before = renderScene(
        row,
        refNpcs(tx, campaign, row.id),
        refTags(tx, campaign, row.id),
      );
      const fm = applyPatch(before.properties, patch);
      const npcRefs = asStrArray(fm.npcs);
      const tags = asStrArray(fm.tags);
      // The chapter a scene belongs to is part of its ADDRESS (the path), so
      // a patch may MOVE the scene — but only into a chapter that exists. It
      // cannot be removed: a scene without a chapter has no address.
      const declared: string | null = asOptStr(fm.chapter);
      if (declared === null) {
        throw new ApiError(400, "chapter cannot be removed — a scene belongs to a chapter", {
          code: "chapter_required",
        });
      }
      // Every reference first, so a save that names something unknown is
      // refused before anything is written.
      assertChapterRef(tx, campaign, declared);
      const nextLocation = sceneLocation(fm.location);
      assertLocationRef(tx, campaign, nextLocation);
      assertNpcRefs(tx, campaign, npcRefs);
      const next: SceneRow = {
        ...row,
        title: asStr(fm.title, row.id),
        type: asStr(fm.type, "planned"),
        trigger: asOptStr(fm.trigger),
        chapterId: declared,
        location: nextLocation,
        status: asStr(fm.status, "draft"),
        handouts: packJson(asStrArray(fm.handouts)),
        rev: row.rev + 1,
      };
      tx.update(scenes)
        .set({
          title: next.title,
          type: next.type,
          trigger: next.trigger,
          chapterId: next.chapterId,
          location: next.location,
          status: next.status,
          handouts: next.handouts,
          rev: next.rev,
        })
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, row.id)))
        .run();
      // `location` is also the scene's GROUP, so this is the write that MOVES
      // the scene: the address in the response is built from the new value
      // and the app follows it.
      replaceSceneRefs(tx, campaign, row.id, npcRefs, tags);
      indexScene(tx, campaign, next, tags);
      return renderScene(next, refNpcs(tx, campaign, row.id), refTags(tx, campaign, row.id));
    }
    case "npc": {
      const row = npcRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardRev(row.rev, rev, "npc changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, NPC_KEYS);
      const fm = applyPatch(renderNpc(row).properties, patch);
      const quickstats = asMap(fm.quickstats);
      const npcChapter = asOptStr(fm.chapter);
      assertChapterRef(tx, campaign, npcChapter);
      const next: NpcRow = {
        ...row,
        name: asStr(fm.name, row.id),
        role: asOptStr(fm.role),
        chapterId: npcChapter,
        status: asStr(fm.status, NPC_DEFAULT_STATUS),
        statblock: asOptStr(fm.statblock),
        quickstats: packJson(quickstats),
        voice: asOptStr(fm.voice),
        appearance: asOptStr(fm.appearance),
        rev: row.rev + 1,
      };
      tx.update(npcs)
        .set({
          name: next.name,
          role: next.role,
          chapterId: next.chapterId,
          status: next.status,
          statblock: next.statblock,
          quickstats: next.quickstats,
          voice: next.voice,
          appearance: next.appearance,
          rev: next.rev,
        })
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, row.id)))
        .run();
      indexNpc(tx, campaign, next);
      return renderNpc(next);
    }
    case "location": {
      const row = locationRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardRev(row.rev, rev, "location changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, LOCATION_KEYS);
      const fm = applyPatch(renderLocation(row).properties, patch);
      const locationChapter = asOptStr(fm.chapter);
      assertChapterRef(tx, campaign, locationChapter);
      const next: LocationRow = {
        ...row,
        name: asStr(fm.name, row.id),
        chapterId: locationChapter,
        roll20Page: asOptStr(fm["roll20-page"]),
        rev: row.rev + 1,
      };
      tx.update(locations)
        .set({
          name: next.name,
          chapterId: next.chapterId,
          roll20Page: next.roll20Page,
          rev: next.rev,
        })
        .where(and(eq(locations.campaignId, campaign), eq(locations.id, row.id)))
        .run();
      indexLocation(tx, campaign, next);
      return renderLocation(next);
    }
    case "session": {
      const row = sessionRow(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardRev(row.rev, rev, "session changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, SESSION_KEYS);
      const fm = applyPatch(renderSessionRow(tx, campaign, row).properties, patch);
      patchSessionRow(tx, campaign, row, fm);
      const updated = sessionRow(tx, campaign, row.id);
      return renderSessionRow(tx, campaign, updated ?? row);
    }
    case "inbox":
    case "glossary":
      // Neither is an entity with properties any more: both are lists of
      // rows (schema.ts). The file used to carry a decorative `id:` and
      // nothing else, so there is nothing a patch could mean here.
      throw new ApiError(400, "this file has no properties — it is a list of entries");
  }
}

function refNpcs(tx: GrimoireDb, campaign: string, sceneId: string): string[] {
  return tx
    .select({ npcId: sceneNpcs.npcId })
    .from(sceneNpcs)
    .where(and(eq(sceneNpcs.campaignId, campaign), eq(sceneNpcs.sceneId, sceneId)))
    .orderBy(asc(sceneNpcs.pos))
    .all()
    .map((r) => r.npcId);
}

function refTags(tx: GrimoireDb, campaign: string, sceneId: string): string[] {
  return tx
    .select({ tag: sceneTags.tag })
    .from(sceneTags)
    .where(and(eq(sceneTags.campaignId, campaign), eq(sceneTags.sceneId, sceneId)))
    .orderBy(asc(sceneTags.pos))
    .all()
    .map((r) => r.tag);
}

/**
 * Write a patched session properties back onto the row and its child tables.
 * `pauses` and `scenes_played` are lists in the format and tables here;
 * `reviewed` is a hash list in the format and a flag on the log row.
 */
function patchSessionRow(
  tx: GrimoireDb,
  campaign: string,
  row: SessionRow,
  fm: Record<string, unknown>,
): void {
  tx.update(sessions)
    .set({
      started: asOptStr(fm.started),
      ended: asOptStr(fm.ended),
      rev: row.rev + 1,
    })
    .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
    .run();

  const played = asStrArray(fm.scenes_played);
  for (const sceneId of played) {
    if (sceneId === "") continue;
    assertSceneRef(tx, campaign, sceneId, "played_scene_unknown");
  }
  tx.delete(sessionScenesPlayed)
    .where(
      and(
        eq(sessionScenesPlayed.campaignId, campaign),
        eq(sessionScenesPlayed.sessionId, row.id),
      ),
    )
    .run();
  played.forEach((sceneId, pos) => {
    if (sceneId === "") return;
    tx.insert(sessionScenesPlayed)
      .values({ campaignId: campaign, sessionId: row.id, sceneId, pos })
      .run();
  });

  const pauses = Array.isArray(fm.pauses) ? fm.pauses : fm.pauses === undefined ? [] : [fm.pauses];
  tx.delete(sessionPauses)
    .where(and(eq(sessionPauses.campaignId, campaign), eq(sessionPauses.sessionId, row.id)))
    .run();
  let pos = 0;
  for (const entry of pauses) {
    const map = asMap(entry);
    const from = asOptStr(map.from);
    if (from === null) continue; // an entry without `from` is not a pause
    tx.insert(sessionPauses)
      .values({
        campaignId: campaign,
        sessionId: row.id,
        pos: pos++,
        fromTs: from,
        toTs: asOptStr(map.to),
      })
      .run();
  }

  const reviewed = new Set(asStrArray(fm.reviewed));
  for (const entry of logRows(tx, campaign, row.id)) {
    const flag = reviewed.has(entry.hash) ? 1 : 0;
    if (flag === entry.reviewed) continue;
    tx.update(logEntries)
      .set({ reviewed: flag })
      .where(
        and(
          eq(logEntries.campaignId, campaign),
          eq(logEntries.sessionId, row.id),
          eq(logEntries.pos, entry.pos),
        ),
      )
      .run();
  }
}

// --- PUT /api/:campaign/entry -------------------------------------------------

/**
 * Replace the markdown BODY of one entity. The append-only kinds
 * are still refused with 400 (DECISIONS #4): a session's log and the inbox
 * grow by rows through their own endpoints, never by a body rewrite.
 *
 * The glossary is the one body that is DECOMPOSED on the way in: it is a
 * table now, so the markdown the editor sends is parsed back into
 * term/explanation rows (store/body-parse.ts `parseGlossaryBody`) — the same
 * grammar the renderer writes out, so a save round-trips.
 */
export async function writeEntryBody(
  campaign: string,
  rel: string,
  rev: number,
  markdown: string,
): Promise<EntryResponse> {
  assertSafeAddress(rel);
  const locator = locatorFromPath(rel);
  if (locator.kind === "session" || locator.kind === "inbox") {
    throw new ApiError(400, "this file is append-only — use the log/inbox endpoints");
  }
  // A non-empty body gets its closing newline — the same normalisation the
  // file writer did (campaign-write.ts `replaceBody`), kept because `raw` is
  // still handed to a markdown editor and to the generator's prompt: a body
  // without its final newline made the next appended section run into the
  // last line. EXISTING trailing newlines are left alone, so a read/write
  // roundtrip changes nothing; an empty body stays empty.
  return mutate(campaign, (tx) => writeBodyIn(tx, campaign, locator, rev, markdown));
}

/**
 * The body write itself, INSIDE a caller's transaction. Split out of
 * `writeEntryBody` because „Mit KI ergänzen" accepts properties and body of
 * one entry together, and that has to be ONE transaction with one rev guard
 * — two `mutate` calls would be two.
 */
function writeBodyIn(
  tx: GrimoireDb,
  campaign: string,
  locator: Locator,
  rev: number,
  markdown: string,
): EntryResponse {
  const body = markdown === "" || markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  switch (locator.kind) {
    case "campaign": {
      const row = campaignRow(tx, campaign);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardRev(row.rev, rev, "campaign changed");
      const next: CampaignRow = { ...row, body, rev: row.rev + 1 };
      tx.update(campaigns)
        .set({ body: next.body, rev: next.rev })
        .where(eq(campaigns.id, campaign))
        .run();
      indexCampaign(tx, next);
      return renderCampaign(next);
    }
    case "chapter": {
      const row = chapterRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardRev(row.rev, rev, "chapter changed");
      const next: ChapterRow = { ...row, body, rev: row.rev + 1 };
      tx.update(chapters)
        .set({ body: next.body, rev: next.rev })
        .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, row.id)))
        .run();
      indexChapter(tx, campaign, next);
      return renderChapter(next);
    }
    case "scene": {
      const row = sceneRowAt(tx, campaign, locator);
      guardRev(row.rev, rev, "scene changed");
      const next: SceneRow = { ...row, body, rev: row.rev + 1 };
      tx.update(scenes)
        .set({ body: next.body, rev: next.rev })
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, row.id)))
        .run();
      const tags = refTags(tx, campaign, row.id);
      indexScene(tx, campaign, next, tags);
      return renderScene(next, refNpcs(tx, campaign, row.id), tags);
    }
    case "npc": {
      const row = npcRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardRev(row.rev, rev, "npc changed");
      // The whole text is stored as it was written, `## Beziehungen`
      // included: nothing in the storage is derived from body text.
      const next: NpcRow = { ...row, body, rev: row.rev + 1 };
      tx.update(npcs)
        .set({ body: next.body, rev: next.rev })
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, row.id)))
        .run();
      indexNpc(tx, campaign, next);
      return renderNpc(next);
    }
    case "location": {
      const row = locationRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardRev(row.rev, rev, "location changed");
      const next: LocationRow = { ...row, body, rev: row.rev + 1 };
      tx.update(locations)
        .set({ body: next.body, rev: next.rev })
        .where(and(eq(locations.campaignId, campaign), eq(locations.id, row.id)))
        .run();
      indexLocation(tx, campaign, next);
      return renderLocation(next);
    }
    case "glossary": {
      const row = campaignRow(tx, campaign);
      if (row === undefined) throw new ApiError(404, "entry not found");
      // The glossary's OWN counter, not `campaigns.version`: an unrelated
      // write during a running session must not invalidate an open edit.
      guardRev(row.glossaryRev, rev, "glossary changed");
      const parsedGlossary = parseGlossaryBody(body);
      // A term typed twice would silently lose its second explanation
      // ("first wins" is a READER's degrade rule, not a save's) — say so
      // instead, with the term in the message.
      const duplicate = parsedGlossary.duplicates[0];
      if (duplicate !== undefined) {
        throw new ApiError(
          400,
          `glossary term "${duplicate}" appears more than once — merge the entries`,
          { code: "glossary_duplicate_term", term: duplicate },
        );
      }
      const nextRev = row.glossaryRev + 1;
      // Prose above the first heading belongs to no term. It is KEPT
      // (campaigns.glossary_intro) and rendered back in front of the list;
      // dropping it is what made a save lose text.
      tx.update(campaigns)
        .set({ glossaryIntro: parsedGlossary.preamble, glossaryRev: nextRev })
        .where(eq(campaigns.id, campaign))
        .run();
      writeGlossaryRows(
        tx,
        campaign,
        parsedGlossary.entries.map((e) => ({ term: e.term, explanation: e.explanation })),
      );
      return renderGlossary(glossaryRows(tx, campaign), nextRev, parsedGlossary.preamble);
    }
    default:
      throw new ApiError(404, "entry not found");
  }
}

/**
 * „Mit KI ergänzen" accepts a proposal: the chosen properties
 * fields and the chosen body in ONE transaction, guarded by ONE `rev` — the
 * version the DM was looking at in the review.
 *
 * THE BODY GOES FIRST. A properties patch may MOVE the entry — a scene whose
 * `chapter` the proposal changes lands under another address — and `locator`
 * is the address the request came in on. Patching first therefore left the
 * body write resolving an address that no longer exists: a bogus 404 and a
 * rolled-back accept, for a proposal that was perfectly fine. Written the
 * other way round the body lands on the row while it is still where the
 * client found it, and the patch runs against the rev that write produced.
 * Both halves see the same transaction, so a conflict in either rolls the
 * whole accept back and nothing is half-written. Everything a normal write
 * does — the search index, the reference checks — happens because these are
 * the very same code paths.
 *
 * The answer is the LAST render, so a move is already in the path the client
 * gets back.
 *
 * `jobId` discards the augment job the proposal came from, in the SAME
 * transaction as the write (drafts and job can never disagree after a
 * crash). A stale id matches nothing and is ignored.
 */
export async function writePropertiesAndBody(
  campaign: string,
  rel: string,
  rev: number,
  patch: Record<string, unknown>,
  body: string | undefined,
  jobId?: string,
): Promise<EntryResponse> {
  assertSafeAddress(rel);
  const locator = locatorFromPath(rel);
  if (locator.kind === "session" || locator.kind === "inbox") {
    throw new ApiError(400, "this file is append-only — use the log/inbox endpoints");
  }
  return mutate(campaign, (tx) => {
    const bodyWritten =
      body === undefined ? undefined : writeBodyIn(tx, campaign, locator, rev, body);
    const patchRev = bodyWritten?.rev ?? rev;
    const patched =
      Object.keys(patch).length === 0
        ? undefined
        : patchLocator(tx, campaign, locator, patchRev, patch);
    const written = patched ?? bodyWritten;
    if (written === undefined) throw new ApiError(400, "nothing to write");
    if (jobId !== undefined) {
      tx.delete(generateJobs)
        .where(and(eq(generateJobs.id, jobId), eq(generateJobs.campaignId, campaign)))
        .run();
    }
    return written;
  });
}

// --- the glossary table --------------------------------------------------------

/** Replace the whole glossary of a campaign (PUT /glossary, and body edits). */
function writeGlossaryRows(
  tx: GrimoireDb,
  campaign: string,
  entries: Array<{ term: string; explanation: string }>,
): void {
  // The whole list is replaced, so the index rows go in one statement rather
  // than one per term — a term that disappears must not survive in search.
  tx.run(sql`delete from search_fts where campaign_id = ${campaign} and kind = 'glossary'`);
  tx.delete(glossary).where(eq(glossary.campaignId, campaign)).run();
  const seen = new Set<string>();
  let pos = 0;
  for (const entry of entries) {
    const term = entry.term.trim();
    if (term === "" || seen.has(term)) continue; // first one wins
    seen.add(term);
    tx.insert(glossary)
      .values({ campaignId: campaign, term, explanation: entry.explanation, pos: pos++ })
      .run();
    indexGlossaryTerm(tx, campaign, term, entry.explanation);
  }
}

/**
 * PUT /api/:campaign/glossary `{ entries, rev }` -> the stored list + its
 * fresh `rev`.
 *
 * The ORDER of `entries` is the stored order — that is what the settings
 * page's reordering writes: there is no separate "move" endpoint,
 * because a list this short is one entry and a move is simply a different
 * entry.
 *
 * `rev` is REQUIRED, for the reason every other editable
 * entry has one: the settings page and the markdown editor can hold the
 * same glossary open, and a whole-list PUT without a guard is exactly the
 * silent overwrite ADR #4 forbids. An `undefined` rev is refused by the
 * endpoint, not defaulted here.
 */
export async function writeGlossary(
  campaign: string,
  entries: Array<{ term: string; explanation: string }>,
  rev: number,
): Promise<GlossaryResponse> {
  return mutate(campaign, (tx) => {
    const row = requireCampaignRow(tx, campaign);
    guardRev(row.glossaryRev, rev, "glossary changed");
    writeGlossaryRows(tx, campaign, entries);
    // Same entry, same guard token: an editor holding `glossary` must
    // see a changed `rev` after this.
    const nextRev = row.glossaryRev + 1;
    tx.update(campaigns)
      .set({ glossaryRev: nextRev })
      .where(eq(campaigns.id, campaign))
      .run();
    return {
      entries: glossaryRows(tx, campaign).map((r) => ({
        term: r.term,
        explanation: r.explanation,
      })),
      rev: nextRev,
    };
  });
}

// --- the campaign_knowledge table ----------------------------------------------

/**
 * PUT /api/:campaign/knowledge `{ entries, rev }` -> the stored list + its
 * fresh `rev`.
 *
 * Exactly the glossary's contract, deliberately: the DM edits both lists on
 * the same page, so "the whole list plus its guard token" is ONE thing to
 * understand instead of two. The list is replaced rather than diffed — which
 * is what makes reordering, deleting and editing the same request — and
 * `pos` is handed out fresh from the array order.
 *
 * ENTRIES ARE NOT DROPPED HERE for being half-filled: an empty `to` is a
 * convention the DM has not finished typing, and swallowing it on save would
 * lose work. The PROMPT skips those lines instead (read.ts knowledgeText),
 * which is where an incomplete rule can actually do damage.
 */
export async function writeKnowledge(
  campaign: string,
  entries: KnowledgeEntry[],
  rev: number,
): Promise<KnowledgeResponse> {
  return mutate(campaign, (tx) => {
    const row = requireCampaignRow(tx, campaign);
    guardRev(row.knowledgeRev, rev, "campaign knowledge changed");
    tx.delete(campaignKnowledge).where(eq(campaignKnowledge.campaignId, campaign)).run();
    let pos = 0;
    for (const entry of entries) {
      tx.insert(campaignKnowledge)
        .values({
          campaignId: campaign,
          pos: pos++,
          kind: entry.kind,
          fromText: entry.from,
          toText: entry.to,
          text: entry.text,
        })
        .run();
    }
    const nextRev = row.knowledgeRev + 1;
    tx.update(campaigns)
      .set({ knowledgeRev: nextRev })
      .where(eq(campaigns.id, campaign))
      .run();
    return { entries: knowledgeRows(tx, campaign).map(knowledgeEntry), rev: nextRev };
  });
}

/**
 * The campaign row inside a running transaction. `mutate` has already proved
 * the campaign exists, so this only narrows the type — a 404 here would mean
 * the row vanished between two statements of one transaction.
 */
function requireCampaignRow(tx: GrimoireDb, campaign: string): CampaignRow {
  const row = campaignRow(tx, campaign);
  if (row === undefined) throw new ApiError(404, "campaign not found");
  return row;
}

// --- sessions -----------------------------------------------------------------

function requireActive(tx: GrimoireDb, campaign: string): SessionRow {
  const row = pickSession(tx, campaign, false);
  if (row === undefined) throw new ApiError(404, "no active session");
  return row;
}

function bumpSessionRev(tx: GrimoireDb, campaign: string, row: SessionRow): void {
  tx.update(sessions)
    .set({ rev: row.rev + 1 })
    .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
    .run();
}

/**
 * The id for a NEW session: an OPAQUE RANDOM string, `crypto.randomUUID()`.
 * See db/schema.ts (`sessions`) for the reasoning — in short, nobody reads a
 * session id, so it needs no shape, and a random one needs no coordination:
 * the former `yyyy-mm-dd-<n>` scheme had to persist a per-day high-water mark
 * in `meta` so a discarded session's id could not be re-issued onto another
 * evening's log rows. A random id is unique whether or not the row it named
 * still exists.
 *
 * `crypto` is the WHATWG global (Node ≥ 19 and Bun) — no import, no npm
 * dependency, no hand-rolled base32 encoder (DECISIONS: Node portability).
 */
function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * The CALENDAR DAY of a session's `started`, or undefined when the value says
 * nothing usable. Just the date part of the zone-less wall-clock string the
 * format carries — no timezone arithmetic, because the string already is the
 * server's local reading (clock.ts).
 */
function startedDate(started: string | null): string | undefined {
  return /^(\d{4}-\d{2}-\d{2})/.exec(started ?? "")?.[1];
}

/**
 * The `createdAt` for a new session row: the ORDER tie-break behind `started`
 * (db/schema.ts), in epoch milliseconds and STRICTLY greater than every
 * createdAt the campaign already holds.
 *
 * Two reasons it is not simply `Date.now()`. It must be monotonic — "start,
 * beenden, wieder starten" inside one millisecond has to order, and so does a
 * clock that jumped backwards (NTP, DST on a machine that stores UTC wrong).
 * And it must NOT come from `clock.ts now()`: that one is overridable, which
 * is the point for `started` (a session can be started "yesterday" in a test)
 * and exactly wrong here — a frozen clock would hand every row of a test the
 * same tie-break and the order would depend on the query's row order again.
 */
function nextCreatedAt(tx: GrimoireDb, campaign: string): number {
  const highest = tx
    .select({ createdAt: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.campaignId, campaign))
    .all()
    .reduce((acc, row) => Math.max(acc, row.createdAt), 0);
  return Math.max(Date.now(), highest + 1);
}

/**
 * POST /api/:campaign/session/start — two answers:
 *
 *   * a RUNNING session of today is returned untouched (the start button
 *     stays idempotent while the evening runs);
 *   * an OLDER running session is a 409 `session_running` — ending someone
 *     else's evening is not implied by "starten";
 *   * otherwise a NEW session is created, even when today already has ended
 *     ones. "Beenden" is final: the new row gets its own id,
 *     an empty log and a runtime that starts at 0. The former 409
 *     `session_ended` and POST /session/resume are gone with it.
 */
export async function startSession(campaign: string): Promise<EntryResponse> {
  return mutate(campaign, (tx) => {
    const d = now();
    const today = localDate(d);
    const active = pickSession(tx, campaign, false);
    // "Is the running session TODAY's?" is answered by `started`, not by the
    // id — the id is opaque and says nothing about a day.
    //
    // The old degrade of this check is GONE with it: an id that did not parse
    // as a date could never be "today", so a hand-edited row answered every
    // start with a 409 the DM had to clear by hand. A row whose `started` is
    // unreadable is not the "running session" in the first place — it has no
    // place in the chronology (store/read.ts `sessionOrderKey`) — so
    // `pickSession` never returns it here and the next start simply opens a new
    // session. `startedDate` therefore only ever decides between today and an
    // EARLIER day.
    if (active !== undefined && startedDate(active.started) !== today) {
      throw new ApiError(409, "another session is still running — end it first", {
        code: "session_running",
        path: sessionPath(active.id),
      });
    }
    if (active !== undefined) return renderSessionRow(tx, campaign, active);
    const id = newSessionId();
    tx.insert(sessions)
      .values({
        campaignId: campaign,
        id,
        started: localDateTimeSeconds(d),
        createdAt: nextCreatedAt(tx, campaign),
      })
      .run();
    const row = sessionRow(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "session could not be created");
    return renderSessionRow(tx, campaign, row);
  });
}

/**
 * POST /session/end — set `ended` in the ACTIVE session (which may be
 * yesterday's row when the evening ran past midnight). Idempotent: with
 * nothing running it falls back to the last started session and keeps its
 * existing `ended`; an OPEN pause is closed by the end.
 */
export async function endSession(campaign: string): Promise<EntryResponse> {
  return mutate(campaign, (tx) => {
    const row = pickSession(tx, campaign, false) ?? pickSession(tx, campaign, true);
    if (row === undefined) throw new ApiError(404, "no active session");
    if (isEnded({ ended: row.ended })) return renderSessionRow(tx, campaign, row);
    const d = now();
    closeOpenPauses(tx, campaign, row.id, localDateTimeSeconds(d));
    const ended = localDateTimeSeconds(d);
    tx.update(sessions)
      .set({ ended, rev: row.rev + 1 })
      .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
      .run();
    return renderSessionRow(tx, campaign, { ...row, ended, rev: row.rev + 1 });
  });
}

function closeOpenPauses(
  tx: GrimoireDb,
  campaign: string,
  sessionId: string,
  to: string,
): boolean {
  const open = pauseRows(tx, campaign, sessionId).filter((p) => p.toTs === null);
  if (open.length === 0) return false;
  for (const pause of open) {
    tx.update(sessionPauses)
      .set({ toTs: to })
      .where(
        and(
          eq(sessionPauses.campaignId, campaign),
          eq(sessionPauses.sessionId, sessionId),
          eq(sessionPauses.pos, pause.pos),
        ),
      )
      .run();
  }
  return true;
}

/**
 * Append one log line row (append-only: existing rows are never rewritten).
 *
 * The parenthesis group is a PARSE COLUMN of the line, not something the DM
 * wrote as a reference: a note that happens to begin with „(…)" would
 * otherwise name a scene nobody meant. So it becomes the scene reference
 * only when a scene of that id exists, and stays part of `raw` otherwise —
 * the text of a note is never refused or thrown away over that. The
 * reference a quick note MEANS arrives as the endpoint's own `sceneId` and
 * is checked there.
 */
function appendLogRow(tx: GrimoireDb, campaign: string, sessionId: string, raw: string): void {
  const rows = logRows(tx, campaign, sessionId);
  const parts = logLineParts(tx, campaign, raw);
  tx.insert(logEntries)
    .values({
      campaignId: campaign,
      sessionId,
      pos: nextPos(rows),
      raw,
      at: parts.at,
      sceneId: parts.sceneId,
      text: parts.text,
      hash: logLineShortHash(raw),
      reviewed: 0,
    })
    .run();
}

/** `- HH:MM (scene-id) text` — the grammar the app's live log view reads. */
const LOG_LINE = /^-\s+(\d{1,2}:\d{2})(?:\s+\(([^)]+)\))?\s+(.+)$/;

/**
 * The parsed columns of one raw log line: its time, the scene it names and
 * its text. Everything is NULL for a line the grammar does not recognise —
 * `raw` is then all there is, and that is by design.
 *
 * Also what the seed writes historic log rows with (db/seed.ts), so a seeded
 * line and an appended one are decomposed by the same code.
 */
export function logLineParts(
  tx: GrimoireDb,
  campaign: string,
  raw: string,
): { at: string | null; sceneId: string | null; text: string | null } {
  const m = LOG_LINE.exec(raw);
  const marker = m?.[2] ?? null;
  return {
    at: m?.[1] ?? null,
    sceneId: marker !== null && sceneRowOf(tx, campaign, marker) !== undefined ? marker : null,
    text: m?.[3] ?? null,
  };
}

/**
 * POST /session/pause — really STOP the clock: an open
 * `pauses` interval plus the `— Pause` log line, in the same transaction.
 * Idempotent: pausing a paused session changes nothing.
 */
export async function pauseSession(campaign: string): Promise<EntryResponse> {
  return mutate(campaign, (tx) => {
    const row = requireActive(tx, campaign);
    const pauses = pauseRows(tx, campaign, row.id);
    if (pauses.some((p) => p.toTs === null)) return renderSessionRow(tx, campaign, row);
    const d = now();
    tx.insert(sessionPauses)
      .values({
        campaignId: campaign,
        sessionId: row.id,
        pos: nextPos(pauses),
        fromTs: localDateTimeSeconds(d),
        toTs: null,
      })
      .run();
    appendLogRow(tx, campaign, row.id, `- ${localTime(d)} — Pause`);
    bumpSessionRev(tx, campaign, row);
    return renderSessionRow(tx, campaign, { ...row, rev: row.rev + 1 });
  });
}

/** POST /session/continue — close the open interval and log `— Weiter`. */
export async function continueSession(campaign: string): Promise<EntryResponse> {
  return mutate(campaign, (tx) => {
    const row = requireActive(tx, campaign);
    const d = now();
    if (!closeOpenPauses(tx, campaign, row.id, localDateTimeSeconds(d))) {
      return renderSessionRow(tx, campaign, row);
    }
    appendLogRow(tx, campaign, row.id, `- ${localTime(d)} — Weiter`);
    bumpSessionRev(tx, campaign, row);
    return renderSessionRow(tx, campaign, { ...row, rev: row.rev + 1 });
  });
}

/**
 * POST /session/discard — DELETE the active session, the undo
 * of a mis-clicked "Session starten". Allowed only while it is EMPTY (no log
 * row, no played scene, no hand-written body); everything else is ended, not
 * deleted -> 409 `session_not_empty`.
 */
export async function discardSession(campaign: string): Promise<{ path: string }> {
  return mutate(campaign, (tx) => {
    const row = requireActive(tx, campaign);
    const log = logRows(tx, campaign, row.id);
    const played = playedScenes(tx, campaign, row.id);
    const empty =
      log.length === 0 && isSessionEmpty({ scenes_played: played }, row.body);
    if (!empty) {
      throw new ApiError(409, "this session has content — end it instead of discarding it", {
        code: "session_not_empty",
        path: sessionPath(row.id),
      });
    }
    tx.delete(sessions)
      .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
      .run();
    return { path: sessionPath(row.id) };
  });
}

/**
 * POST /api/:campaign/log — append `- HH:MM (sceneId) text` to the RUNNING
 * session; 404 when none runs (a note typed after "Session beenden" is
 * refused instead of landing in a closed log). With a sceneId
 * `scenes_played` is maintained in the same transaction.
 */
export async function appendLogEntry(
  campaign: string,
  text: string,
  sceneId?: string,
): Promise<EntryResponse> {
  // The scene marker is a PARSE COLUMN of the log line (`- HH:MM (id) text`),
  // so an id carrying `)` — or a space, or a newline — would shift `text` and
  // `sceneId` apart on the way back in. Same slug rule as `createNpcStub`.
  if (sceneId !== undefined && !ENTITY_SLUG.test(sceneId)) {
    throw new ApiError(400, "sceneId must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  return mutate(campaign, (tx) => {
    const row = requireActive(tx, campaign);
    // The note's scene is a reference: it has to name a scene that exists,
    // and nothing is created for it.
    if (sceneId !== undefined) assertSceneRef(tx, campaign, sceneId, "log_scene_unknown");
    const raw = `- ${localTime(now())}${sceneId ? ` (${sceneId})` : ""} ${text}`;
    appendLogRow(tx, campaign, row.id, raw);
    if (sceneId !== undefined) {
      const played = playedScenes(tx, campaign, row.id);
      if (!played.includes(sceneId)) {
        tx.insert(sessionScenesPlayed)
          .values({
            campaignId: campaign,
            sessionId: row.id,
            sceneId,
            pos: played.length,
          })
          .run();
      }
    }
    bumpSessionRev(tx, campaign, row);
    return renderSessionRow(tx, campaign, { ...row, rev: row.rev + 1 });
  });
}

// --- inbox ---------------------------------------------------------------------

/**
 * POST /api/:campaign/inbox — append `- text`. The `## Eingang`-less first
 * entry gets the `# Inbox` heading row the file format opened with, so the
 * rendered inbox still reads like the list it was.
 */
export async function appendInboxEntry(campaign: string, text: string): Promise<EntryResponse> {
  return mutate(campaign, (tx) => {
    const rows = inboxRows(tx, campaign);
    if (rows.length === 0) {
      tx.insert(inboxEntries)
        .values({ campaignId: campaign, pos: 0, raw: "# Inbox", text: null, done: 0 })
        .run();
    }
    const current = inboxRows(tx, campaign);
    tx.insert(inboxEntries)
      .values({
        campaignId: campaign,
        pos: nextPos(current),
        raw: `- ${text}`,
        text,
        done: 0,
      })
      .run();
    return renderInbox(campaign, inboxRows(tx, campaign), bumpInboxRev(tx, campaign));
  });
}

/** The inbox's own guard token, bumped and returned (see read.ts). */
function bumpInboxRev(tx: GrimoireDb, campaign: string): number {
  const next = (campaignRow(tx, campaign)?.inboxRev ?? 0) + 1;
  tx.update(campaigns)
    .set({ inboxRev: next })
    .where(eq(campaigns.id, campaign))
    .run();
  return next;
}

/**
 * POST /api/:campaign/review/inbox-done — the one documented exception to the
 * inbox's append-only rule: the entry is marked done. Idempotent; 404 when
 * the line is not in the inbox. The line is matched against the row's `raw`,
 * which is the byte-for-byte line the file had.
 */
export async function markInboxLineDone(campaign: string, line: string): Promise<EntryResponse> {
  const doneForm = (l: string) =>
    l.startsWith("- [ ] ") ? `- [x] ${l.slice(6)}` : `- [x] ${l.slice(2)}`;
  return mutate(campaign, (tx) => {
    const rows = inboxRows(tx, campaign);
    const rev = campaignRow(tx, campaign)?.inboxRev ?? 1;
    const match = rows.find((row) => row.raw === line);
    if (match === undefined) {
      // The done form already stored means an earlier call succeeded. An
      // idempotent repeat changes nothing, so the guard token stays as it is.
      if (!line.startsWith("- [x]") && rows.some((row) => row.raw === doneForm(line))) {
        return renderInbox(campaign, rows, rev);
      }
      throw new ApiError(404, "line not found in inbox");
    }
    if (line.startsWith("- [x]")) return renderInbox(campaign, rows, rev);
    tx.update(inboxEntries)
      .set({ raw: doneForm(line), done: 1 })
      .where(and(eq(inboxEntries.campaignId, campaign), eq(inboxEntries.pos, match.pos)))
      .run();
    return renderInbox(campaign, inboxRows(tx, campaign), bumpInboxRev(tx, campaign));
  });
}

// --- review actions ------------------------------------------------------------

/**
 * POST /api/:campaign/review/seen — mark one log line as reviewed. The
 * `reviewed` properties hash list became a flag on the log row (schema.ts),
 * and the hash is still the id the app speaks: the line is hashed exactly as
 * sent and the row with that hash gets the flag.
 *
 * CONTRACT of the answer's `marked` flag: true means a row now carries the
 * flag (it was set here, or an earlier call had already set it), false means
 * NO LOG LINE OF THIS SESSION HASHES TO THE LINE THAT WAS SENT — the session
 * moved on, or the caller did not send the line byte for byte. The file
 * version grew an orphan `reviewed` entry for that case; the row version
 * cannot, and staying silent about it would hide a client bug behind a 200.
 * The app sends the row's own `raw` (app/src/lib/use-review.ts), so `false`
 * is not a state it reaches — which is exactly why it must be visible.
 */
export async function markLogLineSeen(
  campaign: string,
  rel: string,
  line: string,
): Promise<EntryResponse & { marked: boolean }> {
  assertSafeAddress(rel);
  const segments = rel.split("/");
  if (segments.length !== 2 || segments[0] !== "sessions") {
    throw new ApiError(400, "path must be a sessions/<id> address");
  }
  const sessionId = segments[1] ?? "";
  const hash = logLineShortHash(line);
  return mutate(campaign, (tx) => {
    const row = sessionRow(tx, campaign, sessionId);
    if (row === undefined) throw new ApiError(404, "entry not found");
    const entry = logRows(tx, campaign, sessionId).find((l) => l.hash === hash);
    if (entry === undefined) {
      return { ...renderSessionRow(tx, campaign, row), marked: false };
    }
    if (entry.reviewed === 0) {
      tx.update(logEntries)
        .set({ reviewed: 1 })
        .where(
          and(
            eq(logEntries.campaignId, campaign),
            eq(logEntries.sessionId, sessionId),
            eq(logEntries.pos, entry.pos),
          ),
        )
        .run();
      bumpSessionRev(tx, campaign, row);
      return {
        ...renderSessionRow(tx, campaign, { ...row, rev: row.rev + 1 }),
        marked: true,
      };
    }
    return { ...renderSessionRow(tx, campaign, row), marked: true };
  });
}

/** A chapter id must be one non-hidden path segment (like a campaign id). */
function assertSafeChapterId(chapter: string): void {
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

/**
 * Append one item to the `## Offene Fäden` section of a chapter body — the
 * markdown surgery is unchanged (campaign-write.ts): the item goes to the end
 * of the section, a missing section is created at the end of the body, and
 * only the seam's blank lines are adjusted.
 */
export function appendThreadItem(body: string, item: string): string {
  const heading = /^## Offene Fäden[ \t]*\r?$/m.exec(body);
  if (heading === null) {
    let base = body;
    if (base.length > 0 && !base.endsWith("\n")) base += "\n";
    if (base.length > 0 && !base.endsWith("\n\n")) base += "\n";
    return `${base}## Offene Fäden\n\n${item}\n`;
  }
  const nlAfterHeading = body.indexOf("\n", heading.index);
  const sectionStart = nlAfterHeading === -1 ? body.length : nlAfterHeading + 1;
  const nextHeading = /^#{1,6}[ \t]/m.exec(body.slice(sectionStart));
  const sectionEnd = nextHeading === null ? body.length : sectionStart + nextHeading.index;
  const section = body.slice(sectionStart, sectionEnd).replace(/\s+$/, "");
  const newSection = section === "" ? `\n${item}\n` : `${section}\n${item}\n`;
  const rest = body.slice(sectionEnd);
  return body.slice(0, sectionStart) + newSection + (rest === "" ? "" : `\n${rest}`);
}

/**
 * POST /api/:campaign/review/thread — append `- [ ] text` under
 * `## Offene Fäden` of the chapter. 404 for an unknown chapter (the DIRECTORY
 * had to exist before; the chapter ROW has to exist now — same answer).
 */
export async function appendThreadToChapter(
  campaign: string,
  chapter: string,
  text: string,
): Promise<EntryResponse> {
  assertSafeChapterId(chapter);
  return mutate(campaign, (tx) => {
    const row = chapterRowOf(tx, campaign, chapter);
    if (row === undefined) throw new ApiError(404, "chapter not found");
    const next: ChapterRow = {
      ...row,
      body: appendThreadItem(row.body, `- [ ] ${text}`),
      rev: row.rev + 1,
    };
    tx.update(chapters)
      .set({ body: next.body, rev: next.rev })
      .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, chapter)))
      .run();
    indexChapter(tx, campaign, next);
    return renderChapter(next);
  });
}

/**
 * Entity ids are kebab slugs — the README's stable reference keys. The rule
 * itself lives in `@grimoire/shared/slug` (the create
 * endpoints DERIVE ids from typed titles and the app has to derive the same
 * ones), and is re-exported here because this module is where the server's
 * callers have always read it.
 */
export { ENTITY_SLUG };

/**
 * POST /api/:campaign/review/npc-stub — the review's "#npc line becomes an
 * npc". This is one of the two ways an entry comes into existence, and it is
 * an explicit one: the DM clicks it on a log line. CREATE OR LINK — the
 * caller's goal is that this id has an entry afterwards, so it is idempotent.
 *
 *   * no row      -> create it with the given name and the log text under
 *                   `## Notizen`;
 *   * EMPTY row   -> fill it (the DM created it earlier and typed nothing,
 *                   and the review is the first thing that knows a name and
 *                   a note);
 *   * filled row  -> return it UNTOUCHED, so the app links to what is there.
 *                   Nothing is overwritten, and the old `409 { path }` is
 *                   gone: it made the DM correct an id that was right.
 *
 * `status` keeps the column default ("unknown"). It used to insert "alive",
 * which contradicted both the route's own documentation and the dialog text,
 * and claimed something no log line ever said.
 */
export async function createNpcStub(
  campaign: string,
  id: string,
  name?: string,
  note?: string,
): Promise<EntryResponse> {
  if (!ENTITY_SLUG.test(id)) {
    throw new ApiError(400, "id must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  return mutate(campaign, (tx) => {
    // `## Notizen` is the app-managed review section (README) — always there
    // in a new entry, so later review notes have their place.
    const body = note === undefined ? "\n## Notizen\n" : `\n## Notizen\n\n- ${note}\n`;
    const existing = npcRowOf(tx, campaign, id);
    if (existing !== undefined) {
      if (!isEmptyNpcRow(existing)) return renderNpc(existing);
      tx.update(npcs)
        .set({ name: name ?? "", body, rev: existing.rev + 1 })
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, id)))
        .run();
    } else {
      // `name: ""` means "the id is the name" (render.ts applies that
      // fallback once) — no redundant copy of the key in the row.
      tx.insert(npcs)
        .values({ campaignId: campaign, id, name: name ?? "", body })
        .run();
    }
    const row = npcRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "npc could not be created");
    indexNpc(tx, campaign, row);
    return renderNpc(row);
  });
}

// --- the generator's apply step ------------------------------------------------

export interface EntityDraft {
  /** Campaign-relative target path (the generator's own addressing). */
  rel: string;
  /**
   * The ADDRESS the row will actually have — `rel` with the id segment taken
   * from the properties (generator.ts `draftAddress`). The conflict check
   * asks about this, `rel` is only what a 409 reports back to the client.
   */
  address: string;
  properties: Record<string, unknown>;
  body: string;
}

/**
 * Insert one generated entity (scene, npc, location stub or a new chapter's
 * metadata) — the database half of `POST /generate/apply`. The caller has
 * already validated everything and checked for conflicts; this is the write.
 */
export function insertDraft(tx: GrimoireDb, campaign: string, draft: EntityDraft): void {
  const locator = locatorFromPath(draft.rel);
  const fm = draft.properties;
  switch (locator.kind) {
    case "scene": {
      const id = asStr(fm.id, locator.id);
      const title = asStr(fm.title, id);
      const npcRefs = asStrArray(fm.npcs);
      const tags = asStrArray(fm.tags);
      const draftLocation = sceneLocation(fm.location);
      // The scene's chapter is written in THIS transaction, before the scene
      // itself: a „Neues Kapitel" run creates its chapter from the run's own
      // state (generator.ts `jobChapterTarget`), and this is the net under
      // it. Everything else the scene references has to be there already —
      // the drafts are sorted so the entries a scene names go in first
      // (`inReferenceOrder`), and a proposal that names one the batch does
      // not bring along is refused instead of leaving a hole behind.
      if (locator.chapterId !== null) ensureChapterRow(tx, campaign, locator.chapterId);
      assertChapterRef(tx, campaign, locator.chapterId);
      assertLocationRef(tx, campaign, draftLocation);
      assertNpcRefs(tx, campaign, npcRefs);
      const pos =
        (tx
          .select({ pos: scenes.pos })
          .from(scenes)
          .where(eq(scenes.campaignId, campaign))
          .orderBy(desc(scenes.pos))
          .limit(1)
          .all()[0]?.pos ?? -1) + 1;
      tx.insert(scenes)
        .values({
          campaignId: campaign,
          id,
          chapterId: locator.chapterId,
          title,
          type: asStr(fm.type, "planned"),
          trigger: asOptStr(fm.trigger),
          location: draftLocation,
          status: asStr(fm.status, "draft"),
          handouts: packJson(asStrArray(fm.handouts)),
          body: draft.body,
          pos,
        })
        .run();
      replaceSceneRefs(tx, campaign, id, npcRefs, tags);
      const row = sceneRowOf(tx, campaign, id);
      if (row !== undefined) indexScene(tx, campaign, row, tags);
      return;
    }
    case "npc": {
      const id = asStr(fm.id, locator.id);
      const npcChapter = asOptStr(fm.chapter);
      assertChapterRef(tx, campaign, npcChapter);
      const values = {
        name: asStr(fm.name, id),
        role: asOptStr(fm.role),
        chapterId: npcChapter,
        status: asStr(fm.status, NPC_DEFAULT_STATUS),
        statblock: asOptStr(fm.statblock),
        quickstats: packJson(asMap(fm.quickstats)),
        voice: asOptStr(fm.voice),
        appearance: asOptStr(fm.appearance),
        body: draft.body,
      };
      // An entry the DM created and left empty is FILLED — inserting would
      // collide with a row that holds nothing to lose.
      const existing = npcRowOf(tx, campaign, id);
      if (existing !== undefined) {
        tx.update(npcs)
          .set({ ...values, rev: existing.rev + 1 })
          .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, id)))
          .run();
      } else {
        tx.insert(npcs)
          .values({ campaignId: campaign, id, ...values })
          .run();
      }
      const row = npcRowOf(tx, campaign, id);
      if (row !== undefined) indexNpc(tx, campaign, row);
      return;
    }
    case "location": {
      const id = asStr(fm.id, locator.id);
      const locationChapter = asOptStr(fm.chapter);
      assertChapterRef(tx, campaign, locationChapter);
      const values = {
        name: asStr(fm.name, id),
        chapterId: locationChapter,
        roll20Page: asOptStr(fm["roll20-page"]),
        body: draft.body,
      };
      // Fill an empty entry rather than collide with it — see the npc case.
      const existing = locationRowOf(tx, campaign, id);
      if (existing !== undefined) {
        tx.update(locations)
          .set({ ...values, rev: existing.rev + 1 })
          .where(and(eq(locations.campaignId, campaign), eq(locations.id, id)))
          .run();
      } else {
        tx.insert(locations)
          .values({ campaignId: campaign, id, ...values })
          .run();
      }
      const row = locationRowOf(tx, campaign, id);
      if (row !== undefined) indexLocation(tx, campaign, row);
      return;
    }
    case "chapter": {
      const pos =
        (tx
          .select({ pos: chapters.pos })
          .from(chapters)
          .where(eq(chapters.campaignId, campaign))
          .orderBy(desc(chapters.pos))
          .limit(1)
          .all()[0]?.pos ?? -1) + 1;
      tx.insert(chapters)
        .values({
          campaignId: campaign,
          id: locator.id,
          title: asStr(fm.title, locator.id),
          status: asOptStr(fm.status),
          body: draft.body,
          pos,
        })
        .run();
      const row = chapterRowOf(tx, campaign, locator.id);
      if (row !== undefined) indexChapter(tx, campaign, row);
      return;
    }
    default:
      throw new ApiError(400, `cannot write ${draft.rel}`);
  }
}

/**
 * Run a batch of generator writes in ONE transaction — and CHECK THE
 * CONFLICTS IN IT. The check used to sit in front of the transaction
 * (generator.ts), which left a window between "nothing exists yet" and the
 * insert: a scene created in between turned the documented
 * `409 { conflicts }` into a primary-key violation, i.e. a 500. Inside the
 * transaction there is no window, and a constraint that fires anyway is
 * translated back to the documented answer instead of escaping as a 500 —
 * either way the transaction rolls back, so a partial apply is impossible.
 *
 * `jobId` discards the generate job the drafts came from IN THE
 * SAME COMMIT. It used to be a second statement after the write: a crash in
 * between left a `done` job whose drafts were already stored, so the next
 * start offered a review that could only ever answer 409 — and a failing
 * delete turned a successful write into a 500. Both are gone now: the job row
 * disappears exactly when the drafts appear, or neither does. A stale id (a
 * newer run started meanwhile) matches nothing and is ignored, which is the
 * documented behaviour.
 */
export async function applyDrafts(
  campaign: string,
  drafts: EntityDraft[],
  jobId?: string,
  /**
   * A PARTIAL accept does not discard the job — it records what
   * it wrote on it and deletes the row only when nothing is left open. That
   * bookkeeping belongs in THIS transaction for the same reason the discard
   * does: after a crash the job and the entries it produced must not
   * disagree. When it is given it replaces the `jobId` discard entirely.
   */
  onWritten?: (tx: GrimoireDb) => void,
): Promise<void> {
  try {
    await mutate(campaign, (tx) => {
      // TWO drafts for ONE address are a conflict too. Since an empty entry
      // stopped being a conflict, the second draft no longer hit the primary
      // key: it FILLED the entry the first had just written, last write wins,
      // and the review reported a clean apply for content it had silently
      // dropped. The batch is the model's output — one hallucinated duplicate
      // id is exactly the case — so the answer is the documented one, and it
      // names both offenders.
      const duplicates = duplicateDraftRels(drafts);
      if (duplicates.length > 0) {
        throw new ApiError(409, "two drafts for the same target", { conflicts: duplicates });
      }
      const conflicts = drafts
        .filter((draft) => draftTargetExistsIn(tx, campaign, draft.address))
        .map((draft) => draft.rel);
      if (conflicts.length > 0) {
        throw new ApiError(409, "target files already exist", { conflicts });
      }
      for (const draft of inReferenceOrder(drafts)) insertDraft(tx, campaign, draft);
      if (onWritten !== undefined) {
        onWritten(tx);
      } else if (jobId !== undefined) {
        tx.delete(generateJobs)
          .where(and(eq(generateJobs.id, jobId), eq(generateJobs.campaignId, campaign)))
          .run();
      }
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isConstraintViolation(error)) {
      throw new ApiError(409, "target files already exist", {
        conflicts: drafts.map((draft) => draft.rel),
      });
    }
    throw error;
  }
}

/**
 * How the kinds of a batch are inserted: a chapter before the entries that
 * name it, an npc and a location before the scene that lists them. The
 * constraints are checked per statement, so a batch that brings the stub
 * along has to write the stub first — and the caller's order is the review's,
 * which is about reading, not about references. Nothing else about the apply
 * depends on it: the conflict check is one pass over the whole batch before
 * any insert, and what a partial accept records is keyed by address.
 */
const REFERENCE_ORDER: Record<string, number> = {
  campaign: 0,
  chapter: 1,
  npc: 2,
  location: 2,
  scene: 3,
};

/** The batch in that order, stable within a kind. */
function inReferenceOrder(drafts: EntityDraft[]): EntityDraft[] {
  const rank = (draft: EntityDraft): number => {
    try {
      return REFERENCE_ORDER[locatorFromPath(draft.rel).kind] ?? 4;
    } catch {
      // An address nothing can parse: `insertDraft` answers for it, last.
      return 4;
    }
  };
  return drafts
    .map((draft, index) => ({ draft, index }))
    .sort((a, b) => rank(a.draft) - rank(b.draft) || a.index - b.index)
    .map((entry) => entry.draft);
}

/**
 * The `rel`s of every draft whose ROW another draft in the batch claims too
 * — `rel` because that is what the review shows.
 *
 * Keyed by IDENTITY (`addressIdentity`), not by address: a scene's address
 * carries its `location`, so two drafts with the same id and
 * different locations have different addresses and the same primary key.
 * Keying on the address let that pair through, and the insert then filled
 * the row twice — last write wins, and the review reported a clean apply for
 * content it had silently dropped.
 */
function duplicateDraftRels(drafts: EntityDraft[]): string[] {
  const seen = new Map<string, number>();
  for (const draft of drafts) {
    const key = addressIdentity(draft.address);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return drafts
    .filter((draft) => (seen.get(addressIdentity(draft.address)) ?? 0) > 1)
    .map((draft) => draft.rel)
    .sort();
}

/**
 * A UNIQUE/PRIMARY KEY violation from either SQLite backend (ADR #13) — the
 * race the conflict check above cannot close, and the only constraint failure
 * that means „the target is taken".
 *
 * NAMED CONSTRAINTS ONLY, deliberately. A plain /constraint/ also matched
 * „FOREIGN KEY constraint failed", so a draft that named an entry the batch
 * does not bring turned into a 409 listing every draft as an existing target
 * — an answer about the wrong thing, and about entries that are not there.
 * A reference that names nothing is a 400 with its own code, raised by the
 * assertions before the insert; anything else is not this function's answer
 * and travels on as the error it is.
 */
function isConstraintViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(UNIQUE|PRIMARY KEY) constraint failed/i.test(message);
}

/** True when a generated target already exists (the apply step's 409). */
export async function draftTargetExists(campaign: string, rel: string): Promise<boolean> {
  return draftTargetExistsIn(await getDb(), campaign, rel);
}

/** The same question inside a transaction — synchronous, so it can be. */
function draftTargetExistsIn(db: GrimoireDb, campaign: string, rel: string): boolean {
  let locator: Locator;
  try {
    locator = locatorFromPath(rel);
  } catch {
    return false;
  }
  switch (locator.kind) {
    case "scene":
      return sceneRowOf(db, campaign, locator.id) !== undefined;
    // An EMPTY npc/location entry is not a conflict: the DM created the id
    // and typed nothing, and the generated entity is exactly what fills it.
    // An entry with content still answers 409.
    case "npc": {
      const row = npcRowOf(db, campaign, locator.id);
      return row !== undefined && !isEmptyNpcRow(row);
    }
    case "location": {
      const row = locationRowOf(db, campaign, locator.id);
      return row !== undefined && !isEmptyLocationRow(row);
    }
    case "chapter":
      return chapterRowOf(db, campaign, locator.id) !== undefined;
    case "campaign":
      return (campaignRow(db, campaign)?.name ?? "") !== "";
    default:
      return false;
  }
}

/** True when the campaign has a chapter with this id (generator target check). */
export async function chapterExists(campaign: string, chapter: string): Promise<boolean> {
  const db = await getDb();
  return chapterRowOf(db, campaign, chapter) !== undefined;
}

// --- creating content --------------------------------------------------------
//
// Until now nothing in the app could bring a row into existence on purpose. A
// row appeared as a side effect — the markdown import, the generator's apply
// step — so a fresh instance, which is what every installation is, was a dead
// end. These five functions are the deliberate half:
// campaign, chapter, scene, npc, ort.
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
//      into the section the pool reads it from (`## Ziel des Kapitels`).
//
// EMPTY ENTRIES ARE FILLED, NOT COLLIDED WITH — for npc and ort, the two kinds
// that have an empty state at all. An entry that holds nothing but its id is
// one the DM created and did not fill in, and "NPC anlegen" for exactly that
// id is what fills it. That is the same rule `createNpcStub` and the
// generator's apply step follow.
//
// …but only for the id the DM TYPED. An empty entry is empty, not unclaimed: a
// scene may reference it, so the id is already spoken for. Filling it is
// therefore the DM's own decision about that one id, never something a
// machine-made PROPOSAL may slide into: rule 2's `suggestion` skips every
// existing entry, empty ones included, so „Holm" next to a filled `holm` and
// an empty `holm-2` proposes `holm-3` — while typing „Holm 2" still fills
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
function slugTaken(kind: ErrorKind, id: string, suggestion: string, path: string): ApiError {
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
 * („… ist ein reservierter Name"), and a catalog cannot say that from a code
 * that also means "somebody else has it". `path` is "" because nothing is in
 * the way; there is no entry to link to.
 */
function slugReserved(kind: ErrorKind, id: string, suggestion: string): ApiError {
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
function resolveNewId(
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

/**
 * POST /api/campaigns { name, description? } -> CampaignSummary.
 *
 * The one create that cannot go through `mutate`: there is no campaign yet, so
 * there is no `version` to bump — the row starts at the column defaults, and
 * its own first version IS the change.
 *
 * A campaign id has NO reserved names, and that was checked rather than
 * assumed: `RESERVED_SEGMENTS` reserves first segments INSIDE a campaign, and
 * the api mounts no `/:campaign` route that a literal (`/api/campaigns`) could
 * be shadowed by — `/api/campaigns/tree` is the campaign `campaigns`, `GET
 * /api/campaigns` is the list, and both keep working. What is refused is an id
 * that is no id: an empty one, one a name yields nothing for, or an explicit
 * one that is no slug (`resolveNewId`), plus the path-safety rules
 * (`assertSafeCampaignId`).
 */
export async function createCampaign(
  name: string,
  description?: string,
  explicitId?: string,
): Promise<CampaignSummary> {
  const id = resolveNewId(explicitId, name, "campaign", "name");
  assertSafeCampaignId(id);
  const db = await getDb();
  return db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    if (campaignRow(tx, id) !== undefined) {
      const suggestion = freeSlug(id, (candidate) => campaignRow(tx, candidate) !== undefined);
      // `path` in this 409 is an ADDRESS the app can link to, and a campaign id
      // alone is not one. The entry that always exists — even for a campaign
      // that holds nothing else — is the campaign row itself (`campaign`), so
      // that is what is pointed at. It carries the campaign id as its first
      // segment because a campaign collision has no campaign scope to be
      // relative to, unlike every other create in this file.
      throw slugTaken("campaign", id, suggestion, `${id}/${CAMPAIGN_PATH}`);
    }
    // `name === id` is stored as "" — the empty name means "fall back to the
    // id" everywhere it is rendered (./render, ./read), exactly as
    // `patchProperties` stores it, so the round trip agrees.
    tx.insert(campaigns)
      .values({
        id,
        name: name.trim() === id ? "" : name.trim(),
        description: description === undefined || description.trim() === "" ? null : description.trim(),
      })
      .run();
    const row = campaignRow(tx, id);
    if (row === undefined) throw new ApiError(500, "campaign could not be created");
    indexCampaign(tx, row);
    const summary: CampaignSummary = { id: row.id, name: campaignDisplayName(row) };
    if (row.description !== null && row.description.trim() !== "") {
      summary.description = row.description;
    }
    return summary;
  }) as CampaignSummary;
}

/**
 * POST /api/:campaign/chapters { title, goal? } -> the chapter entry.
 *
 * `goal` is optional and lands under `## Ziel des Kapitels` — the heading the
 * pool reads its goal line from (routes/pool.tsx). Without it the body stays
 * empty rather than carrying an empty section.
 */
export async function createChapter(
  campaign: string,
  title: string,
  goal?: string,
  explicitId?: string,
): Promise<EntryResponse> {
  const id = resolveNewId(explicitId, title, "chapter", "title");
  assertSafeChapterId(id);
  // A reserved id would create an unreachable chapter — see the notes above.
  // Both guards share one "is this id available" predicate, so the proposal
  // cannot land on a reserved id either.
  return mutate(campaign, (tx) => {
    const unavailable = (candidate: string): boolean =>
      RESERVED_SEGMENTS.has(candidate) || chapterRowOf(tx, campaign, candidate) !== undefined;
    if (RESERVED_SEGMENTS.has(id)) {
      throw slugReserved("chapter", id, freeSlug(id, unavailable));
    }
    if (chapterRowOf(tx, campaign, id) !== undefined) {
      throw slugTaken("chapter", id, freeSlug(id, unavailable), chapterPath(id));
    }
    const trimmedGoal = goal?.trim() ?? "";
    const body = trimmedGoal === "" ? "" : `## Ziel des Kapitels\n\n${trimmedGoal}\n`;
    tx.insert(chapters)
      .values({
        campaignId: campaign,
        id,
        title: title.trim(),
        // A chapter is born `planned`, like the one `ensureChapterRow`
        // creates: the status has three positions now, and every chapter
        // should start at one the DM can read instead of at none at all.
        status: CHAPTER_PLANNED,
        body,
        pos: nextPos(
          tx.select({ pos: chapters.pos }).from(chapters).where(eq(chapters.campaignId, campaign)).all(),
        ),
      })
      .run();
    const row = chapterRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "chapter could not be created");
    indexChapter(tx, campaign, row);
    return renderChapter(row);
  });
}

/**
 * POST /api/:campaign/chapters/:id/active -> the chapter entry.
 *
 * „Aktiv" in the overview's status control. ONE call, ONE transaction,
 * because it is ONE decision about two chapters: the one named here becomes
 * `active` and whatever was active before goes back to `planned`. Two
 * requests from the app would have a window in which the campaign has two
 * active chapters — and the session view picks the FIRST one it finds, so
 * that window is a wrong session view, not a cosmetic race.
 *
 * The swap itself is `clearOtherActiveChapters`, which a `PATCH /properties`
 * setting `active` runs too: the rule belongs to the column, not to this
 * endpoint. Every other status a chapter carries is left alone — this action
 * decides which chapter is active, nothing else.
 *
 * NO rev guard, deliberately, and it is the one write here without one: there
 * is nothing to overwrite. The overview shows no rev (the tree carries none),
 * the action sets a value rather than editing text, and its whole point is
 * that it also changes a chapter the caller never read. Two racing callers end
 * with one active chapter either way — which is the rule that matters.
 * `PATCH /properties` on a chapter keeps its rev guard, so the properties
 * dialog is a guarded write that happens to also swap.
 *
 * 404 for a chapter that does not exist; idempotent for one that is already
 * active.
 */
export async function setActiveChapter(campaign: string, id: string): Promise<EntryResponse> {
  assertSafeChapterId(id);
  return mutate(campaign, (tx) => {
    const target = chapterRowOf(tx, campaign, id);
    if (target === undefined) throw new ApiError(404, `unknown chapter: ${id}`);
    clearOtherActiveChapters(tx, campaign, id);
    if (target.status !== CHAPTER_ACTIVE) {
      tx.update(chapters)
        .set({ status: CHAPTER_ACTIVE, rev: target.rev + 1 })
        .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, id)))
        .run();
    }
    const row = chapterRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "chapter could not be updated");
    indexChapter(tx, campaign, row);
    return renderChapter(row);
  });
}

/**
 * POST /api/:campaign/scenes { title, chapter } -> the scene entry.
 *
 * The chapter is REQUIRED and has to exist (400 otherwise): a scene's chapter
 * is part of its address, and a scene under an unknown chapter has no node to
 * hang in — the same rule `assertChapterRef` enforces for a properties patch,
 * and the same code (ADR #19, a mention creates nothing).
 *
 * A scene created here has no `location`, so it sits at chapter level and
 * the app lists it under „Ohne Ort". Setting one later is `PATCH /properties`
 * — and that patch is also what moves the scene into the
 * location's group, address included.
 */
export async function createScene(
  campaign: string,
  title: string,
  chapter: string,
  explicitId?: string,
): Promise<EntryResponse> {
  const id = resolveNewId(explicitId, title, "scene", "title");
  assertSafeChapterId(chapter);
  return mutate(campaign, (tx) => {
    if (!chapterIdExists(tx, campaign, chapter)) {
      throw unknownRef("chapter_unknown", "chapter", chapter);
    }
    const existing = sceneRowOf(tx, campaign, id);
    if (existing !== undefined) {
      const suggestion = freeSlug(
        id,
        (candidate) => sceneRowOf(tx, campaign, candidate) !== undefined,
      );
      throw slugTaken(
        "scene",
        id,
        suggestion,
        sceneAddress({
          chapterId: existing.chapterId ?? chapter,
          location: existing.location,
          id: existing.id,
        }),
      );
    }
    tx.insert(scenes)
      .values({
        campaignId: campaign,
        id,
        chapterId: chapter,
        title: title.trim(),
        pos: nextPos(
          tx.select({ pos: scenes.pos }).from(scenes).where(eq(scenes.campaignId, campaign)).all(),
        ),
      })
      .run();
    const row = sceneRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "scene could not be created");
    indexScene(tx, campaign, row, []);
    return renderScene(row, [], []);
  });
}

/** POST /api/:campaign/npcs { name } -> the npc entry (see the notes above). */
export async function createNpc(
  campaign: string,
  name: string,
  explicitId?: string,
): Promise<EntryResponse> {
  const id = resolveNewId(explicitId, name, "npc", "name");
  return mutate(campaign, (tx) => {
    const existing = npcRowOf(tx, campaign, id);
    if (existing !== undefined && !isEmptyNpcRow(existing)) {
      // Any existing row is taken for the PROPOSAL — an empty one too: the
      // DM created that id, so proposing it would hand them somebody else's
      // entry under a name they never typed (see the notes above).
      const suggestion = freeSlug(id, (candidate) => npcRowOf(tx, campaign, candidate) !== undefined);
      throw slugTaken("npc", id, suggestion, npcPath(id));
    }
    const stored = name.trim() === id ? "" : name.trim();
    if (existing === undefined) {
      tx.insert(npcs).values({ campaignId: campaign, id, name: stored }).run();
    } else {
      // An entry the DM created and left empty — this call fills it.
      tx.update(npcs)
        .set({ name: stored, rev: existing.rev + 1 })
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, id)))
        .run();
    }
    const row = npcRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "npc could not be created");
    indexNpc(tx, campaign, row);
    return renderNpc(row);
  });
}

/** POST /api/:campaign/locations { name } -> the location entry. */
export async function createLocation(
  campaign: string,
  name: string,
  explicitId?: string,
): Promise<EntryResponse> {
  const id = resolveNewId(explicitId, name, "location", "name");
  return mutate(campaign, (tx) => {
    const existing = locationRowOf(tx, campaign, id);
    if (existing !== undefined && !isEmptyLocationRow(existing)) {
      // Same as for an npc: an empty entry is claimed, so it is never proposed.
      const suggestion = freeSlug(
        id,
        (candidate) => locationRowOf(tx, campaign, candidate) !== undefined,
      );
      throw slugTaken("location", id, suggestion, locationPath(id));
    }
    const stored = name.trim() === id ? "" : name.trim();
    if (existing === undefined) {
      tx.insert(locations).values({ campaignId: campaign, id, name: stored }).run();
    } else {
      tx.update(locations)
        .set({ name: stored, rev: existing.rev + 1 })
        .where(and(eq(locations.campaignId, campaign), eq(locations.id, id)))
        .run();
    }
    const row = locationRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "location could not be created");
    indexLocation(tx, campaign, row);
    return renderLocation(row);
  });
}

