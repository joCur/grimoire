// The write side of the store (issue #57): every write endpoint as database
// statements.
//
// What is UNCHANGED (this is the contract the ported tests pin):
//
//   * the response of every write is still the `FileResponse` of the row it
//     touched, rendered by ./render;
//   * optimistic concurrency still answers `409 { error, mtimeMs }` — only
//     the token behind `mtimeMs` is now the row's `rev` instead of a file
//     mtime. That is what fixes issue #37: two writes inside the same second
//     used to see the same mtime and both went through; two writes against
//     the same `rev` cannot;
//   * the session state machine keeps its answers and codes
//     (`session_running`, `session_not_empty` — `session_ended` is gone with
//     the resume semantics, issue #58), and
//     `clock.ts` is untouched — session ids, `started`/`ended` and log times
//     stay zone-less local strings produced by the server;
//   * append-only stays append-only: log lines and inbox entries grow by
//     rows through their own endpoints, and the one documented exception
//     (an inbox entry marked done) is the `done` flag.
//
// What is NEW: a write is one TRANSACTION that also bumps
// `campaigns.version` — the counter `GET /version` answers, which replaced
// the chokidar watcher (DECISIONS #9, planning section 4). Both the content
// change and the version bump commit together, so a client poll can never
// see a bumped version without the change.

import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  isEnded,
  isSessionEmpty,
  type FileResponse,
} from "@grimoire/shared";
import { ApiError, assertSafeRelativeMdPath } from "../campaign-fs";
import { localDate, localDateTimeSeconds, localTime, now } from "../clock";
import type { GrimoireDb } from "../db/client";
import {
  logLineShortHash,
  parseGlossaryBody,
  parseRelationsSection,
  removeRelationLines,
} from "../db/import-markdown";
import {
  campaigns,
  chapters,
  generateJobs,
  glossary,
  inboxEntries,
  locations,
  logEntries,
  npcRelations,
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
  logRows,
  pauseRows,
  pickSession,
  playedScenes,
  relationRows,
  renderSessionRow,
  requireCampaign,
  sessionRow,
} from "./read";
import { locatorFromPath, type Locator } from "./paths";
import {
  renderCampaign,
  renderChapter,
  renderGlossary,
  renderInbox,
  renderLocation,
  renderNpc,
  renderNpcBody,
  renderScene,
  type CampaignRow,
  type ChapterRow,
  type LocationRow,
  type NpcRow,
  type SceneRow,
  type SessionRow,
} from "./render";

export { logLineShortHash };

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

/** The optimistic-concurrency check: the row's `rev` must be the one read. */
function guardRev(current: number, sent: number, what: string): void {
  if (current !== sent) {
    throw new ApiError(409, `${what} — reload before saving`, { mtimeMs: current });
  }
}

/** Keys that would hit Object.prototype machinery instead of data. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// --- defensive coercions (frontmatter is hand-edited) ------------------------

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
 * The frontmatter minus the keys a table has columns for — the `extra` half.
 *
 * `keepAnyway` is the exception, and it exists for ONE case: a contract key
 * whose COLUMN cannot hold the authored value. The migration preserves a
 * misshapen `quickstats:` (a string where the format wants a mapping) in
 * `extra`, the renderer shows it because the column is empty — and the first
 * `PATCH /frontmatter` used to drop it here, silently, against the round-trip
 * rule (schema.ts rule 1). Naming the key keeps it where it is readable.
 */
function extraOf(
  fm: Record<string, unknown>,
  contract: readonly string[],
  keepAnyway: readonly string[] = [],
): string {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (!contract.includes(key) || keepAnyway.includes(key)) extra[key] = value;
  }
  return packJson(extra);
}

/** A `quickstats:` value the column cannot hold (the format wants a mapping). */
function misshapenQuickstats(value: unknown): readonly string[] {
  if (value === undefined || value === null) return [];
  const isMapping = typeof value === "object" && !Array.isArray(value);
  return isMapping ? [] : ["quickstats"];
}

/**
 * Apply a flat frontmatter patch to a rendered frontmatter mapping (`null`
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
 * Re-index everything whose BODY references `slug` (issue #68).
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

/**
 * ONE rule for the npc index (they disagreed before: a frontmatter patch
 * indexed the STRIPPED body, a body save the full one — so a search for a
 * relationship note stopped matching after an unrelated status change):
 * the indexed text is the npc's FULL document text, `## Beziehungen`
 * included, exactly as `GET /file` renders it.
 */
