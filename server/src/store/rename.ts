// POST /api/:campaign/rename as a database UPDATE.
//
// SCOPE NOTE: the rename rebuild came with the cutover rather than after it.
// It could not stay behind — the moment the read/write endpoints stop
// reading the markdown tree, the file-tree cascade of `campaign-rename.ts` is
// renaming files nobody reads any more. So the endpoint moves with the
// cutover, at exactly the size the cutover needs: the id update plus the
// reference cascade, with the response shape (`{ renamed, changed }`) and the
// error semantics (400 / 404 / 409) unchanged. What was left came on top:
// the reference COUNTS. They come from store/usage.ts, which is also what
// `GET /usage` answers with — so the plan's `changed` list, the dialog's
// German summary and the endpoint are one set of queries, and the preview
// cannot count something the cascade does not rewrite.
//
// What the migration bought here is visible in the code below: the id IS the
// primary key and every reference is a foreign key (schema.ts rules 3 and
// 5), so the whole reference cascade happens in the database. What still
// needs statements of its own is everything that is TEXT rather than a
// reference column: the `- HH:MM (id)` marker inside a log line, and
// `[[id]]` in prose.

import { and, eq, sql } from "drizzle-orm";
import { ApiError } from "../api-error";
import { logLineShortHash } from "../db/import-markdown";
import type { GrimoireDb } from "../db/client";
import {
  campaigns,
  chapters,
  locations,
  logEntries,
  npcs,
  sceneNpcs,
  scenes,
} from "../db/schema";
import { dropEntity } from "./fts";
import { refOwnerKind, rewriteBodyRefs } from "./refs";
import { getDb } from "./handle";
import { requireCampaign } from "./read";
import {
  entityExists,
  entityTable,
  isUsageKind,
  pathOf,
  usageReport,
  USAGE_KINDS,
  type UsageKind,
  type UsageReport,
} from "./usage";
import { isEmptyEntity, reindexEntity } from "./write";
import {
  chapterPath,
  locationPath,
  npcPath,
  RESERVED_SEGMENTS,
  sceneAddress,
  scenePath,
} from "./paths";

/**
 * The entity kinds that have a rename cascade (sessions have no id) — the
 * same set that can be counted, so the two features cannot drift (usage.ts).
 */
export const RENAME_KINDS = USAGE_KINDS;
export type RenameKind = UsageKind;

export function isRenameKind(value: unknown): value is RenameKind {
  return isUsageKind(value);
}

export interface RenameResult {
  renamed: { from: string; to: string };
  changed: string[];
  /**
   * The reference count behind `changed`, from the very same
   * queries `GET /usage` answers with — the dialog's German summary reads off
   * this, so the preview counts what the cascade rewrites.
   */
  usage: UsageReport;
  dryRun?: true;
}

const ID_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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
  if (RESERVED_SEGMENTS.has(newId)) {
    throw new ApiError(400, `newId is a reserved name: ${newId}`);
  }
}

/**
 * The reference sites of one rename, as the paths whose CONTENT changes —
 * derived from the USAGE report, so the preview's numbers and the cascade's
 * file list come from one set of queries.
 *
 * Two corrections on top of the raw sites:
 *
 *   * a chapter rename MOVES its scenes (the chapter id is part of a scene's
 *     path), so those sites are reported at their new address,
 *   * the entity's OWN entry is not a reference site — it is the thing
 *     being renamed, and the caller adds its new path.
 */
function referenceSites(usage: UsageReport, oldId: string, newId: string): string[] {
  const changed = new Set<string>();
  for (const group of usage.groups) {
    for (const site of group.sites) {
      if (site.path === usage.path) continue;
      changed.add(
        usage.kind === "chapter" && site.path.startsWith(`${oldId}/`)
          ? `${newId}/${site.path.slice(oldId.length + 1)}`
          : site.path,
      );
    }
  }
  return [...changed];
}

/**
 * A display name that was literally the OLD ID follows the id. `npcs/jorna`
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

/**
 * A scene that lists BOTH ids (`npcs: [jorna, jorna-alt]`) — the one case the
 * reference cascade cannot resolve on its own: moving the old row onto the
 * new id would collide with the row that is already there, on a primary key,
 * which no deferral covers. The old row goes and the existing one stays, so
 * the two lists are joined.
 *
 * It runs BEFORE the id update, because that is when the cascade fires.
 */
function dropDuplicateRefs(
  tx: GrimoireDb,
  campaign: string,
  kind: RenameKind,
  oldId: string,
  newId: string,
): void {
  if (kind !== "npc") return;
  for (const row of tx
    .select({ sceneId: sceneNpcs.sceneId })
    .from(sceneNpcs)
    .where(and(eq(sceneNpcs.campaignId, campaign), eq(sceneNpcs.npcId, newId)))
    .all()) {
    tx.delete(sceneNpcs)
      .where(
        and(
          eq(sceneNpcs.campaignId, campaign),
          eq(sceneNpcs.sceneId, row.sceneId),
          eq(sceneNpcs.npcId, oldId),
        ),
      )
      .run();
  }
}

