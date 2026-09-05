// GET /api/:campaign/usage — where an entity is REFERENCED (issue #60).
//
// This is the counting half of the rename: before the DM changes an id, the
// dialog says what hangs off it ("3 Szenen, 2 Beziehungen, 4 Log-Zeilen"),
// and the rename's `dryRun` answers with the very same numbers. That is the
// point of this module being the ONE place the reference queries live —
// store/rename.ts derives its `changed` list from these sites, so a preview
// and the cascade can never drift apart.
//
// What counts as a reference here is exactly what the rename rewrites (see
// the group table below); a soft reference (schema.ts rule 3) counts even
// when the counterpart has no row, because the id in it is the thing that
// would go stale.
//
// Two levels, deliberately:
//
//   * a GROUP counts ROWS — 4 log lines are 4 usages, even in one session,
//   * its SITES are the DOCUMENTS those rows belong to, each with its own
//     count — that is the "Referenzort" the DM can actually open.

import { and, eq } from "drizzle-orm";
import { ApiError } from "../campaign-fs";
import type { GrimoireDb } from "../db/client";
import {
  chapters,
  locations,
  logEntries,
  npcRelations,
  npcs,
  sceneNpcs,
  scenes,
  sessionScenesPlayed,
} from "../db/schema";
import { getDb } from "./handle";
import { requireCampaign } from "./read";
import { chapterPath, locationPath, npcPath, scenePath, sessionPath } from "./paths";

/** The entity kinds that have an id others can reference. */
export const USAGE_KINDS = ["npc", "location", "scene", "chapter"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export function isUsageKind(value: unknown): value is UsageKind {
  return typeof value === "string" && (USAGE_KINDS as readonly string[]).includes(value);
}

/**
 * The kinds of reference, one per query below. The app maps these to German
 * labels (app/src/lib/rename.ts) — the wire keeps stable English keys.
 *
 *   sceneNpcs         scene frontmatter `npcs:` names the npc
 *   npcRelations      another npc's `## Beziehungen` line names the npc
 *   sceneLocation     scene frontmatter `location:` names the location
 *   scenesPlayed      a session's `scenes_played:` names the scene
 *   logEntries        a log line's `(scene-id)` marker names the scene
 *   chapterScenes     a scene belongs to the chapter
 *   chapterNpcs       an npc is introduced in the chapter
 *   chapterLocations  a location belongs to the chapter
 */
export const USAGE_REFS = [
  "sceneNpcs",
  "npcRelations",
  "sceneLocation",
  "scenesPlayed",
  "logEntries",
  "chapterScenes",
  "chapterNpcs",
  "chapterLocations",
] as const;
export type UsageRef = (typeof USAGE_REFS)[number];

/** One referencing DOCUMENT, with how many of its rows point at the entity. */
export interface UsageSite {
  /** What the referencing document is. */
  kind: "scene" | "npc" | "location" | "session" | "chapter";
  id: string;
  /** Display title (falls back to the id, as everywhere else). */
  title: string;
  /** Campaign-relative path — the address the app can open. */
  path: string;
  count: number;
}

export interface UsageGroup {
  ref: UsageRef;
  /** Referencing ROWS, not documents. */
  count: number;
  sites: UsageSite[];
}

export interface UsageReport {
  kind: UsageKind;
  id: string;
  /** The entity's own document. */
  path: string;
  /** Sum of all group counts. */
  total: number;
  /** Only non-empty groups, in USAGE_REFS order. */
  groups: UsageGroup[];
}

/** The document path of one entity. */
export function pathOf(db: GrimoireDb, campaign: string, kind: UsageKind, id: string): string {
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

const TABLE_OF = { npc: npcs, location: locations, chapter: chapters, scene: scenes } as const;

export function entityTable(kind: UsageKind) {
  return TABLE_OF[kind];
}

export function entityExists(
  db: GrimoireDb,
  campaign: string,
  kind: UsageKind,
  id: string,
): boolean {
  const table = entityTable(kind);
  return (
    db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.campaignId, campaign), eq(table.id, id)))
      .all().length > 0
  );
}

/** Collect rows into sites, keeping the first-seen order and counting rows. */
function collect(rows: UsageSite[]): { count: number; sites: UsageSite[] } {
  const byPath = new Map<string, UsageSite>();
  for (const row of rows) {
    const seen = byPath.get(row.path);
    if (seen === undefined) byPath.set(row.path, { ...row, count: 1 });
    else seen.count += 1;
  }
  return { count: rows.length, sites: [...byPath.values()] };
}

function sceneSite(row: {
  id: string;
  title: string;
  chapterId: string | null;
  groupSlug: string;
}): UsageSite {
  return {
    kind: "scene",
    id: row.id,
    title: row.title === "" ? row.id : row.title,
    path: scenePath(row.chapterId ?? "", row.groupSlug, row.id),
    count: 1,
  };
}

const SCENE_SITE_COLS = {
  id: scenes.id,
  title: scenes.title,
  chapterId: scenes.chapterId,
  groupSlug: scenes.groupSlug,
};

/** Scenes whose `npcs:` list names the npc, in scene order. */
function scenesWithNpc(db: GrimoireDb, campaign: string, npcId: string): UsageSite[] {
  return db
    .select(SCENE_SITE_COLS)
    .from(sceneNpcs)
    .innerJoin(
      scenes,
      and(eq(scenes.campaignId, sceneNpcs.campaignId), eq(scenes.id, sceneNpcs.sceneId)),
    )
    .where(and(eq(sceneNpcs.campaignId, campaign), eq(sceneNpcs.npcId, npcId)))
    .orderBy(scenes.pos, scenes.id)
    .all()
    .map(sceneSite);
}