function indexNpc(
  tx: GrimoireDb,
  campaign: string,
  row: NpcRow,
  relations: Array<{ otherNpcId: string; note: string }>,
): void {
  indexEntity(tx, campaign, {
    kind: "npc",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: row.role ?? "",
    body: expandBodyRefs(tx, campaign, renderNpcBody(row, relations)),
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
// here is half-supported any more (issue #68 review).
function indexCampaign(tx: GrimoireDb, row: CampaignRow): void {
  indexEntity(tx, row.id, {
    kind: "campaign",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: "",
    body: expandBodyRefs(tx, row.id, row.body),
  });
}

function indexGlossaryTerm(
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
 * The scene a `{ kind: "scene" }` locator addresses — 404 unless the path
 * names the scene's CURRENT chapter and group too. Same rule as the read side
 * (read.ts `readByLocator`): a path with the wrong chapter is a stale link,
 * and a write must not silently land on the row it happens to share an id
 * with. Without this a write through a stale link answered 200 while the
 * matching GET answered 404.
 */
function sceneRowAt(
  tx: GrimoireDb,
  campaign: string,
  locator: Extract<Locator, { kind: "scene" }>,
): SceneRow {
  const row = sceneRowOf(tx, campaign, locator.id);
  if (row === undefined) throw new ApiError(404, "file not found");
  if ((row.chapterId ?? "") !== locator.chapterId || row.groupSlug !== locator.groupSlug) {
    throw new ApiError(404, "file not found");
  }
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

function nextPos(rows: Array<{ pos: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.pos), -1) + 1;
}

// --- "referencing creates" (issue #70) ---------------------------------------
//
// In the file era a referenced id without a file was a legal, permanent hole:
// the app showed "NPC-Eintrag fehlt" and offered a stub. In the database
// (#52/#13) an npc without information IS a row with an id and a name, so a
// reference can be EMPTY but never MISSING. Every write that INTRODUCES a
// reference therefore creates the referenced row in the SAME transaction:
// scene `npcs`, a scene `location` that is a slug, and the counterpart of a
// `## Beziehungen` line — in the UI write paths and in the generator's apply
// step alike.
//
// THE BOUNDARY, and it is deliberate: only a KEBAB-CASE SLUG is a reference.
// `location: Der alte Hafen` (spaces, capitals) is free text the format
// explicitly allows (README) and stays exactly that — text, no row, no card.
// A slug-shaped free text (`location: hafen`) is indistinguishable from a
// reference and is therefore treated as one; that is the price of the
// format's one ambiguous field, and it is why there is no blanket backfill of
// existing data (see `backfillReferencedNpcs`).
//
// ONLY NEW references are created on a frontmatter patch: an unrelated
// `PATCH { status }` re-sends the scene's existing `location`, and
// materialising THAT would retroactively turn every legacy free-text place
// name into an entity nobody authored.

/** An empty row for `id`, unless the id is no slug or already has a row. */
function ensureNpcRow(tx: GrimoireDb, campaign: string, id: string): boolean {
  if (!ENTITY_SLUG.test(id)) return false;
  if (npcRowOf(tx, campaign, id) !== undefined) return false;
  // Nothing but the id: `name` stays "" because the id IS the display name
  // until somebody types one (render.ts applies that fallback once), and
  // `status` keeps its column default — an empty entry claims nothing.
  tx.insert(npcs).values({ campaignId: campaign, id }).run();
  const row = npcRowOf(tx, campaign, id);
  if (row !== undefined) indexNpc(tx, campaign, row, []);
  return true;
}

/** The same for a location — a scene's `location` when it is a slug. */
function ensureLocationRow(tx: GrimoireDb, campaign: string, id: string): boolean {
  if (!ENTITY_SLUG.test(id)) return false;
  if (locationRowOf(tx, campaign, id) !== undefined) return false;
  tx.insert(locations).values({ campaignId: campaign, id }).run();
  const row = locationRowOf(tx, campaign, id);
  if (row !== undefined) indexLocation(tx, campaign, row);
  return true;
}

/**
 * An entry that holds NOTHING but its id — what `ensureNpcRow` creates, and
 * what a DM leaves behind by creating an entry and not filling it in.
 *
 * It matters in one place: the generator's apply step. A scene draft that
 * names `holm` creates the empty `holm` row, so the npc draft for `holm` in
 * the SAME batch (or a stub the DM referenced last week) would otherwise
 * collide with itself and answer the documented `409 { conflicts }` for a
 * target that has no content to lose. An empty row is therefore not a
 * conflict: the generated entity FILLS it.
 */
function isEmptyNpcRow(row: NpcRow): boolean {
  return (
    row.name === "" &&
    row.role === null &&
    row.chapterId === null &&
    row.statblock === null &&
    row.voice === null &&
    row.appearance === null &&
    row.body.trim() === "" &&
    isEmptyJsonObject(row.quickstats) &&
    isEmptyJsonObject(row.extra)
  );
}

function isEmptyLocationRow(row: LocationRow): boolean {
  return (
    row.name === "" &&
    row.chapterId === null &&
    row.roll20Page === null &&
    row.body.trim() === "" &&
    isEmptyJsonObject(row.extra)
  );
}

function isEmptyJsonObject(packed: string): boolean {
  const trimmed = packed.trim();
  return trimmed === "" || trimmed === "{}";
}

/**
 * The BOOT BACKFILL (issue #70) — for npcs, and deliberately ONLY for npcs.
 *
 * Lazy creation alone would leave the migrated stock in the old state: a
 * scene that has listed `holm` since the file era keeps a dangling id until
 * somebody happens to save that scene. So every boot closes the gap for the
 * references that are UNAMBIGUOUS:
 *
 *   * `scene_npcs.npc_id` — the key of a list that only ever held npc ids;
 *   * `npc_relations.other_npc_id` — the counterpart of a `## Beziehungen`
 *     line, likewise an id by format.
 *
 * NOT `scenes.location`. That field holds an id OR a free string (README),
 * and a slug-shaped free text (`location: bucht`) is indistinguishable from
 * a reference. A blanket pass would invent Orte the DM never wrote, into a
 * list the DM has to look at, with no undo in the tool — so the location
 * half stays LAZY: the next write that touches the field creates the row,
 * because there a human has just typed the value and meant it.
 *
 * Idempotent by construction (it only inserts what has no row) and cheap: two
 * anti-joins per campaign. Returns the ids it created, for the boot log.
 */
export function backfillReferencedNpcs(tx: GrimoireDb, campaign: string): string[] {
  const referenced = new Set<string>();
  for (const row of tx
    .select({ id: sceneNpcs.npcId })
    .from(sceneNpcs)
    .where(eq(sceneNpcs.campaignId, campaign))
    .all()) {
    referenced.add(row.id);
  }
  for (const row of tx
    .select({ id: npcRelations.otherNpcId })
    .from(npcRelations)
    .where(eq(npcRelations.campaignId, campaign))
    .all()) {
    referenced.add(row.id);
  }
  const created: string[] = [];
  for (const id of referenced) {
    if (ensureNpcRow(tx, campaign, id)) created.push(id);
  }
  return created.sort();
}

// --- scene reference tables ---------------------------------------------------

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

function replaceRelations(tx: GrimoireDb, campaign: string, npcId: string, body: string): string {
  const parsed = parseRelationsSection(body);
  tx.delete(npcRelations)
    .where(and(eq(npcRelations.campaignId, campaign), eq(npcRelations.npcId, npcId)))
    .run();
  for (const relation of parsed.relations) {
    // The counterpart gets its own (empty) row if it has none — issue #70.
    // Until now `npc_relations` was asymmetrically legal: a relation TO an
    // npc without a row was storable, one FROM it was not (the owner side
    // has a foreign key). Both sides are rows now.
    if (relation.otherNpcId !== npcId) ensureNpcRow(tx, campaign, relation.otherNpcId);
    tx.insert(npcRelations)
      .values({
        campaignId: campaign,
        npcId,
        otherNpcId: relation.otherNpcId,
        note: relation.note,
        pos: relation.pos,
      })
      .run();
  }
  // Only the LINES that became rows leave the body — the renderer puts those
  // back. Everything the parser could not turn into a relation (prose under
  // the heading, a note without a colon, a second line for a counterpart that
  // already has a row) stays exactly where it stands: `removeSection` used to
  // cut the whole span, and with it the DM's text.
  return removeRelationLines(body);
}

/**
 * Re-index one entity from its current row — used by the rename cascade,
 * which must refresh the index row's `title` too, not only its id.
 *
 * `campaign` is a kind here because the campaign FILE is a referring body
 * like any other (store/refs.ts `REF_BODY_KINDS`): a note in `_campaign.md`
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
    if (row !== undefined) indexNpc(tx, campaign, row, relationRows(tx, campaign, id));
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

// --- PATCH /api/:campaign/frontmatter ----------------------------------------

/** Contract keys per kind — everything else lands in `extra`. */
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

/**
 * An `id` patch is refused (400). In the file tree the id was just another
 * key and patching it silently orphaned every reference to the entity; in the
 * database the id IS the primary key, and changing it is what
 * `POST /rename` does — as an update with a cascade, which is the whole point
 * of the migration (issues #29/#30).
 */
function rejectIdPatch(patch: Record<string, unknown>, current: string): void {
  if (!("id" in patch)) return;
  const next = patch.id;
  if (typeof next === "string" && next === current) return; // a no-op patch is fine
  throw new ApiError(400, "id is the primary key — use POST /rename to change it");
}

export async function patchFrontmatter(
  campaign: string,
  rel: string,
  rev: number,
  patch: Record<string, unknown>,
): Promise<FileResponse> {
  assertSafeRelativeMdPath(rel);
  const locator = locatorFromPath(rel);
  return mutate(campaign, (tx) => patchLocator(tx, campaign, locator, rev, patch));
}

function patchLocator(
  tx: GrimoireDb,
  campaign: string,
  locator: Locator,
  rev: number,
  patch: Record<string, unknown>,
): FileResponse {
  switch (locator.kind) {
    case "campaign": {
      const row = campaignRow(tx, campaign);
      if (row === undefined) throw new ApiError(404, "file not found");
      guardRev(row.rev, rev, "campaign changed");
      rejectIdPatch(patch, row.id);
      const fm = applyPatch(renderCampaign(row).frontmatter, patch);
      const name = asStr(fm.name);
      // Accepted by design: a name that EQUALS the id is stored as "" — the
      // empty name means "fall back to the id" everywhere it is rendered
      // (./render, ./read), so the round trip shows the same name back and
      // the row carries no redundant copy of its own key.
      const next: CampaignRow = {
        ...row,
        name: name === row.id ? "" : name,
        description: asOptStr(fm.description),
        extra: extraOf(fm, CAMPAIGN_KEYS),
        rev: row.rev + 1,
      };
      tx.update(campaigns)
        .set({ name: next.name, description: next.description, extra: next.extra, rev: next.rev })
        .where(eq(campaigns.id, campaign))
        .run();
      indexCampaign(tx, next);
      return renderCampaign(next);
    }
    case "chapter": {
      const row = chapterRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "file not found");
      guardRev(row.rev, rev, "chapter changed");
      rejectIdPatch(patch, row.id);
      const fm = applyPatch(renderChapter(row).frontmatter, patch);
      const next: ChapterRow = {
        ...row,
        title: asStr(fm.title, row.id),
        status: asOptStr(fm.status),
        extra: extraOf(fm, CHAPTER_KEYS),
        rev: row.rev + 1,
      };
      tx.update(chapters)
        .set({ title: next.title, status: next.status, extra: next.extra, rev: next.rev })
        .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, row.id)))
        .run();
      indexChapter(tx, campaign, next);
      return renderChapter(next);
    }
    case "scene": {
      const row = sceneRowAt(tx, campaign, locator);
      guardRev(row.rev, rev, "scene changed");
      rejectIdPatch(patch, row.id);
      const npcsBefore = refNpcs(tx, campaign, row.id);
      const before = renderScene(row, npcsBefore, refTags(tx, campaign, row.id));
      const fm = applyPatch(before.frontmatter, patch);
      const npcRefs = asStrArray(fm.npcs);
      const tags = asStrArray(fm.tags);
      // The chapter a scene belongs to is part of its ADDRESS (the path), so
      // a patch may MOVE the scene — but only into a chapter that exists
      // (400 otherwise: a scene under an unknown chapter has no node to hang
      // in and would drop out of the tree). `{ chapter: null }` deletes the
      // KEY, as it always could, and leaves the address alone.
      const declared = asOptStr(fm.chapter);
      if (declared !== null && declared !== row.chapterId && !chapterIdExists(tx, campaign, declared)) {
        throw new ApiError(400, `unknown chapter: ${declared} — create the chapter first`);
      }
      const next: SceneRow = {
        ...row,
        title: asStr(fm.title, row.id),
        type: asStr(fm.type, "planned"),
        trigger: asOptStr(fm.trigger),
        chapterId: declared ?? row.chapterId,
        chapterDeclared: declared === null ? 0 : 1,
        location: asOptStr(fm.location),
        status: asStr(fm.status, "draft"),
        handouts: packJson(asStrArray(fm.handouts)),
        extra: extraOf(fm, SCENE_KEYS),
        rev: row.rev + 1,
      };
      tx.update(scenes)
        .set({
          title: next.title,
          type: next.type,
          trigger: next.trigger,
          chapterId: next.chapterId,
          chapterDeclared: next.chapterDeclared,
          location: next.location,
          status: next.status,
          handouts: next.handouts,
          extra: next.extra,
          rev: next.rev,
        })
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, row.id)))
        .run();
      // Referencing creates (#70) — only what this patch ADDS, see the note
      // above `ensureNpcRow`.
      for (const npcId of npcRefs) {
        if (!npcsBefore.includes(npcId)) ensureNpcRow(tx, campaign, npcId);
      }
      if (next.location !== null && next.location !== row.location) {
        ensureLocationRow(tx, campaign, next.location);
      }
      replaceSceneRefs(tx, campaign, row.id, npcRefs, tags);
      indexScene(tx, campaign, next, tags);
      return renderScene(next, refNpcs(tx, campaign, row.id), refTags(tx, campaign, row.id));
    }
    case "npc": {
      const row = npcRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "file not found");
      guardRev(row.rev, rev, "npc changed");
      rejectIdPatch(patch, row.id);
      const fm = applyPatch(renderNpc(row, relationRows(tx, campaign, row.id)).frontmatter, patch);
      const quickstats = asMap(fm.quickstats);
      const next: NpcRow = {
        ...row,
        name: asStr(fm.name, row.id),
        role: asOptStr(fm.role),
        chapterId: asOptStr(fm.chapter),
        status: asStr(fm.status, "unknown"),
        statblock: asOptStr(fm.statblock),
        quickstats: packJson(quickstats),
        voice: asOptStr(fm.voice),
        appearance: asOptStr(fm.appearance),
        extra: extraOf(fm, NPC_KEYS, misshapenQuickstats(fm.quickstats)),
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
          extra: next.extra,
          rev: next.rev,
        })
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, row.id)))
        .run();
      const relations = relationRows(tx, campaign, row.id);
      indexNpc(tx, campaign, next, relations);
      return renderNpc(next, relations);
    }
    case "location": {
      const row = locationRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "file not found");
      guardRev(row.rev, rev, "location changed");
      rejectIdPatch(patch, row.id);
      const fm = applyPatch(renderLocation(row).frontmatter, patch);
      const next: LocationRow = {
        ...row,
        name: asStr(fm.name, row.id),
        chapterId: asOptStr(fm.chapter),
        roll20Page: asOptStr(fm["roll20-page"]),
        extra: extraOf(fm, LOCATION_KEYS),
        rev: row.rev + 1,
      };
      tx.update(locations)
        .set({
          name: next.name,
          chapterId: next.chapterId,
          roll20Page: next.roll20Page,
          extra: next.extra,
          rev: next.rev,
        })
        .where(and(eq(locations.campaignId, campaign), eq(locations.id, row.id)))
        .run();
      indexLocation(tx, campaign, next);
      return renderLocation(next);
    }
    case "session": {
      const row = sessionRow(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "file not found");
      guardRev(row.rev, rev, "session changed");
      rejectIdPatch(patch, row.id);
      const fm = applyPatch(renderSessionRow(tx, campaign, row).frontmatter, patch);
      patchSessionRow(tx, campaign, row, fm);
      const updated = sessionRow(tx, campaign, row.id);
      return renderSessionRow(tx, campaign, updated ?? row);
    }
    case "inbox":
    case "glossary":
      // Neither is an entity with frontmatter any more: both are lists of
      // rows (schema.ts). The file used to carry a decorative `id:` and
      // nothing else, so there is nothing a patch could mean here.
      throw new ApiError(400, "this file has no frontmatter — it is a list of entries");
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
 * Write a patched session frontmatter back onto the row and its child tables.
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
      extra: extraOf(fm, SESSION_KEYS),
      rev: row.rev + 1,
    })
    .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
    .run();

  const played = asStrArray(fm.scenes_played);
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

