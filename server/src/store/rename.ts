// POST /api/:campaign/rename as a database UPDATE (issue #57).
//
// SCOPE NOTE: the planning puts the rename rebuild in Scheibe 3 (#29/#30).
// It could not stay behind, though — the moment the read/write endpoints stop
// touching CAMPAIGN_ROOT, the file-tree cascade of `campaign-rename.ts` is
// renaming files nobody reads any more. So the endpoint moves with the
// cutover, at exactly the size the cutover needs: the id update plus the
// reference cascade, with the response shape (`{ renamed, changed }`) and the
// error semantics (400 / 404 / 409) unchanged. What Scheibe 3 still owns is
// the `GET /usage` endpoint and the rename preview built on usage COUNTs.
//
// What the migration bought here is visible in the code below: the id IS the
// primary key, so the hard references cascade in the database
// (`ON UPDATE CASCADE`, schema.ts rule 5) and only the SOFT references — the
// ones that may legally point at an entity without a row — need statements of
// their own.

import { and, eq, sql } from "drizzle-orm";
import { ApiError } from "../campaign-fs";
import { logLineShortHash } from "../db/import-markdown";
import type { GrimoireDb } from "../db/client";
import {
  campaigns,
  chapters,
  locations,
  logEntries,
  npcRelations,
  npcs,
  sceneNpcs,
  scenes,
  sessionScenesPlayed,
} from "../db/schema";
import { dropEntity } from "./fts";
import { getDb } from "./handle";
import { requireCampaign } from "./read";
import { reindexEntity } from "./write";
import { chapterPath, locationPath, npcPath, scenePath } from "./paths";

/** The entity kinds that have a rename cascade (sessions have no id). */
export const RENAME_KINDS = ["npc", "location", "scene", "chapter"] as const;
export type RenameKind = (typeof RENAME_KINDS)[number];

export function isRenameKind(value: unknown): value is RenameKind {
  return typeof value === "string" && (RENAME_KINDS as readonly string[]).includes(value);
}

export interface RenameResult {
  renamed: { from: string; to: string };
  changed: string[];
  dryRun?: true;
}

const ID_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED = new Set(["npcs", "locations", "sessions"]);

function assertSafeIdSegment(id: string, label: string): void {
  if (
    id.length === 0 ||
    id.startsWith(".") ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0") ||
    id.includes("..")
  ) {
    throw new ApiError(400, `invalid ${label}`);
  }
}

function assertNewId(newId: string): void {
  assertSafeIdSegment(newId, "newId");
  if (!ID_SLUG.test(newId)) {
    throw new ApiError(400, "newId must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  if (RESERVED.has(newId)) throw new ApiError(400, `newId is a reserved name: ${newId}`);
}

/** Path of one entity, for the `renamed`/`changed` fields. */
function pathOf(db: GrimoireDb, campaign: string, kind: RenameKind, id: string): string {
  if (kind === "npc") return npcPath(id);
  if (kind === "location") return locationPath(id);
  if (kind === "chapter") return chapterPath(id);
  const row = db
    .select({ chapterId: scenes.chapterId, groupSlug: scenes.groupSlug })
    .from(scenes)
    .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, id)))
    .all()[0];
  return scenePath(row?.chapterId ?? "", row?.groupSlug ?? "", id);
}

function exists(db: GrimoireDb, campaign: string, kind: RenameKind, id: string): boolean {
  const table = kind === "npc" ? npcs : kind === "location" ? locations : kind === "chapter" ? chapters : scenes;
  return (
    db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.campaignId, campaign), eq(table.id, id)))
      .all().length > 0
  );
}

/**
 * The reference sites of one rename, as the paths whose CONTENT changes —
 * the same list the file cascade reported, derived from the tables that hold
 * the references now.
 */
