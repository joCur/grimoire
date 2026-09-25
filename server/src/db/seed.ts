// Seeding a campaign from JSON fixtures.
//
// One object per fixture file, in the shape the API speaks. An entity with
// its own resource (ADR #31) has a directory of its own, and each fixture in
// it is exactly what the resource answers, without the guard: the campaign is
// `campaigns/<id>.json`, a chapter `chapters/<id>.json`, a scene
// `scenes/<id>.json`, an npc `npcs/<id>.json`, a location
// `locations/<id>.json`, each its fields side by side, `body` among them. The
// lists and the sessions sit in the campaign directory as `{ kind, … }` with
// their rows. The seed is therefore not a second data format — it is the API's own shape
// written down, which is what makes it readable next to a response and
// reviewable in a diff.
//
// THREE RULES hold this together:
//
//   1. THE STORE LAYER DOES THE WRITING wherever it has a path for it: the
//      campaign goes through `insertCampaignSeed` (store/campaigns.ts), a
//      chapter through `insertChapterProposal` (store/chapters.ts), a scene
//      through `insertSceneProposal` (store/scenes.ts), an npc through
//      `insertNpcProposal` (store/npcs.ts), a location through
//      `insertLocationProposal` (store/locations.ts) and a chapter's open
//      threads through `insertThreadRows` (store/threads.ts), so references,
//      tags, handouts and the search index are maintained by the same code a
//      create endpoint runs. What has no endpoint because it is historic data
//      — sessions with their pauses and log lines, the inbox list, the
//      glossary — is written as rows here and indexed the way the store
//      indexes it.
//   2. A REFERENCE TO SOMETHING THAT DOES NOT EXIST IS AN ERROR. Every
//      reference is a foreign key (ADR #19) and nothing creates a row
//      because something mentioned it, so a seed that names a missing row
//      throws instead of degrading. That is the one place the format's
//      degrade rule does not apply: a fixture is loaded whole or not at all.
//   3. ONE TRANSACTION per campaign. Either the campaign is in the database
//      completely or nothing of it is.
//
// The load ORDER inside a campaign follows the foreign keys: campaign →
// chapters → threads → locations → npcs → scenes → sessions → inbox →
// glossary. Body references (`[[id]]`) are expanded in the search index at
// the very end, because half the rows a body points at do not exist yet
// while loading.

import { eq, sql } from "drizzle-orm";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { GrimoireDb } from "./client";
import {
  campaigns,
  glossary,
  inboxEntries,
  logEntries,
  sessionPauses,
  sessionScenesPlayed,
  sessions,
} from "./schema";
import {
  isEntityId,
  type CampaignSeed,
  type ChapterProposal,
  type LocationProposal,
  type NpcProposal,
  type SceneProposal,
} from "@grimoire/shared";
import { insertCampaignSeed, readCampaignSeed } from "../store/campaigns";
import { insertChapterProposal, readChapterProposal } from "../store/chapters";
import { indexGlossaryTerm } from "../store/glossary";
import { insertThreadRows } from "../store/threads";
import { insertLocationProposal, readLocationProposal } from "../store/locations";
import { insertNpcProposal, readNpcProposal } from "../store/npcs";
import { insertSceneProposal, readSceneProposal } from "../store/scenes";
import { logLineId } from "../store/body-parse";
import { expandIndexedRefs } from "../store/refs";

/** A session's fields as its fixture carries them. */
type SessionFields = Record<string, unknown>;

/**
 * The fields a session fixture may carry — there is nothing beside them, so
 * a fixture naming another is refused. `reviewed` is not among them, because
 * the review flag sits on the log row it belongs to.
 */
const SESSION_FIELDS: readonly string[] = ["id", "started", "ended", "scenes_played", "pauses"];

/**
 * One session log row: the columns it holds. `sceneId` is a REFERENCE (rule 2
 * above) — a seeded note that names a scene the campaign does not have is an
 * error, not a note with its scene quietly dropped.
 */