/**
 * The TEXT a rename has to follow — everything that is not a reference
 * column and therefore does not cascade.
 *
 * `ownsRefSlug` is decided BEFORE the id update (the row that answers it is
 * gone afterwards): does `[[oldId]]` in prose actually mean THIS entity? See
 * store/refs.ts `refOwnerKind` — with a same-named npc around, a scene rename
 * must leave the prose alone.
 */
function updateTextReferences(
  tx: GrimoireDb,
  campaign: string,
  kind: RenameKind,
  oldId: string,
  newId: string,
  ownsRefSlug: boolean,
): void {
  if (kind === "scene") {
    // The `raw` line the review hashes carries the `(id)` marker as text. It
    // is rewritten so the rendered log keeps naming the scene the DM can
    // actually open; the hash follows, exactly as the file cascade re-hashed
    // the line. The rows are found by their reference column, which the
    // cascade has already moved.
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
  if (kind !== "chapter" && ownsRefSlug) {
    // `[[oldId]]` in prose has to follow the id — the renderer resolves the
    // CURRENT name from the slug, so a slug left behind goes silently back to
    // plain text. Every rewritten body is re-indexed (its indexed text
    // carries the referenced display name, store/refs.ts).
    for (const referrer of rewriteBodyRefs(tx, campaign, oldId, newId)) {
      reindexEntity(tx, campaign, referrer.kind, referrer.id);
    }
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
  if (!entityExists(db, campaign, kind, oldId)) {
    throw new ApiError(404, `${kind} "${oldId}" not found`);
  }
  // MERGE INTO AN EMPTY TARGET. An npc/location entry that holds nothing but
  // its id is one the DM created and did not fill in — and a scene may
  // already list both ids, which is what `dropDuplicateRefs` joins. Every
  // other path fills such an entry instead of colliding with it (the
  // generator's apply step, „NPC anlegen", `review/npc-stub`), so the rename
  // does too. A target with CONTENT is still a 409: a rename must never
  // overwrite what somebody wrote.
  const targetExists = entityExists(db, campaign, kind, newId);
  const mergeInto =
    targetExists &&
    (kind === "npc" || kind === "location") &&
    isEmptyEntity(db, campaign, kind, newId);
  if (targetExists && !mergeInto) {
    throw new ApiError(409, "target already exists — not overwriting", {
      path: pathOf(db, campaign, kind, newId),
    });
  }

  const from = pathOf(db, campaign, kind, oldId);
  // ONE reference pass for both answers: the counts the dialog shows and the
  // paths the cascade touches.
  const usage = usageReport(db, campaign, kind, oldId);
  const changed = new Set(referenceSites(usage, oldId, newId));
  const to =
    kind === "chapter"
      ? chapterPath(newId)
      : kind === "scene"
        ? (() => {
            const row = db
              .select({ chapterId: scenes.chapterId, location: scenes.location })
              .from(scenes)
              .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, oldId)))
              .all()[0];
            return sceneAddress({
              chapterId: row?.chapterId ?? null,
              location: row?.location ?? null,
              id: newId,
            });
          })()
        : kind === "npc"
          ? npcPath(newId)
          : locationPath(newId);
  // The renamed entity's own entry changes too — its id is part of the
  // cascade (the file version said the same).
  changed.add(to);

  if (dryRun) {
    return { renamed: { from, to }, changed: [...changed].sort(), usage, dryRun: true };
  }

  db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    // The reference checks move to the COMMIT of this transaction. Inside it
    // there is one unavoidable moment of inconsistency: merging into an empty
    // entry deletes the row a scene already references, and the renamed row
    // only takes its id one statement later. Deferring is what lets those two
    // statements be one change — and it weakens nothing, because a
    // transaction that leaves a reference unresolved cannot commit.
    tx.run(sql`pragma defer_foreign_keys = on`);
    const table = entityTable(kind);
    // Asked BEFORE the id moves: after the update the old slug has no row of
    // this kind any more, and the answer would flip to "nothing owns it".
    const ownsRefSlug = kind !== "chapter" && refOwnerKind(tx, campaign, oldId) === kind;
    // Before the id update, which is when the cascade fires.
    dropDuplicateRefs(tx, campaign, kind, oldId, newId);
    if (mergeInto) {
      // The empty target row makes way for the renamed one — otherwise the id
      // update below violates the primary key. It carries no content by
      // definition (`isEmptyEntity`), and its own index row goes with it.
      tx.delete(table)
        .where(and(eq(table.campaignId, campaign), eq(table.id, newId)))
        .run();
      dropEntity(tx, campaign, kind, newId);
    }
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
    updateTextReferences(tx, campaign, kind, oldId, newId, ownsRefSlug);
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

  return { renamed: { from, to }, changed: [...changed].sort(), usage };
}