function referenceSites(
  db: GrimoireDb,
  campaign: string,
  kind: RenameKind,
  oldId: string,
  newId: string,
): string[] {
  const changed = new Set<string>();
  const scenePathOf = (id: string): string => pathOf(db, campaign, "scene", id);

  if (kind === "npc") {
    for (const row of db
      .select({ sceneId: sceneNpcs.sceneId })
      .from(sceneNpcs)
      .where(and(eq(sceneNpcs.campaignId, campaign), eq(sceneNpcs.npcId, oldId)))
      .all()) {
      changed.add(scenePathOf(row.sceneId));
    }
    for (const row of db
      .select({ npcId: npcRelations.npcId })
      .from(npcRelations)
      .where(and(eq(npcRelations.campaignId, campaign), eq(npcRelations.otherNpcId, oldId)))
      .all()) {
      changed.add(npcPath(row.npcId));
    }
  }

  if (kind === "location") {
    for (const row of db
      .select({ id: scenes.id })
      .from(scenes)
      .where(and(eq(scenes.campaignId, campaign), eq(scenes.location, oldId)))
      .all()) {
      changed.add(scenePathOf(row.id));
    }
  }

  if (kind === "scene") {
    for (const row of db
      .select({ sessionId: sessionScenesPlayed.sessionId })
      .from(sessionScenesPlayed)
      .where(
        and(
          eq(sessionScenesPlayed.campaignId, campaign),
          eq(sessionScenesPlayed.sceneId, oldId),
        ),
      )
      .all()) {
      changed.add(`sessions/${row.sessionId}.md`);
    }
    for (const row of db
      .select({ sessionId: logEntries.sessionId })
      .from(logEntries)
      .where(and(eq(logEntries.campaignId, campaign), eq(logEntries.sceneId, oldId)))
      .all()) {
      changed.add(`sessions/${row.sessionId}.md`);
    }
  }

  if (kind === "chapter") {
    // Every scene of the chapter MOVES — its path carries the chapter id —
    // and npcs/locations that name the chapter change their reference.
    for (const row of db
      .select({ id: scenes.id, groupSlug: scenes.groupSlug })
      .from(scenes)
      .where(and(eq(scenes.campaignId, campaign), eq(scenes.chapterId, oldId)))
      .all()) {
      changed.add(scenePath(newId, row.groupSlug, row.id));
    }
    for (const row of db
      .select({ id: npcs.id })
      .from(npcs)
      .where(and(eq(npcs.campaignId, campaign), eq(npcs.chapterId, oldId)))
      .all()) {
      changed.add(npcPath(row.id));
    }
    for (const row of db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.campaignId, campaign), eq(locations.chapterId, oldId)))
      .all()) {
      changed.add(locationPath(row.id));
    }
  }

  return [...changed];
}

/**
 * A display name that was literally the OLD ID follows the id. `npcs/jorna.md`
 * with `name: jorna` is a file that never had a real name — the id was the
 * fallback, spelled out — and leaving it behind means the tree and the search
 * title keep naming a reference that does not exist any more. Files with no
 * `name:`/`title:` at all were imported as "" and fall back dynamically, so
 * this touches only the spelled-out case.
 */
function carryFallbackName(
  tx: GrimoireDb,
  campaign: string,
  kind: RenameKind,
  oldId: string,
  newId: string,
): void {
  if (kind === "npc") {
    tx.update(npcs)
      .set({ name: newId })
      .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, newId), eq(npcs.name, oldId)))
      .run();
    return;
  }
  if (kind === "location") {
    tx.update(locations)
      .set({ name: newId })
      .where(
        and(
          eq(locations.campaignId, campaign),
          eq(locations.id, newId),
          eq(locations.name, oldId),
        ),
      )
      .run();
    return;
  }
  if (kind === "chapter") {
    tx.update(chapters)
      .set({ title: newId })
      .where(
        and(eq(chapters.campaignId, campaign), eq(chapters.id, newId), eq(chapters.title, oldId)),
      )
      .run();
    return;
  }
  tx.update(scenes)
    .set({ title: newId })
    .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, newId), eq(scenes.title, oldId)))
    .run();
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite the SCENE MARKER of log lines: `- HH:MM (<oldId>) Text` (README
 * format), ported unchanged from the file cascade.
 *
 * Two rules, and both matter:
 *
 *   * ANCHORED on the timestamp, so only a real marker matches. A plain
 *     `raw.replace("(id)", …)` also hit the same token in FREE TEXT
 *     (`Improvisiert (lighthouse-arrival) am Steg`), which is prose and never
 *     a reference.
 *   * EVERY line of the value is offered the rewrite. `String.replace` with a
 *     string needle replaces the first hit only; a `raw` is one line today,
 *     but the loop is what makes that not a silent assumption.
 */
function patchLogMarkers(raw: string, oldId: string, newId: string): string {
  const marker = new RegExp(`^(\\s*-\\s+\\d{1,2}:\\d{2}\\s+\\()${escapeRe(oldId)}(\\))`);
  const lines = raw.split("\n");
  let changed = false;
  lines.forEach((line, index) => {
    const next = line.replace(marker, `$1${newId}$2`);
    if (next === line) return;
    lines[index] = next;
    changed = true;
  });
  return changed ? lines.join("\n") : raw;
}