export interface SeedLogLine {
  /** `HH:mm` local, the time the note was taken. */
  at?: string;
  sceneId?: string;
  text: string;
  reviewed?: boolean;
}

/** One idea in the inbox: its text and whether it is ticked off. */
export interface SeedInboxEntry {
  text: string;
  done?: boolean;
}

/**
 * One open thread: the chapter it belongs to, its text and whether it is
 * ticked off — the row `GET …/chapters/:chapter/threads` answers, with its
 * chapter and without the id the store hands out.
 */
export interface SeedThread {
  chapter: string;
  text: string;
  done?: boolean;
}

/** One glossary row. */
export interface SeedGlossaryEntry {
  term: string;
  explanation: string;
}

/**
 * One seeded object. `kind` is what decides the shape — the discriminator a
 * list fixture of the campaign directory carries, and for an entity with its
 * own resource the directory it was read from (that fixture file carries no
 * kind: it is the entity as its resource answers it, without the guard).
 */
export type SeedEntry =
  | { kind: "campaign"; campaign: CampaignSeed }
  | { kind: "chapter"; chapter: ChapterProposal }
  | { kind: "threads"; entries: SeedThread[] }
  | { kind: "scene"; scene: SceneProposal }
  | { kind: "npc"; npc: NpcProposal }
  | { kind: "location"; location: LocationProposal }
  | { kind: "session"; properties: SessionFields; body?: string; log?: SeedLogLine[] }
  | { kind: "inbox"; entries: SeedInboxEntry[] }
  | { kind: "glossary"; intro?: string; entries: SeedGlossaryEntry[] };

/**
 * The order the kinds are written in — the foreign keys decide it, so this is
 * the one place it is written down.
 */
const LOAD_ORDER: SeedEntry["kind"][] = [
  "campaign",
  "chapter",
  "threads",
  "location",
  "npc",
  "scene",
  "session",
  "inbox",
  "glossary",
];

/** The stem a seeded entry came from — named in every error this module throws. */
export interface SeedSource {
  /** The fixture file name without its `.json` extension, e.g. `session-2026-01-15`. */
  stem: string;
  entry: SeedEntry;
}

class SeedError extends Error {}

