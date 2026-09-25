// Seeding a campaign from JSON fixtures.
//
// One object per fixture file, in the shape the API speaks. Every entity has
// a directory of its own, read with that entity's own schema: the campaign is
// `campaigns/<id>.json`, a chapter `chapters/<id>.json`, a scene
// `scenes/<id>.json`, an npc `npcs/<id>.json`, a location
// `locations/<id>.json`, a thread `threads/<id>.json`, an idea
// `ideas/<id>.json`, a glossary term `glossary-terms/<id>.json`, a knowledge
// item `knowledge-items/<id>.json` and a session `sessions/<id>.json` with
// its pauses, log entries and played scenes embedded — each exactly what its
// resource answers, without the guard (ADR #31). The seed is therefore not a
// second data format — it is the API's own shape written down, which is what
// makes it readable next to a response and reviewable in a diff.
//
// A campaign read from its directory is a `CampaignFixture`: one slot per
// entity, each typed with that entity's own type, so nothing downstream has
// to tell the entities apart again.
//
// THREE RULES hold this together:
//
//   1. THE STORE LAYER DOES THE WRITING: every entity goes through the seed
//      writer of its own domain module (`insertCampaignSeed`,
//      `insertChapterProposal`, …, `insertSessionSeed`), so references, tags,
//      handouts and the search index are maintained by the same code a
//      create endpoint runs.
//   2. A REFERENCE TO SOMETHING THAT DOES NOT EXIST IS AN ERROR. Every
//      reference is a foreign key (ADR #19) and nothing creates a row
//      because something mentioned it, so a seed that names a missing row
//      throws instead of degrading. That is the one place the format's
//      degrade rule does not apply: a fixture is loaded whole or not at all.
//   3. ONE TRANSACTION per campaign. Either the campaign is in the database
//      completely or nothing of it is.
//
// The load ORDER inside a campaign follows the foreign keys: campaign →
// chapters → threads → locations → npcs → scenes → sessions → ideas →
// glossary terms → knowledge items (`seedCampaign`). Body references
// (`[[id]]`) are expanded in the search index at the very end, because half
// the rows a body points at do not exist yet while loading.

import { eq, sql } from "drizzle-orm";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { GrimoireDb } from "./client";
import { campaigns } from "./schema";
import { isEntityId } from "@grimoire/shared";
import type { CampaignSeed } from "@grimoire/shared/campaign";
import type { ChapterProposal } from "@grimoire/shared/chapter";
import type { GlossaryTermSeed } from "@grimoire/shared/glossary-term";
import type { IdeaSeed } from "@grimoire/shared/idea";
import type { KnowledgeItemSeed } from "@grimoire/shared/knowledge-item";
import type { LocationProposal } from "@grimoire/shared/location";
import type { NpcProposal } from "@grimoire/shared/npc";
import type { SceneProposal } from "@grimoire/shared/scene";
import type { SessionSeed } from "@grimoire/shared/session";
import type { ThreadSeed } from "@grimoire/shared/thread";
import { insertCampaignSeed, readCampaignSeed } from "../store/campaigns";
import { insertChapterProposal, readChapterProposal } from "../store/chapters";
import { insertGlossaryTermSeed, readGlossaryTermSeed } from "../store/glossary-terms";
import { insertIdeaSeed, readIdeaSeed } from "../store/ideas";
import { insertKnowledgeItemSeed, readKnowledgeItemSeed } from "../store/knowledge-items";
import { insertThreadSeed, readThreadSeed } from "../store/threads";
import { insertLocationProposal, readLocationProposal } from "../store/locations";
import { insertNpcProposal, readNpcProposal } from "../store/npcs";
import { insertSceneProposal, readSceneProposal } from "../store/scenes";
import { insertSessionSeed, readSessionSeed } from "../store/sessions";
import { expandIndexedRefs } from "../store/refs";

/**
 * One campaign as its fixture directory holds it: every entity in a slot of
 * its own, typed with that entity's own type. Only the campaign is required
 * — it is the row everything else hangs off — so a caller that needs a bare
 * campaign names nothing but it.
 */
export interface CampaignFixture {
  campaign: CampaignSeed;
  chapters?: ChapterProposal[];
  scenes?: SceneProposal[];
  npcs?: NpcProposal[];
  locations?: LocationProposal[];
  threads?: ThreadSeed[];
  ideas?: IdeaSeed[];
  glossaryTerms?: GlossaryTermSeed[];
  knowledgeItems?: KnowledgeItemSeed[];
  sessions?: SessionSeed[];
}

class SeedError extends Error {}

function fail(where: string, what: string): never {
  throw new SeedError(`${where}: ${what}`);
}

/**
 * Every fixture in an entity's own directory, each read by that entity's own
 * reader (its zod schema, in the store of the entity) — or the seed error
 * that names the fixture and what is wrong with it. The id has to be a slug
 * like every id a create endpoint hands out.
 */
async function readEntityDirectory<T extends { id: string }>(
  dir: string,
  directory: string,
  read: (raw: unknown) => T,
): Promise<T[]> {
  const entityDir = path.join(dir, directory);
  const out: T[] = [];
  for (const name of await jsonFiles(entityDir)) {
    const where = `${directory}/${name}`;
    const raw = await readJson(entityDir, name);
    let entity: T;
    try {
      entity = read(raw);
    } catch (error) {
      fail(where, error instanceof Error ? error.message : String(error));
    }
    if (!isEntityId(entity.id)) fail(where, "`id` must be a kebab-case slug");
    out.push(entity);
  }
  return out;
}

