// One entity row: how it is loaded, how a reference to it is checked, and how
// its search-index row is kept.
//
// The five entity kinds share this layer because their search rows do: the
// indexed text of an entry contains the DISPLAY NAME of everything it
// references, so a write of one kind makes the index rows of other kinds
// stale. Re-indexing those referrers therefore reaches every kind, and the
// per-kind index functions and the loaders it needs stay together.

import { and, asc, eq } from "drizzle-orm";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { chapters, locations, npcs, sceneNpcs, sceneTags, scenes } from "../db/schema";
import { campaignRow, indexCampaign } from "./campaigns";
import { indexEntity } from "./fts";
import type { Locator } from "./paths";
import { expandBodyRefs, referrersOf, type RefBodyKind } from "./refs";
import type { ChapterRow, LocationRow, NpcRow, SceneRow } from "./render";
import { unknownRef } from "./shared";

// --- row loaders by id --------------------------------------------------------
//
// Every one of them takes the handle it reads through, so the same call works
// on the database and inside a running transaction.

export function chapterRowOf(tx: GrimoireDb, campaign: string, id: string): ChapterRow | undefined {
  return tx
    .select()
    .from(chapters)
    .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, id)))
    .all()[0] as ChapterRow | undefined;
}

export function sceneRowOf(tx: GrimoireDb, campaign: string, id: string): SceneRow | undefined {
  return tx
    .select()
    .from(scenes)
    .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, id)))
    .all()[0] as SceneRow | undefined;
}

/**
 * The scene a `{ kind: "scene" }` locator addresses — by ID, which is the
 * key. The chapter and group segments are not matched against the row: the
 * group is `location`, and it MOVES when the DM corrects the location, so
 * every address handed out before that move is a stale address for a scene
 * that still exists. Resolving by id is what makes the correction
 * non-destructive — the response carries the current
 * address in `path`, and the app replaces the URL with it (ADR #17).
 *
 * The write is not unguarded by this: `rev` is the guard that a write which
 * has not seen the current entry is refused (ADR #4).
 */
export function sceneRowAt(
  tx: GrimoireDb,
  campaign: string,
  locator: Extract<Locator, { kind: "scene" }>,
): SceneRow {
  const row = sceneRowOf(tx, campaign, locator.id);
  if (row === undefined) throw new ApiError(404, "entry not found");
  return row;
}

export function npcRowOf(tx: GrimoireDb, campaign: string, id: string): NpcRow | undefined {
  return tx
    .select()
    .from(npcs)
    .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, id)))
    .all()[0] as NpcRow | undefined;
}

export function locationRowOf(tx: GrimoireDb, campaign: string, id: string): LocationRow | undefined {
  return tx
    .select()
    .from(locations)
    .where(and(eq(locations.campaignId, campaign), eq(locations.id, id)))
    .all()[0] as LocationRow | undefined;
}

export function chapterIdExists(tx: GrimoireDb, campaign: string, id: string): boolean {
  return chapterRowOf(tx, campaign, id) !== undefined;
}

// --- a scene's reference rows -------------------------------------------------

export function refNpcs(tx: GrimoireDb, campaign: string, sceneId: string): string[] {
  return tx
    .select({ npcId: sceneNpcs.npcId })
    .from(sceneNpcs)
    .where(and(eq(sceneNpcs.campaignId, campaign), eq(sceneNpcs.sceneId, sceneId)))
    .orderBy(asc(sceneNpcs.pos))
    .all()
    .map((r) => r.npcId);
}

export function refTags(tx: GrimoireDb, campaign: string, sceneId: string): string[] {
  return tx
    .select({ tag: sceneTags.tag })
    .from(sceneTags)
    .where(and(eq(sceneTags.campaignId, campaign), eq(sceneTags.sceneId, sceneId)))
    .orderBy(asc(sceneTags.pos))
    .all()
    .map((r) => r.tag);
}

// --- references, and what an entry is ---------------------------------------
//
// A reference names an entry that EXISTS — the database says so (schema.ts
// rule 3), and the assertions below are what turns a write that names
// something else into one readable sentence instead of a constraint error.
//
// Nothing here creates an entry as a side effect. The paths that DO create
// one are countable: the create endpoints of the domain modules — a `#npc`
// line the DM turns into an npc with a click goes through the npc's own
// (./npcs.ts `createNpc`) —, and accepting a generator proposal — including
// `ensureChapterRow` inside that accept (./chapters.ts), which writes the
// chapter the run itself decided on (ADR #18). Nowhere else.
//
// A `[[slug]]` in a body is not a reference in this sense. It is text, it
// stays text, and an unknown one renders as exactly what the DM typed.

