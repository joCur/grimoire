// Seeding a campaign from JSON entries.
//
// One entry per fixture file, in the shape the API speaks: `properties` and `body`,
// exactly as `GET /entry` returns them. The seed is therefore not a second
// data format — it is the API's own shape written down, which is what makes
// it readable next to a response and reviewable in a diff.
//
// THREE RULES hold this together:
//
//   1. THE STORE LAYER DOES THE WRITING wherever it has a path for it:
//      chapter, scene, npc and location go through `insertDraft`
//      (store/drafts.ts), so references, tags, handouts and the search index
//      are maintained by the same code a create endpoint runs. What has no
//      endpoint because it is historic data — the campaign row, sessions with
//      their pauses and log lines, the inbox list, the glossary — is written
//      as rows here and indexed the way the store indexes it.
//   2. A REFERENCE TO SOMETHING THAT DOES NOT EXIST IS AN ERROR. Every
//      reference is a foreign key (ADR #19) and nothing creates an entry
//      because something mentioned it, so a seed that names a missing entry
//      throws instead of degrading. That is the one place the format's
//      degrade rule does not apply: an entry is loaded whole or not at all.
//   3. ONE TRANSACTION per campaign. Either the campaign is in the database
//      completely or nothing of it is.
//
// The load ORDER inside a campaign follows the foreign keys: campaign →
// chapters → locations → npcs → scenes → sessions → inbox → glossary. Body
// references (`[[id]]`) are expanded in the search index at the very end,
// because half the entries a body points at have no row yet while loading.

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
import { campaignRow, indexCampaign } from "../store/campaigns";
import { indexGlossaryTerm } from "../store/glossary";
import { PROPERTY_CONTRACT } from "../store/properties";
import { insertDraft } from "../store/drafts";
import { logLineId } from "../store/body-parse";
import { chapterPath, locationPath, npcPath, sceneAddress } from "../store/paths";
import { expandIndexedRefs } from "../store/refs";

/** An entry's properties as the API speaks them. */
type Properties = Record<string, unknown>;

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

/** One glossary row. */
export interface SeedGlossaryEntry {
  term: string;
  explanation: string;
}

/**
 * One seeded entry. `kind` is what decides the shape — the same discriminator
 * the API uses for an entry.
 */
export type SeedEntry =
  | { kind: "campaign"; properties: Properties; body?: string }
  | { kind: "chapter"; properties: Properties; body?: string }
  | { kind: "scene"; properties: Properties; body?: string }
  | { kind: "npc"; properties: Properties; body?: string }
  | { kind: "location"; properties: Properties; body?: string }
  | { kind: "session"; properties: Properties; body?: string; log?: SeedLogLine[] }
  | { kind: "inbox"; entries: SeedInboxEntry[] }
  | { kind: "glossary"; intro?: string; entries: SeedGlossaryEntry[] };

/** The kinds that carry `properties` and a `body`. */
const ENTRY_KINDS = ["campaign", "chapter", "scene", "npc", "location", "session"] as const;

/**
 * The order the kinds are written in — the foreign keys decide it, so this is
 * the one place it is written down.
 */
const LOAD_ORDER: SeedEntry["kind"][] = [
  "campaign",
  "chapter",
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
 * Validate one parsed JSON object into a `SeedEntry`. Deliberately strict —
 * the seed is the contract of the whole test suite, and a silently ignored
 * key there would hide a real mismatch with the API shape.
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
  if (!(ENTRY_KINDS as readonly string[]).includes(kind)) fail(where, `unknown kind "${kind}"`);
  const properties = value.properties;
  if (!isRecord(properties)) fail(where, "`properties` must be a JSON object");
  requireString(where, "`properties.id`", properties.id);
  const body = value.body;
  if (body !== undefined && typeof body !== "string") fail(where, "`body` must be a string");
  const contract: readonly string[] = PROPERTY_CONTRACT[kind as keyof typeof PROPERTY_CONTRACT];
  for (const key of Object.keys(properties)) {
    if (!contract.includes(key)) fail(where, `unknown property "${key}" — no such field`);
  }
  if (kind === "session") {
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
          ...(l.sceneId === undefined
            ? {}
            : { sceneId: requireString(at, "`sceneId`", l.sceneId) }),
          text: requireString(at, "`text`", l.text),
          ...(l.reviewed === true ? { reviewed: true } : {}),
        };
      }),
    };
  }
  return {
    kind: kind as "campaign" | "chapter" | "scene" | "npc" | "location",
    properties,
    body: typeof body === "string" ? body : "",
  };
}