/**
 * `## Beziehungen` lines that REFERENCE the npc — lines in someone else's
 * list naming this npc (`otherNpcId`), which are exactly the rows the rename
 * rewrites (rename.ts). The npc's OWN outgoing lines are deliberately not
 * counted: they carry other ids, and its own document only moves. Counting
 * them would make the preview promise more rewritten sites than there are.
 */
function relationsPointingAtNpc(db: GrimoireDb, campaign: string, npcId: string): UsageSite[] {
  return db
    .select({ ownerId: npcRelations.npcId, name: npcs.name })
    .from(npcRelations)
    .innerJoin(
      npcs,
      and(eq(npcs.campaignId, npcRelations.campaignId), eq(npcs.id, npcRelations.npcId)),
    )
    .where(and(eq(npcRelations.campaignId, campaign), eq(npcRelations.otherNpcId, npcId)))
    .orderBy(npcRelations.npcId, npcRelations.pos)
    .all()
    .map((row) => ({
      kind: "npc" as const,
      id: row.ownerId,
      title: row.name === "" ? row.ownerId : row.name,
      path: npcPath(row.ownerId),
      count: 1,
    }));
}

function sessionSites(rows: { sessionId: string }[]): UsageSite[] {
  return rows.map((row) => ({
    kind: "session" as const,
    id: row.sessionId,
    title: row.sessionId,
    path: sessionPath(row.sessionId),
    count: 1,
  }));
}

/** The reference groups of one entity — the single source of both features. */
function groupsFor(db: GrimoireDb, campaign: string, kind: UsageKind, id: string): UsageGroup[] {
  const groups: UsageGroup[] = [];
  const add = (ref: UsageRef, rows: UsageSite[]): void => {
    const { count, sites } = collect(rows);
    if (count > 0) groups.push({ ref, count, sites });
  };

  if (kind === "npc") {
    add("sceneNpcs", scenesWithNpc(db, campaign, id));
    add("npcRelations", relationsPointingAtNpc(db, campaign, id));
  }

  if (kind === "location") {
    add(
      "sceneLocation",
      db
        .select(SCENE_SITE_COLS)
        .from(scenes)
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.location, id)))
        .orderBy(scenes.pos, scenes.id)
        .all()
        .map(sceneSite),
    );
  }

  if (kind === "scene") {
    add(
      "scenesPlayed",
      sessionSites(
        db
          .select({ sessionId: sessionScenesPlayed.sessionId })
          .from(sessionScenesPlayed)
          .where(
            and(eq(sessionScenesPlayed.campaignId, campaign), eq(sessionScenesPlayed.sceneId, id)),
          )
          .orderBy(sessionScenesPlayed.sessionId, sessionScenesPlayed.pos)
          .all(),
      ),
    );
    add(
      "logEntries",
      sessionSites(
        db
          .select({ sessionId: logEntries.sessionId })
          .from(logEntries)
          .where(and(eq(logEntries.campaignId, campaign), eq(logEntries.sceneId, id)))
          .orderBy(logEntries.sessionId, logEntries.pos)
          .all(),
      ),
    );
  }

  if (kind === "chapter") {
    add(
      "chapterScenes",
      db
        .select(SCENE_SITE_COLS)
        .from(scenes)
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.chapterId, id)))
        .orderBy(scenes.pos, scenes.id)
        .all()
        .map(sceneSite),
    );
    add(
      "chapterNpcs",
      db
        .select({ id: npcs.id, name: npcs.name })
        .from(npcs)
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.chapterId, id)))
        .orderBy(npcs.id)
        .all()
        .map((row) => ({
          kind: "npc" as const,
          id: row.id,
          title: row.name === "" ? row.id : row.name,
          path: npcPath(row.id),
          count: 1,
        })),
    );
    add(
      "chapterLocations",
      db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(and(eq(locations.campaignId, campaign), eq(locations.chapterId, id)))
        .orderBy(locations.id)
        .all()
        .map((row) => ({
          kind: "location" as const,
          id: row.id,
          title: row.name === "" ? row.id : row.name,
          path: locationPath(row.id),
          count: 1,
        })),
    );
  }

  return groups;
}

/** The usage report of one entity, computed on an open database handle. */
export function usageReport(
  db: GrimoireDb,
  campaign: string,
  kind: UsageKind,
  id: string,
): UsageReport {
  const groups = groupsFor(db, campaign, kind, id);
  return {
    kind,
    id,
    path: pathOf(db, campaign, kind, id),
    total: groups.reduce((sum, group) => sum + group.count, 0),
    groups,
  };
}

/**
 * GET /api/:campaign/usage?kind=…&id=… — 404 for an entity that does not
 * exist (the same answer `GET /file` gives for its path).
 */
export async function readUsage(
  campaign: string,
  kind: UsageKind,
  id: string,
): Promise<UsageReport> {
  await requireCampaign(campaign);
  if (!isUsageKind(kind)) throw new ApiError(400, `unknown kind: ${String(kind)}`);
  if (id === "") throw new ApiError(400, "id must not be empty");
  const db = await getDb();
  if (!entityExists(db, campaign, kind, id)) throw new ApiError(404, `${kind} "${id}" not found`);
  return usageReport(db, campaign, kind, id);
}