function fail(where: string, what: string): never {
  throw new SeedError(`${where}: ${what}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(where: string, what: string, value: unknown): string {
  if (typeof value !== "string" || value === "") fail(where, `${what} must be a non-empty string`);
  return value;
}

/**
 * Validate one parsed list fixture of the campaign directory into a
 * `SeedEntry`. Deliberately strict — the seed is the contract of the whole
 * test suite, and a silently ignored key there would hide a real mismatch
 * with the API shape.
 */
export function asSeedEntry(where: string, value: unknown): SeedEntry {
  if (!isRecord(value)) fail(where, "not a JSON object");
  const kind = value.kind;
  if (typeof kind !== "string") fail(where, "no `kind`");
  if (kind === "inbox") {
    const entries = value.entries;
    if (!Array.isArray(entries)) fail(where, "`entries` must be a list");
    return { kind, entries: entries.map((e, i) => asInboxEntry(`${where} entry ${i}`, e)) };
  }
  if (kind === "threads") {
    // The open threads are a LIST beside their chapters (ADR #26), so they
    // travel as rows naming their chapter — never as a checklist in a text.
    const entries = value.entries;
    if (!Array.isArray(entries)) fail(where, "`entries` must be a list");
    return { kind, entries: entries.map((e, i) => asThread(`${where} entry ${i}`, e)) };
  }
  if (kind === "glossary") {
    const entries = value.entries;
    if (!Array.isArray(entries)) fail(where, "`entries` must be a list");
    const intro = value.intro;
    if (intro !== undefined && typeof intro !== "string") fail(where, "`intro` must be a string");
    return {
      kind,
      ...(intro === undefined ? {} : { intro }),
      entries: entries.map((e, i) => {
        const at = `${where} entry ${i}`;
        if (!isRecord(e)) fail(at, "not a JSON object");
        return {
          term: requireString(at, "`term`", e.term),
          explanation: typeof e.explanation === "string" ? e.explanation : "",
        };
      }),
    };
  }
  if (kind !== "session") fail(where, `unknown kind "${kind}"`);
  const properties = value.properties;
  if (!isRecord(properties)) fail(where, "`properties` must be a JSON object");
  requireString(where, "`properties.id`", properties.id);
  const body = value.body;
  if (body !== undefined && typeof body !== "string") fail(where, "`body` must be a string");
  for (const key of Object.keys(properties)) {
    if (!SESSION_FIELDS.includes(key)) fail(where, `unknown field "${key}" — no such field`);
  }
  const log = value.log;
  if (log !== undefined && !Array.isArray(log)) fail(where, "`log` must be a list");
  return {
    kind,
    properties,
    body: typeof body === "string" ? body : "",
    log: (log ?? []).map((l, i) => {
      const at = `${where} log ${i}`;
      if (!isRecord(l)) fail(at, "not a JSON object");
      return {
        ...(l.at === undefined ? {} : { at: requireString(at, "`at`", l.at) }),
        ...(l.sceneId === undefined ? {} : { sceneId: requireString(at, "`sceneId`", l.sceneId) }),
        text: requireString(at, "`text`", l.text),
        ...(l.reviewed === true ? { reviewed: true } : {}),
      };
    }),
  };
}

/**
 * The fixture of one entity with its own resource: the entity as its resource
 * answers it, without the guard, read by that entity's own reader — or the
 * seed error that names what is wrong. The id has to be a slug like every id
 * a create endpoint hands out.
 */
function asSeedEntity<T extends { id: string }>(
  where: string,
  value: unknown,
  read: (raw: unknown) => T,
): T {
  let entity: T;
  try {
    entity = read(value);
  } catch (error) {
    fail(where, error instanceof Error ? error.message : String(error));
  }
  if (!isEntityId(entity.id)) fail(where, "`id` must be a kebab-case slug");
  return entity;
}

/** The campaign fixture. */
export function asSeedCampaign(where: string, value: unknown): SeedEntry {
  const campaign = asSeedEntity(where, value, (raw) => readCampaignSeed(raw, "campaign"));
  return { kind: "campaign", campaign };
}

/** One chapter fixture. */
export function asSeedChapter(where: string, value: unknown): SeedEntry {
  const chapter = asSeedEntity(where, value, (raw) => readChapterProposal(raw, "chapter"));
  return { kind: "chapter", chapter };
}

/** One scene fixture. */
export function asSeedScene(where: string, value: unknown): SeedEntry {
  const scene = asSeedEntity(where, value, (raw) => readSceneProposal(raw, "scene"));
  return { kind: "scene", scene };
}

/** One npc fixture. */
export function asSeedNpc(where: string, value: unknown): SeedEntry {
  const npc = asSeedEntity(where, value, (raw) => readNpcProposal(raw, "npc"));
  return { kind: "npc", npc };
}

/** One location fixture. */
export function asSeedLocation(where: string, value: unknown): SeedEntry {
  const location = asSeedEntity(where, value, (raw) => readLocationProposal(raw, "location"));
  return { kind: "location", location };
}

function asThread(where: string, value: unknown): SeedThread {
  if (!isRecord(value)) fail(where, "not a JSON object");
  const chapter = requireString(where, "`chapter`", value.chapter);
  const text = requireString(where, "`text`", value.text);
  return { chapter, text, ...(value.done === true ? { done: true } : {}) };
}

function asInboxEntry(where: string, value: unknown): SeedInboxEntry {
  if (!isRecord(value)) fail(where, "not a JSON object");
  const text = requireString(where, "`text`", value.text);
  return { text, ...(value.done === true ? { done: true } : {}) };
}

/**
 * The directory of each entity with its own resource, and the reader of its
 * fixture files.
 */
const ENTITY_DIRECTORIES: ReadonlyArray<
  readonly [string, (where: string, value: unknown) => SeedEntry]
> = [
  ["campaigns", asSeedCampaign],
  ["chapters", asSeedChapter],
  ["scenes", asSeedScene],
  ["npcs", asSeedNpc],
  ["locations", asSeedLocation],
];

/**
 * Read one campaign directory: every fixture file in it, sorted BY NAME.
 * The name itself carries no meaning — it is only what makes the order
 * deterministic and what an error message and `seedStore({ without })` name
 * an entry by.
 */
export async function readFixtureCampaign(dir: string): Promise<SeedEntry[]> {
  return (await readFixtureSources(dir)).map((source) => source.entry);
}

/**
 * `readFixtureCampaign`, with the fixture file stem each entry came from. The
 * stem of a fixture file in an entity's own directory carries the directory
 * (`chapters/01-salzhafen`, `scenes/smuggler-captured`, `npcs/fenn`, …).
 */
export async function readFixtureSources(dir: string): Promise<SeedSource[]> {
  const sources: SeedSource[] = [];
  for (const name of await jsonFiles(dir)) {
    const stem = name.slice(0, -".json".length);
    sources.push({ stem, entry: asSeedEntry(name, await readJson(dir, name)) });
  }
  for (const [directory, read] of ENTITY_DIRECTORIES) {
    const entityDir = path.join(dir, directory);
    for (const name of await jsonFiles(entityDir)) {
      const stem = `${directory}/${name.slice(0, -".json".length)}`;
      sources.push({ stem, entry: read(`${stem}.json`, await readJson(entityDir, name)) });
    }
  }
  return sources;
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

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function asOptString(value: unknown): string | null {
  const s = asString(value, " ");
  return s === " " ? null : s;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => v !== null && v !== undefined).map((v) => String(v));
}

/**
 * Write one campaign's entries into `db`, in ONE transaction. Exactly one
 * campaign is required: the campaign row is what every other row hangs off,
 * and a seed without it (or with two) does not describe a campaign.
 */
export function seedCampaign(
  db: GrimoireDb,
  entries: SeedEntry[],
): { campaignId: string; entries: number } {
  const campaignEntries = entries.filter((e) => e.kind === "campaign");
  if (campaignEntries.length !== 1) {
    throw new SeedError(`a campaign needs exactly one campaign, found ${campaignEntries.length}`);
  }
  const campaignId = campaignEntries[0]!.campaign.id;
  const byKind = (kind: SeedEntry["kind"]): SeedEntry[] => entries.filter((e) => e.kind === kind);

  db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    for (const kind of LOAD_ORDER) {
      for (const entry of byKind(kind)) writeEntry(tx, campaignId, entry);
    }
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

  return { campaignId, entries: entries.length };
}

function writeEntry(tx: GrimoireDb, campaignId: string, entry: SeedEntry): void {
  switch (entry.kind) {
    case "campaign":
      return insertCampaignSeed(tx, entry.campaign);
    case "chapter":
      return insertChapterProposal(tx, campaignId, entry.chapter);
    case "threads":
      return writeThreadRows(tx, campaignId, entry.entries);
    case "location":
      return insertLocationProposal(tx, campaignId, entry.location);
    case "npc":
      return insertNpcProposal(tx, campaignId, entry.npc);
    case "scene":
      return insertSceneProposal(tx, campaignId, entry.scene);
    case "session":
      return writeSessionRows(tx, campaignId, entry);
    case "inbox":
      return writeInboxRows(tx, campaignId, entry.entries);
    case "glossary":
      return writeGlossaryRows(tx, campaignId, entry);
  }
}

/**
 * The open threads, chapter by chapter in the order the fixture names them —
 * each chapter's rows keep the fixture's order within it.
 */
function writeThreadRows(tx: GrimoireDb, campaignId: string, entries: SeedThread[]): void {
  const byChapter = new Map<string, SeedThread[]>();
  for (const entry of entries) {
    byChapter.set(entry.chapter, [...(byChapter.get(entry.chapter) ?? []), entry]);
  }
  for (const [chapter, rows] of byChapter) insertThreadRows(tx, campaignId, chapter, rows);
}

/**
 * A session and everything that hangs off it: its pauses, its log rows and its
 * played scenes. A session has no create endpoint for HISTORIC data — the live
 * cycle writes one row at a time — so the rows are written here.
 *
 * Nothing about a session is indexed for search: its content is the log, and
 * the log is read in the session view and the review, never looked up by name.
 */
function writeSessionRows(
  tx: GrimoireDb,
  campaignId: string,
  entry: SeedEntry & { kind: "session" },
): void {
  const id = asString(entry.properties.id);
  tx.insert(sessions)
    .values({
      campaignId,
      id,
      started: asOptString(entry.properties.started),
      ended: asOptString(entry.properties.ended),
      body: entry.body ?? "",
    })
    .run();

  const pauses = Array.isArray(entry.properties.pauses) ? entry.properties.pauses : [];
  pauses.forEach((pause, pos) => {
    if (!isRecord(pause)) fail(`session ${id}`, `pause ${pos} is not a JSON object`);
    tx.insert(sessionPauses)
      .values({
        campaignId,
        sessionId: id,
        pos,
        fromTs: requireString(`session ${id} pause ${pos}`, "`from`", pause.from),
        toTs: asOptString(pause.to),
      })
      .run();
  });

  (entry.log ?? []).forEach((line, pos) => {
    const at = line.at ?? null;
    const sceneId = line.sceneId ?? null;
    tx.insert(logEntries)
      .values({
        campaignId,
        sessionId: id,
        pos,
        at,
        sceneId,
        text: line.text,
        hash: logLineId(at, sceneId, line.text),
        reviewed: line.reviewed === true ? 1 : 0,
      })
      .run();
  });

  // `scenes_played` is an ORDERED list, and a scene the party returned to
  // appears in it twice: `pos` is part of the key, so a repetition is a
  // second row and the sequence is what the review reads back.
  asStringList(entry.properties.scenes_played).forEach((sceneId, pos) => {
    tx.insert(sessionScenesPlayed).values({ campaignId, sessionId: id, sceneId, pos }).run();
  });
}

/**
 * The inbox list — one row per idea, exactly what `POST /inbox` writes. No
 * heading rows: the inbox is a table and has no skeleton (ADR #26).
 */
function writeInboxRows(tx: GrimoireDb, campaignId: string, entries: SeedInboxEntry[]): void {
  entries.forEach((entry, pos) => {
    tx.insert(inboxEntries)
      .values({ campaignId, pos, text: entry.text, done: entry.done === true ? 1 : 0 })
      .run();
  });
}

/**
 * The glossary rows plus `campaigns.glossary_intro` — the prose above the
 * first term, which belongs to no term and would be lost on every save if it
 * had no place of its own.
 */
function writeGlossaryRows(
  tx: GrimoireDb,
  campaignId: string,
  entry: SeedEntry & { kind: "glossary" },
): void {
  entry.entries.forEach((row, pos) => {
    tx.insert(glossary)
      .values({ campaignId, term: row.term, explanation: row.explanation, pos })
      .run();
    indexGlossaryTerm(tx, campaignId, row.term, row.explanation);
  });
  if (entry.intro !== undefined && entry.intro !== "") {
    tx.update(campaigns)
      .set({ glossaryIntro: entry.intro })
      .where(eq(campaigns.id, campaignId))
      .run();
  }
}

/**
 * Seed every SUBDIRECTORY of `root` as one campaign, in name order. That is
 * the whole layout: a directory is a campaign, the fixture files in it are its
 * entries.
 */
export async function seedFixtures(
  db: GrimoireDb,
  root: string,
): Promise<Array<{ campaignId: string; entries: number }>> {
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "en"));
  const out: Array<{ campaignId: string; entries: number }> = [];
  for (const name of dirs) {
    out.push(seedCampaign(db, await readFixtureCampaign(path.join(root, name))));
  }
  return out;
}