function asInboxEntry(where: string, value: unknown): SeedInboxEntry {
  if (!isRecord(value)) fail(where, "not a JSON object");
  const text = requireString(where, "`text`", value.text);
  return { text, ...(value.done === true ? { done: true } : {}) };
}

/**
 * Read one campaign directory: every fixture file in it, sorted BY NAME.
 * The name itself carries no meaning — it is only what makes the order
 * deterministic and what an error message and `seedStore({ without })` name
 * an entry by.
 */
export async function readFixtureCampaign(dir: string): Promise<SeedEntry[]> {
  return (await readFixtureSources(dir)).map((source) => source.entry);
}

/** `readFixtureCampaign`, with the fixture file stem each entry came from. */
export async function readFixtureSources(dir: string): Promise<SeedSource[]> {
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "en"));
  const sources: SeedSource[] = [];
  for (const name of names) {
    const jsonPath = path.join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(jsonPath, "utf8"));
    } catch (error) {
      fail(name, `not readable as JSON — ${error instanceof Error ? error.message : error}`);
    }
    sources.push({ stem: name.slice(0, -".json".length), entry: asSeedEntry(name, parsed) });
  }
  return sources;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function asOptString(value: unknown): string | null {
  const s = asString(value, " ");
  return s === " " ? null : s;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => v !== null && v !== undefined).map((v) => String(v));
}

/** The campaign-relative address one seeded entry is written to. */
function addressOf(entry: SeedEntry & { properties: Properties }): string {
  const id = asString(entry.properties.id);
  switch (entry.kind) {
    case "chapter":
      return chapterPath(id);
    case "npc":
      return npcPath(id);
    case "location":
      return locationPath(id);
    default:
      return sceneAddress({
        chapterId: asOptString(entry.properties.chapter),
        location: asOptString(entry.properties.location),
        id,
      });
  }
}

/**
 * Write one campaign's entries into `db`, in ONE transaction. Exactly one
 * `campaign` entry is required: the campaign row is what every other row
 * hangs off, and a seed without it (or with two) does not describe a campaign.
 */
export function seedCampaign(
  db: GrimoireDb,
  entries: SeedEntry[],
): { campaignId: string; entries: number } {
  const campaignEntries = entries.filter((e) => e.kind === "campaign");
  if (campaignEntries.length !== 1) {
    throw new SeedError(
      `a campaign needs exactly one \`campaign\` entry, found ${campaignEntries.length}`,
    );
  }
  const campaignProperties = campaignEntries[0]!.properties;
  const campaignId = requireString("campaign entry", "`properties.id`", campaignProperties.id);
  const byKind = (kind: SeedEntry["kind"]): SeedEntry[] => entries.filter((e) => e.kind === kind);

  db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    for (const kind of LOAD_ORDER) {
      for (const entry of byKind(kind)) writeEntry(tx, campaignId, entry);
    }
    // The SECOND pass over the search index: bodies are indexed with their
    // `[[id]]` references replaced by the referenced display name
    // (store/refs.ts), and while loading, half the entries a body points at
    // have no row yet.
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
      return writeCampaignRow(tx, campaignId, entry.properties, entry.body ?? "");
    case "chapter":
    case "scene":
    case "npc":
    case "location": {
      const address = addressOf(entry);
      return insertDraft(tx, campaignId, {
        rel: address,
        address,
        properties: entry.properties,
        body: entry.body ?? "",
      });
    }
    case "session":
      return writeSessionRows(tx, campaignId, entry);
    case "inbox":
      return writeInboxRows(tx, campaignId, entry.entries);
    case "glossary":
      return writeGlossaryRows(tx, campaignId, entry);
  }
}

/**
 * The campaign row. `name` is stored EMPTY when the seed names none — the id
 * fallback belongs to the renderer (store/render.ts `campaignDisplayName`),
 * so a campaign whose display name is its id must not carry that id as an
 * authored name.
 */
function writeCampaignRow(
  tx: GrimoireDb,
  campaignId: string,
  properties: Properties,
  body: string,
): void {
  tx.insert(campaigns)
    .values({
      id: campaignId,
      name: asString(properties.name),
      description: asOptString(properties.description),
      body,
    })
    .run();
  const row = campaignRow(tx, campaignId);
  if (row !== undefined) indexCampaign(tx, row);
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
