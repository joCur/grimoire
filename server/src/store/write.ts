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
  meta,
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
  sessionIdDate,
  sessionIdSeq,
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

/** The frontmatter minus the keys a table has columns for — the `extra` half. */
function extraOf(fm: Record<string, unknown>, contract: readonly string[]): string {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (!contract.includes(key)) extra[key] = value;
  }
  return packJson(extra);
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

function indexScene(tx: GrimoireDb, campaign: string, row: SceneRow, tags: string[]): void {
  indexEntity(tx, campaign, {
    kind: "scene",
    entityId: row.id,
    title: row.title === "" ? row.id : row.title,
    ref: row.id,
    tags: tags.join(" "),
    body: row.body,
  });
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
    body: renderNpcBody(row, relations),
  });
}

function indexLocation(tx: GrimoireDb, campaign: string, row: LocationRow): void {
  indexEntity(tx, campaign, {
    kind: "location",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: "",
    body: row.body,
  });
}

function indexChapter(tx: GrimoireDb, campaign: string, row: ChapterRow): void {
  indexEntity(tx, campaign, {
    kind: "chapter",
    entityId: row.id,
    title: row.title === "" ? row.id : row.title,
    ref: row.id,
    tags: "",
    body: row.body,
  });
}

function indexCampaign(tx: GrimoireDb, row: CampaignRow): void {
  indexEntity(tx, row.id, {
    kind: "campaign",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: "",
    body: row.body,
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
 */
export function reindexEntity(
  tx: GrimoireDb,
  campaign: string,
  kind: "npc" | "location" | "scene" | "chapter",
  id: string,
): void {
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
      const before = renderScene(
        row,
        refNpcs(tx, campaign, row.id),
        refTags(tx, campaign, row.id),
      );
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
        extra: extraOf(fm, NPC_KEYS),
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

/** `meta` key holding the highest session sequence ever handed out on a day. */
function sessionSeqKey(campaign: string, date: string): string {
  return `session_seq:${campaign}:${date}`;
}

/**
 * The id for a NEW session on `date`: the plain date while that day has no
 * session yet, `date-2`, `date-3`, … afterwards (issue #58). Readable and
 * date-ordered like the former file name, and the plain-date rows written
 * before this need no migration — they simply are their day's first.
 *
 * An id, once handed out, NEVER comes back — not even after the session it
 * named was discarded. The existing rows alone cannot promise that: discarding
 * the trailing `-2` deletes the only trace of it, and the next start would
 * re-issue `-2` with a different evening's log rows hanging off the same
 * primary key (and off any link a DM had already written down). So the day's
 * high-water mark is PERSISTED in `meta` under `session_seq:<campaign>:<date>`
 * and only ever grows. The mark is written in the same transaction as the
 * insert; the max over the day's existing rows stays part of the decision so
 * rows that predate the mark (migrated campaigns, a hand-edited database) are
 * still respected.
 */
function nextSessionId(tx: GrimoireDb, campaign: string, date: string): string {
  const taken = tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.campaignId, campaign))
    .all()
    .filter((row) => sessionIdDate(row.id) === date);
  const key = sessionSeqKey(campaign, date);
  const stored = tx.select().from(meta).where(eq(meta.key, key)).all()[0]?.value;
  const mark = Number(stored);
  const highWater = Number.isFinite(mark) && mark > 0 ? Math.floor(mark) : 0;
  const seq = Math.max(
    highWater,
    taken.reduce((acc, row) => Math.max(acc, sessionIdSeq(row.id)), 0),
  );
  const next = seq + 1;
  tx.insert(meta)
    .values({ key, value: String(next) })
    .onConflictDoUpdate({ target: meta.key, set: { value: String(next) } })
    .run();
  return next === 1 ? date : `${date}-${next}`;
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
    const todayId = localDate(d);
    const active = pickSession(tx, campaign, false);
    // DEGRADE, accepted (issue #58 review, finding 4): a running session whose
    // id does not parse as a date (hand-edited row) has no `sessionIdDate`, so
    // it can never equal today and every start answers 409 `session_running`.
    // That is the safe direction — the alternative would silently open a
    // second live session next to it — and it is not a dead end: the 409
    // carries the running session's path, and the app's answer to this code
    // (routes/live.tsx `NoSessionYet`) is the "Alte Session beenden" button,
    // which goes through `endSession` and does NOT look at the id at all. End
    // it once and starting works again.
    if (active !== undefined && sessionIdDate(active.id) !== todayId) {
      throw new ApiError(409, "another session is still running — end it first", {
        code: "session_running",
        path: `sessions/${active.id}.md`,
      });
    }
    if (active !== undefined) return renderSessionRow(tx, campaign, active);
    const id = nextSessionId(tx, campaign, todayId);
    tx.insert(sessions)
      .values({ campaignId: campaign, id, started: localDateTimeSeconds(d) })
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
 * POST /api/:campaign/review/npc-stub — create the npc row with minimal
 * fields and the log text under `## Notizen`. An existing id is NEVER
 * overwritten -> 409 { path }.
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
    if (npcRowOf(tx, campaign, id) !== undefined) {
      throw new ApiError(409, "npc already exists — not overwriting", { path: `npcs/${id}.md` });
    }
    // `## Notizen` is the app-managed review section (README) — always there
    // in a stub, so later review notes have their place.
    const body = note === undefined ? "\n## Notizen\n" : `\n## Notizen\n\n- ${note}\n`;
    tx.insert(npcs)
      .values({ campaignId: campaign, id, name: name ?? id, status: "alive", body })
      .run();
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
          location: asOptStr(fm.location),
          status: asStr(fm.status, "draft"),
          handouts: packJson(asStrArray(fm.handouts)),
          body: draft.body,
          extra: extraOf(fm, SCENE_KEYS),
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
      // The `## Beziehungen` section becomes rows — but only AFTER the npc
      // row exists: `npc_relations` has a foreign key on (campaign, npc_id),
      // so inserting the relations first fails the constraint.
      const parsedRelations = parseRelationsSection(draft.body);
      // Only the parsed relation LINES leave the body — prose under the
      // heading stays (see `replaceRelations`).
      const stripped = removeRelationLines(draft.body);
      tx.insert(npcs)
        .values({
          campaignId: campaign,
          id,
          name: asStr(fm.name, id),
          role: asOptStr(fm.role),
          chapterId: asOptStr(fm.chapter),
          status: asStr(fm.status, "unknown"),
          statblock: asOptStr(fm.statblock),
          quickstats: packJson(asMap(fm.quickstats)),
          voice: asOptStr(fm.voice),
          appearance: asOptStr(fm.appearance),
          body: stripped,
          extra: extraOf(fm, NPC_KEYS),
        })
        .run();
      for (const relation of parsedRelations.relations) {
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
      tx.insert(locations)
        .values({
          campaignId: campaign,
          id,
          name: asStr(fm.name, id),
          chapterId: asOptStr(fm.chapter),
          roll20Page: asOptStr(fm["roll20-page"]),
          body: draft.body,
          extra: extraOf(fm, LOCATION_KEYS),
        })
        .run();
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
    case "npc":
      return npcRowOf(db, campaign, locator.id) !== undefined;
    case "location":
      return locationRowOf(db, campaign, locator.id) !== undefined;
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