// --- PUT /api/:campaign/file --------------------------------------------------

/**
 * Replace the markdown BODY of one entity (issue #15). The append-only kinds
 * are still refused with 400 (DECISIONS #4): a session's log and the inbox
 * grow by rows through their own endpoints, never by a body rewrite.
 *
 * The glossary is the one body that is DECOMPOSED on the way in: it is a
 * table now (planning F6), so the markdown the editor sends is parsed back
 * into term/explanation rows — the same parser the migration used, so what
 * the DM types and what a migrated file produced agree.
 */
export async function writeFileBody(
  campaign: string,
  rel: string,
  rev: number,
  markdown: string,
): Promise<FileResponse> {
  assertSafeRelativeMdPath(rel);
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
  const body = markdown === "" || markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  return mutate(campaign, (tx) => {
    switch (locator.kind) {
      case "campaign": {
        const row = campaignRow(tx, campaign);
        if (row === undefined) throw new ApiError(404, "file not found");
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
        if (row === undefined) throw new ApiError(404, "file not found");
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
        if (row === undefined) throw new ApiError(404, "file not found");
        guardRev(row.rev, rev, "npc changed");
        // `## Beziehungen` in the edited body becomes rows again — the
        // renderer puts the section back, so an edit there is not lost.
        const stripped = replaceRelations(tx, campaign, row.id, body);
        const next: NpcRow = { ...row, body: stripped, rev: row.rev + 1 };
        tx.update(npcs)
          .set({ body: next.body, rev: next.rev })
          .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, row.id)))
          .run();
        const relations = relationRows(tx, campaign, row.id);
        indexNpc(tx, campaign, next, relations);
        return renderNpc(next, relations);
      }
      case "location": {
        const row = locationRowOf(tx, campaign, locator.id);
        if (row === undefined) throw new ApiError(404, "file not found");
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
        if (row === undefined) throw new ApiError(404, "file not found");
        // The glossary's OWN counter, not `campaigns.version`: an unrelated
        // write during a running session must not invalidate an open edit.
        guardRev(row.glossaryRev, rev, "glossary changed");
        const parsedGlossary = parseGlossaryBody(body);
        // A term typed twice would silently lose its second explanation
        // ("first wins" is the IMPORT's degrade rule, not a save's) — say so
        // instead, with the term in the message.
        const duplicate = parsedGlossary.duplicates[0];
        if (duplicate !== undefined) {
          throw new ApiError(
            400,
            `Glossar-Begriff „${duplicate}" kommt mehrfach vor — bitte zusammenfassen`,
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
        throw new ApiError(404, "file not found");
    }
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
    if (term === "" || seen.has(term)) continue; // first one wins, as in the import
    seen.add(term);
    tx.insert(glossary)
      .values({ campaignId: campaign, term, explanation: entry.explanation, pos: pos++ })
      .run();
    indexGlossaryTerm(tx, campaign, term, entry.explanation);
  }
}

/** PUT /api/:campaign/glossary `{ entries }` -> the stored list. */
export async function writeGlossary(
  campaign: string,
  entries: Array<{ term: string; explanation: string }>,
): Promise<{ entries: Array<{ term: string; explanation: string }> }> {
  return mutate(campaign, (tx) => {
    writeGlossaryRows(tx, campaign, entries);
    // Same document, same guard token: an editor holding `glossary.md` must
    // see a changed `mtimeMs` after this.
    tx.update(campaigns)
      .set({ glossaryRev: sql`${campaigns.glossaryRev} + 1` })
      .where(eq(campaigns.id, campaign))
      .run();
    return {
      entries: glossaryRows(tx, campaign).map((row) => ({
        term: row.term,
        explanation: row.explanation,
      })),
    };
  });
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
 * POST /api/:campaign/session/start — two answers (issue #58):
 *
 *   * a RUNNING session of today is returned untouched (the start button
 *     stays idempotent while the evening runs);
 *   * an OLDER running session is a 409 `session_running` — ending someone
 *     else's evening is not implied by "starten";
 *   * otherwise a NEW session is created, even when today already has ended
 *     ones. "Beenden" is final since issue #58: the new row gets its own id,
 *     an empty log and a runtime that starts at 0. The former 409
 *     `session_ended` and POST /session/resume are gone with it.
 */
export async function startSession(campaign: string): Promise<FileResponse> {
  return mutate(campaign, (tx) => {
    const d = now();
    const today = localDate(d);
    const active = pickSession(tx, campaign, false);
    // "Is the running session TODAY's?" is answered by `started`, not by the
    // id — the id is opaque since the PO decision on issue #58 and says
    // nothing about a day.
    //
    // The old degrade of this check (issue #58 review, finding 4) is GONE with
    // it: an id that did not parse as a date could never be "today", so a
    // hand-edited row answered every start with a 409 the DM had to clear by
    // hand. A row whose `started` is unreadable is not the "running session"
    // in the first place — it has no place in the chronology (store/read.ts
    // `sessionOrderKey`) — so `pickSession` never returns it here and the next
    // start simply opens a new session. `startedDate` therefore only ever
    // decides between today and an EARLIER day.
    if (active !== undefined && startedDate(active.started) !== today) {
      throw new ApiError(409, "another session is still running — end it first", {
        code: "session_running",
        path: `sessions/${active.id}.md`,
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
 * existing `ended`; an OPEN pause is closed by the end (issue #40 AK8).
 */
export async function endSession(campaign: string): Promise<FileResponse> {
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

/** Append one log line row (append-only: existing rows are never rewritten). */
function appendLogRow(tx: GrimoireDb, campaign: string, sessionId: string, raw: string): void {
  const rows = logRows(tx, campaign, sessionId);
  const LOG_LINE = /^-\s+(\d{1,2}:\d{2})(?:\s+\(([^)]+)\))?\s+(.+)$/;
  const m = LOG_LINE.exec(raw);
  tx.insert(logEntries)
    .values({
      campaignId: campaign,
      sessionId,
      pos: nextPos(rows),
      raw,
      at: m?.[1] ?? null,
      sceneId: m?.[2] ?? null,
      text: m?.[3] ?? null,
      hash: logLineShortHash(raw),
      reviewed: 0,
    })
    .run();
}

/**
 * POST /session/pause — really STOP the clock (issue #40 AK8): an open
 * `pauses` interval plus the `— Pause` log line, in the same transaction.
 * Idempotent: pausing a paused session changes nothing.
 */
export async function pauseSession(campaign: string): Promise<FileResponse> {
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
export async function continueSession(campaign: string): Promise<FileResponse> {
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
 * POST /session/discard — DELETE the active session (issue #40 AK7), the undo
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
        path: `sessions/${row.id}.md`,
      });
    }
    tx.delete(sessions)
      .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
      .run();
    return { path: `sessions/${row.id}.md` };
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
): Promise<FileResponse> {
  // The scene marker is a PARSE COLUMN of the log line (`- HH:MM (id) text`),
  // so an id carrying `)` — or a space, or a newline — would shift `text` and
  // `sceneId` apart on the way back in. Same slug rule as `createNpcStub`.
  if (sceneId !== undefined && !ENTITY_SLUG.test(sceneId)) {
    throw new ApiError(400, "sceneId must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  return mutate(campaign, (tx) => {
    const row = requireActive(tx, campaign);
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
 * rendered inbox still reads like the document it was.
 */
export async function appendInboxEntry(campaign: string, text: string): Promise<FileResponse> {
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

/** The inbox document's own guard token, bumped and returned (see read.ts). */
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
export async function markInboxLineDone(campaign: string, line: string): Promise<FileResponse> {
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
 * `reviewed` frontmatter hash list became a flag on the log row (schema.ts),
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
): Promise<FileResponse & { marked: boolean }> {
  assertSafeRelativeMdPath(rel);
  const segments = rel.split("/");
  if (segments.length !== 2 || segments[0] !== "sessions") {
    throw new ApiError(400, "path must be a sessions/*.md file");
  }
  const sessionId = (segments[1] ?? "").slice(0, -".md".length);
  const hash = logLineShortHash(line);
  return mutate(campaign, (tx) => {
    const row = sessionRow(tx, campaign, sessionId);
    if (row === undefined) throw new ApiError(404, "file not found");
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
): Promise<FileResponse> {
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

/** Entity ids are kebab slugs — the README's stable reference keys. */
export const ENTITY_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * POST /api/:campaign/review/npc-stub — the review's "#npc line becomes an
 * npc". CREATE OR LINK (issue #70): the caller's goal is that this id has an
 * entry afterwards, so the endpoint is idempotent.
 *
 *   * no row      -> create it with the given name and the log text under
 *                   `## Notizen`;
 *   * EMPTY row   -> fill it (a reference created it — #70 — and the review
 *                   is the first thing that knows a name and a note);
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
): Promise<FileResponse> {
  if (!ENTITY_SLUG.test(id)) {
    throw new ApiError(400, "id must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  return mutate(campaign, (tx) => {
    // `## Notizen` is the app-managed review section (README) — always there
    // in a new entry, so later review notes have their place.
    const body = note === undefined ? "\n## Notizen\n" : `\n## Notizen\n\n- ${note}\n`;
    const existing = npcRowOf(tx, campaign, id);
    if (existing !== undefined) {
      if (!isEmptyNpcRow(existing)) {
        const relations = relationRows(tx, campaign, id);
        return renderNpc(existing, relations);
      }
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
    indexNpc(tx, campaign, row, []);
    return renderNpc(row, []);
  });
}

// --- the generator's apply step ------------------------------------------------

export interface EntityDraft {
  /** Campaign-relative target path (the generator's own addressing). */
  rel: string;
  /**
   * The ADDRESS the row will actually have — `rel` with the id segment taken
   * from the frontmatter (generator.ts `draftAddress`). The conflict check
   * asks about this, `rel` is only what a 409 reports back to the client.
   */
  address: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Insert one generated entity (scene, npc, location stub or a new chapter's
 * metadata) — the database half of `POST /generate/apply`. The caller has
 * already validated everything and checked for conflicts; this is the write.
 */
export function insertDraft(tx: GrimoireDb, campaign: string, draft: EntityDraft): void {
  const locator = locatorFromPath(draft.rel);
  const fm = draft.frontmatter;
  switch (locator.kind) {
    case "scene": {
      const id = asStr(fm.id, locator.id);
      const title = asStr(fm.title, id);
      const npcRefs = asStrArray(fm.npcs);
      const tags = asStrArray(fm.tags);
      const draftLocation = asOptStr(fm.location);
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
          chapterDeclared: fm.chapter === undefined || fm.chapter === null ? 0 : 1,
          groupSlug: locator.groupSlug,
          title,
          type: asStr(fm.type, "planned"),
          trigger: asOptStr(fm.trigger),
          location: draftLocation,
          status: asStr(fm.status, "draft"),
          handouts: packJson(asStrArray(fm.handouts)),
          body: draft.body,
          extra: extraOf(fm, SCENE_KEYS),
          pos,
        })
        .run();
      // Referencing creates (#70): a generated scene may name an npc or a
      // location the campaign does not have yet. The validation asks the
      // model to ship a stub for it, but a draft that slips through must not
      // leave a dangling id behind — it gets an empty row, and a stub in the
      // same batch fills that row instead of colliding with it.
      for (const npcId of npcRefs) ensureNpcRow(tx, campaign, npcId);
      if (draftLocation !== null) ensureLocationRow(tx, campaign, draftLocation);
      replaceSceneRefs(tx, campaign, id, npcRefs, tags);
      const row = sceneRowOf(tx, campaign, id);
      if (row !== undefined) indexScene(tx, campaign, row, tags);
      return;
    }
    case "npc": {
      const id = asStr(fm.id, locator.id);
      // The `## Beziehungen` section becomes rows — but only AFTER the npc
      // row exists: `npc_relations` has a foreign key on (campaign, npc_id),
      // so inserting the relations first fails the constraint.
      const parsedRelations = parseRelationsSection(draft.body);
      // Only the parsed relation LINES leave the body — prose under the
      // heading stays (see `replaceRelations`).
      const stripped = removeRelationLines(draft.body);
      const values = {
        name: asStr(fm.name, id),
        role: asOptStr(fm.role),
        chapterId: asOptStr(fm.chapter),
        status: asStr(fm.status, "unknown"),
        statblock: asOptStr(fm.statblock),
        quickstats: packJson(asMap(fm.quickstats)),
        voice: asOptStr(fm.voice),
        appearance: asOptStr(fm.appearance),
        body: stripped,
        extra: extraOf(fm, NPC_KEYS, misshapenQuickstats(fm.quickstats)),
      };
      // An EMPTY row for this id already exists when something referenced the
      // npc before it was written — a scene draft in this very batch, or a
      // reference the DM typed last week (#70). Filling it is the write the
      // DM asked for; inserting would collide with a row that holds nothing.
      const existing = npcRowOf(tx, campaign, id);
      if (existing !== undefined) {
        tx.update(npcs)
          .set({ ...values, rev: existing.rev + 1 })
          .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, id)))
          .run();
        tx.delete(npcRelations)
          .where(and(eq(npcRelations.campaignId, campaign), eq(npcRelations.npcId, id)))
          .run();
      } else {
        tx.insert(npcs)
          .values({ campaignId: campaign, id, ...values })
          .run();
      }
      for (const relation of parsedRelations.relations) {
        if (relation.otherNpcId !== id) ensureNpcRow(tx, campaign, relation.otherNpcId);
        tx.insert(npcRelations)
          .values({
            campaignId: campaign,
            npcId: id,
            otherNpcId: relation.otherNpcId,
            note: relation.note,
            pos: relation.pos,
          })
          .run();
      }
      const row = npcRowOf(tx, campaign, id);
      if (row !== undefined) {
        indexNpc(tx, campaign, row, relationRows(tx, campaign, id));
      }
      return;
    }
    case "location": {
      const id = asStr(fm.id, locator.id);
      const values = {
        name: asStr(fm.name, id),
        chapterId: asOptStr(fm.chapter),
        roll20Page: asOptStr(fm["roll20-page"]),
        body: draft.body,
        extra: extraOf(fm, LOCATION_KEYS),
      };
      // Fill an empty row rather than collide with it — see the npc case.
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
          extra: extraOf(fm, CHAPTER_KEYS),
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
 * `jobId` (issue #62) discards the generate job the drafts came from IN THE
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
): Promise<void> {
  try {
    await mutate(campaign, (tx) => {
      const conflicts = drafts
        .filter((draft) => draftTargetExistsIn(tx, campaign, draft.address))
        .map((draft) => draft.rel);
      if (conflicts.length > 0) {
        throw new ApiError(409, "target files already exist", { conflicts });
      }
      for (const draft of drafts) insertDraft(tx, campaign, draft);
      if (jobId !== undefined) {
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

/** A UNIQUE/PRIMARY KEY violation from either SQLite backend (ADR #13). */
function isConstraintViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint/i.test(message);
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
    // An EMPTY npc/location row is not a conflict (#70): it holds nothing but
    // an id — put there by a reference, not by an author — and the generated
    // entity is exactly what fills it. A row with content still answers 409.
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