/** A `chapter:` — of a scene, an npc or a location — has to name a chapter. */
export function assertChapterRef(tx: GrimoireDb, campaign: string, declared: string | null): void {
  if (declared === null) return;
  if (chapterIdExists(tx, campaign, declared)) return;
  throw unknownRef("chapter_unknown", "chapter", declared);
}

/** A scene's `location` has to name a location entry. */
export function assertLocationRef(tx: GrimoireDb, campaign: string, id: string | null): void {
  if (id === null) return;
  if (locationRowOf(tx, campaign, id) !== undefined) return;
  throw unknownRef("location_unknown", "location", id);
}

/**
 * Every entry of a scene's `npcs` has to name an npc entry.
 *
 * This is also what answers a NAME typed where an id belongs ("Alte
 * Fischerin"): no npc has that id, so the list names something that does not
 * exist — one rule, one sentence, instead of a second error about the shape
 * of the value.
 */
export function assertNpcRefs(tx: GrimoireDb, campaign: string, ids: readonly string[]): void {
  for (const id of ids) {
    if (id === "" || npcRowOf(tx, campaign, id) !== undefined) continue;
    throw unknownRef("npc_unknown", "npc", id);
  }
}

/**
 * The scene a quick note names. `code` is `log_scene_unknown`; the sibling
 * code `played_scene_unknown` has no caller, because the played list has no
 * write path of its own (see ./sessions.ts `patchSession`) — it is maintained
 * by the note that named the scene, and this check is what stands in front of
 * that.
 */
export function assertSceneRef(
  tx: GrimoireDb,
  campaign: string,
  id: string,
  code: "log_scene_unknown" | "played_scene_unknown",
): void {
  if (sceneRowOf(tx, campaign, id) !== undefined) return;
  throw unknownRef(code, "scene", id);
}

// --- the search index row per kind -------------------------------------------

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
 * transaction is strictly synchronous (see ./campaigns.ts `mutate`).
 */
let cascading = false;

export function reindexReferrers(tx: GrimoireDb, campaign: string, slug: string): void {
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

/**
 * The prose of an entry the index holds as its text: a prose PROPERTY — an
 * npc's `motivation`, a location's `atmosphere` — ahead of the body, as its
 * own paragraph. Both are text the DM reads on the card, so a search for a
 * word in them finds the entry; the same `[[slug]]` expansion runs over both.
 */
function indexedProse(property: string | null, body: string): string {
  const lead = property?.trim() ?? "";
  return lead === "" ? body : `${lead}\n\n${body}`;
}

export function indexScene(tx: GrimoireDb, campaign: string, row: SceneRow, tags: string[]): void {
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

export function indexNpc(tx: GrimoireDb, campaign: string, row: NpcRow): void {
  indexEntity(tx, campaign, {
    kind: "npc",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: row.role ?? "",
    body: expandBodyRefs(tx, campaign, indexedProse(row.motivation, row.body)),
  });
  reindexReferrers(tx, campaign, row.id);
}

export function indexLocation(tx: GrimoireDb, campaign: string, row: LocationRow): void {
  indexEntity(tx, campaign, {
    kind: "location",
    entityId: row.id,
    title: row.name === "" ? row.id : row.name,
    ref: row.id,
    tags: "",
    body: expandBodyRefs(tx, campaign, indexedProse(row.atmosphere, row.body)),
  });
  reindexReferrers(tx, campaign, row.id);
}

// A chapter is NOT referenceable (@grimoire/shared/refs), so nothing has to be
// re-indexed for it — but its body may CONTAIN references like any other.
export function indexChapter(tx: GrimoireDb, campaign: string, row: ChapterRow): void {
  indexEntity(tx, campaign, {
    kind: "chapter",
    entityId: row.id,
    title: row.title === "" ? row.id : row.title,
    ref: row.id,
    tags: "",
    body: expandBodyRefs(tx, campaign, row.body),
  });
}

/**
 * Re-read the row of one entry and rebuild its search-index row from it,
 * title included.
 *
 * Called after a write that changed a name other bodies refer to: their
 * indexed text spells that name out, so it is stale until they are rebuilt.
 *
 * `campaign` is one of the kinds because the campaign entry's body holds
 * `[[references]]` like any other body (store/refs.ts `REF_BODY_KINDS`), and
 * its index row spells their names out too.
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