/** The soft-reference updates of one rename (the hard ones cascade). */
function updateSoftReferences(
  tx: GrimoireDb,
  campaign: string,
  kind: RenameKind,
  oldId: string,
  newId: string,
): void {
  if (kind === "npc") {
    tx.update(sceneNpcs)
      .set({ npcId: newId })
      .where(and(eq(sceneNpcs.campaignId, campaign), eq(sceneNpcs.npcId, oldId)))
      .run();
    tx.update(npcRelations)
      .set({ otherNpcId: newId })
      .where(and(eq(npcRelations.campaignId, campaign), eq(npcRelations.otherNpcId, oldId)))
      .run();
  }
  if (kind === "location") {
    tx.update(scenes)
      .set({ location: newId })
      .where(and(eq(scenes.campaignId, campaign), eq(scenes.location, oldId)))
      .run();
  }
  if (kind === "scene") {
    tx.update(sessionScenesPlayed)
      .set({ sceneId: newId })
      .where(
        and(eq(sessionScenesPlayed.campaignId, campaign), eq(sessionScenesPlayed.sceneId, oldId)),
      )
      .run();
    tx.update(logEntries)
      .set({ sceneId: newId })
      .where(and(eq(logEntries.campaignId, campaign), eq(logEntries.sceneId, oldId)))
      .run();
    // The `raw` line the review hashes carries the marker too. It is rewritten
    // so the rendered log keeps naming the scene the DM can actually open;
    // the hash follows, exactly as the file cascade re-hashed the line.
    for (const row of tx
      .select({ sessionId: logEntries.sessionId, pos: logEntries.pos, raw: logEntries.raw })
      .from(logEntries)
      .where(and(eq(logEntries.campaignId, campaign), eq(logEntries.sceneId, newId)))
      .all()) {
      const raw = patchLogMarkers(row.raw, oldId, newId);
      if (raw === row.raw) continue;
      tx.update(logEntries)
        .set({ raw, hash: logLineShortHash(raw) })
        .where(
          and(
            eq(logEntries.campaignId, campaign),
            eq(logEntries.sessionId, row.sessionId),
            eq(logEntries.pos, row.pos),
          ),
        )
        .run();
    }
  }
  if (kind === "chapter") {
    tx.update(scenes)
      .set({ chapterId: newId })
      .where(and(eq(scenes.campaignId, campaign), eq(scenes.chapterId, oldId)))
      .run();
    tx.update(npcs)
      .set({ chapterId: newId })
      .where(and(eq(npcs.campaignId, campaign), eq(npcs.chapterId, oldId)))
      .run();
    tx.update(locations)
      .set({ chapterId: newId })
      .where(and(eq(locations.campaignId, campaign), eq(locations.chapterId, oldId)))
      .run();
  }
}

/**
 * Rename an entity id and drag every reference along, in ONE transaction.
 * `dryRun` returns the same plan and writes nothing — same code path, so a
 * preview that succeeds is a rename that will succeed.
 */
export async function renameEntity(
  campaign: string,
  kind: RenameKind,
  oldId: string,
  newId: string,
  dryRun = false,
): Promise<RenameResult> {
  await requireCampaign(campaign);
  if (!isRenameKind(kind)) throw new ApiError(400, `unknown kind: ${String(kind)}`);
  assertSafeIdSegment(oldId, "oldId");
  assertNewId(newId);
  if (oldId === newId) throw new ApiError(400, "newId equals oldId — nothing to rename");

  const db = await getDb();
  if (!exists(db, campaign, kind, oldId)) {
    throw new ApiError(404, `${kind} "${oldId}" not found`);
  }
  if (exists(db, campaign, kind, newId)) {
    throw new ApiError(409, "target already exists — not overwriting", {
      path: pathOf(db, campaign, kind, newId),
    });
  }

  const from = pathOf(db, campaign, kind, oldId);
  const changed = new Set(referenceSites(db, campaign, kind, oldId, newId));
  const to =
    kind === "chapter"
      ? chapterPath(newId)
      : kind === "scene"
        ? (() => {
            const row = db
              .select({ chapterId: scenes.chapterId, groupSlug: scenes.groupSlug })
              .from(scenes)
              .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, oldId)))
              .all()[0];
            return scenePath(row?.chapterId ?? "", row?.groupSlug ?? "", newId);
          })()
        : kind === "npc"
          ? npcPath(newId)
          : locationPath(newId);
  // The renamed entity's own document changes too — its id is part of the
  // cascade (the file version said the same).
  changed.add(to);

  if (dryRun) {
    return { renamed: { from, to }, changed: [...changed].sort(), dryRun: true };
  }

  db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const table =
      kind === "npc" ? npcs : kind === "location" ? locations : kind === "chapter" ? chapters : scenes;
    tx.update(table)
      .set({ id: newId })
      .where(and(eq(table.campaignId, campaign), eq(table.id, oldId)))
      .run();
    // A DISPLAY NAME that was only the id's fallback follows the id. Files
    // that carried no `name:`/`title:` were imported with "" and fall back
    // dynamically, so nothing to do for those — but a file that spelled the
    // fallback out (`name: jorna`) would keep pointing at a reference that
    // no longer exists, in the tree and in search alike.
    carryFallbackName(tx, campaign, kind, oldId, newId);
    updateSoftReferences(tx, campaign, kind, oldId, newId);
    // The index row is REPLACED, not patched: its `title` has to follow too
    // (see fts.ts). Dropping the old id first is what keeps the contract of
    // one row per (campaign, kind, entity_id).
    dropEntity(tx, campaign, kind, oldId);
    reindexEntity(tx, campaign, kind, newId);
    tx.update(campaigns)
      .set({ version: sql`${campaigns.version} + 1` })
      .where(eq(campaigns.id, campaign))
      .run();
  });

  return { renamed: { from, to }, changed: [...changed].sort() };
}