/**
 * Read one campaign directory: each entity's own directory with that
 * entity's schema. Every
 * directory is read sorted BY NAME — the name carries no meaning, it only
 * makes the order deterministic and is what an error message names a fixture
 * by. Exactly one campaign is required: the campaign row is what every other
 * row hangs off, and a directory without it (or with two) does not describe
 * a campaign.
 */
export async function readFixtureCampaign(dir: string): Promise<CampaignFixture> {
  const found = await readEntityDirectory(dir, "campaigns", (raw) =>
    readCampaignSeed(raw, "campaign"),
  );
  if (found.length !== 1) {
    throw new SeedError(`a campaign needs exactly one campaign, found ${found.length}`);
  }
  const fixture: CampaignFixture = {
    campaign: found[0]!,
    chapters: await readEntityDirectory(dir, "chapters", (raw) =>
      readChapterProposal(raw, "chapter"),
    ),
    scenes: await readEntityDirectory(dir, "scenes", (raw) => readSceneProposal(raw, "scene")),
    npcs: await readEntityDirectory(dir, "npcs", (raw) => readNpcProposal(raw, "npc")),
    locations: await readEntityDirectory(dir, "locations", (raw) =>
      readLocationProposal(raw, "location"),
    ),
    threads: await readEntityDirectory(dir, "threads", (raw) => readThreadSeed(raw, "thread")),
    ideas: await readEntityDirectory(dir, "ideas", (raw) => readIdeaSeed(raw, "idea")),
    glossaryTerms: await readEntityDirectory(dir, "glossary-terms", (raw) =>
      readGlossaryTermSeed(raw, "glossary term"),
    ),
    knowledgeItems: await readEntityDirectory(dir, "knowledge-items", (raw) =>
      readKnowledgeItemSeed(raw, "knowledge item"),
    ),
    sessions: await readEntityDirectory(dir, "sessions", (raw) => readSessionSeed(raw, "session")),
  };
  return fixture;
}

/** The `.json` fixture file names of a directory, sorted; none when it does not exist. */
async function jsonFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b, "en"));
}

async function readJson(dir: string, name: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(dir, name), "utf8"));
  } catch (error) {
    fail(name, `not readable as JSON — ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Write one campaign into `db`, in ONE transaction, slot by slot in the order
 * the foreign keys dictate. Returns the campaign's id.
 */
export function seedCampaign(db: GrimoireDb, fixture: CampaignFixture): string {
  const campaignId = fixture.campaign.id;

  db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    insertCampaignSeed(tx, fixture.campaign);
    for (const chapter of fixture.chapters ?? []) insertChapterProposal(tx, campaignId, chapter);
    for (const thread of fixture.threads ?? []) insertThreadSeed(tx, campaignId, thread);
    for (const location of fixture.locations ?? []) {
      insertLocationProposal(tx, campaignId, location);
    }
    for (const npc of fixture.npcs ?? []) insertNpcProposal(tx, campaignId, npc);
    for (const scene of fixture.scenes ?? []) insertSceneProposal(tx, campaignId, scene);
    for (const session of fixture.sessions ?? []) insertSessionSeed(tx, campaignId, session);
    for (const idea of fixture.ideas ?? []) insertIdeaSeed(tx, campaignId, idea);
    for (const term of fixture.glossaryTerms ?? []) insertGlossaryTermSeed(tx, campaignId, term);
    for (const item of fixture.knowledgeItems ?? []) insertKnowledgeItemSeed(tx, campaignId, item);
    // The SECOND pass over the search index: bodies are indexed with their
    // `[[id]]` references replaced by the referenced display name
    // (store/refs.ts), and while loading, half the rows a body points at do
    // not exist yet.
    expandIndexedRefs(tx, campaignId);
    // One bump for the whole load, like any other write (store/campaigns.ts
    // `mutate`): a client polling `GET /version` sees the campaign appear once.
    tx.update(campaigns)
      .set({ version: sql`${campaigns.version} + 1` })
      .where(eq(campaigns.id, campaignId))
      .run();
  });

  return campaignId;
}

/** How many fixtures a campaign holds — one per object its directory carries. */
function fixtureCount(fixture: CampaignFixture): number {
  return (
    1 +
    (fixture.chapters?.length ?? 0) +
    (fixture.scenes?.length ?? 0) +
    (fixture.npcs?.length ?? 0) +
    (fixture.locations?.length ?? 0) +
    (fixture.threads?.length ?? 0) +
    (fixture.ideas?.length ?? 0) +
    (fixture.glossaryTerms?.length ?? 0) +
    (fixture.knowledgeItems?.length ?? 0) +
    (fixture.sessions?.length ?? 0)
  );
}

/**
 * Seed every SUBDIRECTORY of `root` as one campaign, in name order. That is
 * the whole layout: a directory is a campaign. Reports each campaign's id
 * and how many fixtures it held.
 */
export async function seedFixtures(
  db: GrimoireDb,
  root: string,
): Promise<Array<{ campaignId: string; fixtures: number }>> {
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "en"));
  const out: Array<{ campaignId: string; fixtures: number }> = [];
  for (const name of dirs) {
    const fixture = await readFixtureCampaign(path.join(root, name));
    out.push({ campaignId: seedCampaign(db, fixture), fixtures: fixtureCount(fixture) });
  }
  return out;
}
