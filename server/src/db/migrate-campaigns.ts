// The one-time migration from the markdown file tree into the database
// (issue #54; planning #52 Fassung 3, section 3). This is the ONLY place in
// the server that will still read campaign markdown once the cutover
// (Scheibe 2) is done — the single, deliberate bridge between the old format
// and the new storage.
//
// The four rules that make it safe to run on a DM's real campaign:
//
//   1. IT NEVER TOUCHES THE FILES. No delete, no move, no marker file, not
//      even an mtime change (PO decision F-neu-1). The source tree is left
//      exactly as it was and is simply ignored afterwards — it stays the
//      readable pre-migration snapshot, which is the whole fallback story
//      (planning risk R1).
//   2. IT IS IDEMPOTENT, three times over: `meta['migrated_at']` marks a
//      finished run, `meta['migrated_campaign:<id>']` marks each single
//      campaign as committed (so a run interrupted between two campaigns
//      RESUMES instead of dead-ending), and — defensively, for a database
//      that has content but no marker at all — a NON-EMPTY database is never
//      overwritten.
//   3. ONE TRANSACTION PER CAMPAIGN. A campaign is either fully in the
//      database or not at all; a broken file in campaign B cannot leave
//      campaign A half-imported.
//   4. IT DEGRADES, IT DOES NOT FAIL. Anything the importer cannot turn into
//      rows is named in the run's report (path and reason, printed by the
//      CLI); the file itself stays where it is — the tree is input, not
//      storage. An empty report means a clean import; a non-empty one is a
//      reading task for the DM, not an error.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { kindFromPath, parseMarkdown, sessionPauses } from "@grimoire/shared";
import { toSlug } from "@grimoire/shared/slug";
import { isDbEmpty, type GrimoireDb } from "./client";
import {
  parseGlossaryBody,
  parseInboxBody,
  parseLogSection,
  parseRelationsSection,
  removeRelationLines,
  removeSection,
  SECTION_LEVEL,
} from "./import-markdown";
import {
  campaigns as campaignsTable,
  chapters as chaptersTable,
  glossary as glossaryTable,
  inboxEntries as inboxTable,
  locations as locationsTable,
  logEntries as logTable,
  meta as metaTable,
  npcRelations as relationsTable,
  npcs as npcsTable,
  packJson,
  sceneNpcs as sceneNpcsTable,
  sceneTags as sceneTagsTable,
  scenes as scenesTable,
  sessionPauses as pausesTable,
  sessionScenesPlayed as playedTable,
  sessions as sessionsTable,
} from "./schema";
import { eq, sql } from "drizzle-orm";
import { expandIndexedRefs } from "../store/refs";

/** Directories under a campaign that are NOT chapters. */
const RESERVED_DIRS = new Set(["npcs", "locations", "sessions"]);

/** File names that hold the glossary — both spellings are in the wild. */
const GLOSSARY_FILES = new Set(["glossary.md", "glossar.md"]);

/** Anything the transaction can write through. */
type DbWriter = GrimoireDb;

// --- results -----------------------------------------------------------------

export interface MigrationOutcome {
  /** True when campaigns were imported by THIS call. */
  migrated: boolean;
  /** Why nothing was imported — set exactly when `migrated` is false. */
  skipped?: "already-migrated" | "database-not-empty" | "no-campaigns";
  /** Ids of the campaigns imported (empty when skipped). */
  campaigns: string[];
  /**
   * Campaigns a PREVIOUS, interrupted run had already committed and that this
   * run therefore left alone. Non-empty means this call resumed.
   */
  resumedFrom: string[];
  /**
   * Every degradation of THIS run — path and reason per incident, in import
   * order. Empty = clean import. The CLI prints it; nothing stores it.
   */
  report: RunReportEntry[];
  /** The run's ISO timestamp — the `at` of every row this run wrote. */
  at?: string;
}

export interface RunReportEntry {
  campaignId: string;
  /** Campaign-relative path the incident happened in; "" when campaign-wide. */
  path: string;
  /** Human-readable German reason — read by the DM, not by code. */
  reason: string;
}

/**
 * `meta` key marking ONE campaign as fully committed. Written inside the
 * campaign's own transaction, so it exists exactly when its rows do.
 *
 * This is what makes a crash mid-migration recoverable: the global
 * `migrated_at` is only written after the LAST campaign, so without these
 * per-campaign markers a database with campaign A committed and B missing
 * would look like "content without a marker" — and the defensive rule would
 * refuse to ever touch it again. With them, the next run resumes at B.
 */
export function campaignMarkerKey(id: string): string {
  return `migrated_campaign:${id}`;
}

const CAMPAIGN_MARKER_PREFIX = "migrated_campaign:";

/** The campaigns a previous run already committed. */
function migratedCampaigns(db: GrimoireDb): Set<string> {
  const rows = db.all<{ key: string }>(
    sql`select key from meta where key like ${`${CAMPAIGN_MARKER_PREFIX}%`}`,
  );
  return new Set(rows.map((r) => r.key.slice(CAMPAIGN_MARKER_PREFIX.length)));
}

/** One report entry, collected while importing and written in the same tx. */
interface ReportEntry {
  path: string;
  reason: string;
}

// --- reading the file tree ---------------------------------------------------

interface RawFile {
  /** Campaign-relative path, forward slashes. */
  rel: string;
  /**
   * File contents as UTF-8 — EMPTY for a binary file, whose text form does
   * not exist (see `bytes`).
   */
  raw: string;
  /** False for a file that is not `.md` — reported and kept verbatim. */
  markdown: boolean;
  /**
   * The raw bytes, kept only for a file that is NOT valid UTF-8 text (a map
   * png, a pdf handout). Decoding those into a string would replace every
   * unmappable byte with U+FFFD and the "kept verbatim" promise would be a
   * lie — so the bytes go into `unknown_files.content_blob` instead.
   */
  bytes?: Buffer;
  /** True when the file is not decodable text. */
  binary: boolean;
}

/**
 * True when `bytes` is not UTF-8 text: a NUL byte, or a decode that does not
 * round-trip (the sign that the decoder substituted U+FFFD for something).
 */
function isBinary(bytes: Buffer, decoded: string): boolean {
  if (bytes.includes(0)) return true;
  return Buffer.compare(Buffer.from(decoded, "utf8"), bytes) !== 0;
}

interface RawCampaign {
  id: string;
  files: RawFile[];
  /** Non-reserved directories directly under the campaign — the chapters. */
  chapterDirs: string[];
}

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

/** Read one campaign directory completely. Unreadable entries are skipped. */
async function readCampaign(root: string, id: string): Promise<RawCampaign> {
  const campaignAbs = path.join(root, id);
  const files: RawFile[] = [];
  const chapterDirs: string[] = [];

  const walk = async (absDir: string, relDir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — nothing to import from it
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (isHidden(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      let s;
      try {
        s = await stat(abs); // follows symlinks
      } catch {
        continue; // dangling symlink
      }
      if (s.isDirectory()) {
        if (depth === 0 && !RESERVED_DIRS.has(entry.name)) chapterDirs.push(entry.name);
        // Depth is capped generously: deeper files still get collected so
        // they can land in `unknown_files` instead of vanishing.
        if (depth < 6) await walk(abs, rel, depth + 1);
        continue;
      }
      if (!s.isFile()) continue;
      let bytes: Buffer;
      try {
        bytes = await readFile(abs);
      } catch {
        continue;
      }
      const decoded = bytes.toString("utf8");
      const binary = isBinary(bytes, decoded);
      files.push({
        rel,
        raw: binary ? "" : decoded,
        markdown: entry.name.endsWith(".md"),
        binary,
        ...(binary ? { bytes } : {}),
      });
    }
  };

  await walk(campaignAbs, "", 0);
  return { id, files, chapterDirs };
}

/** The campaign directories directly under `root`, sorted. */
async function listCampaignDirs(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return []; // a missing root is an empty campaign set, not an error
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (isHidden(entry.name)) continue;
    try {
      if ((await stat(path.join(root, entry.name))).isDirectory()) ids.push(entry.name);
    } catch {
      // skip
    }
  }
  return ids.sort();
}

// --- frontmatter helpers ------------------------------------------------------
// Frontmatter is hand-edited, so every value can arrive with the wrong type.
// These coerce defensively and never throw (mirror of shared/src/parse.ts).

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function asString(value: unknown, fallback = ""): string {
  return asOptionalString(value) ?? fallback;
}

function asStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v) => v !== undefined && v !== null).map((v) => String(v));
}

/**
 * Split frontmatter into the contract fields a table has columns for and the
 * `extra` remainder. The remainder is what makes a hand-written key survive
 * the migration (schema.ts rule 1).
 */
function splitFrontmatter(
  fm: Record<string, unknown>,
  contractKeys: readonly string[],
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (!contractKeys.includes(key)) extra[key] = value;
  }
  return extra;
}

/**
 * True when the file has NO usable frontmatter: either no frontmatter block
 * at all, or one whose YAML did not parse. `parseMarkdown` signals both the
 * same way — it hands back the ENTIRE raw file as the body (shared/parse.ts)
 * — which is exactly the signal used here.
 *
 * A file like that cannot be turned into a row: its id would be a guess and
 * its contract fields do not exist. It goes to `unknown_files` verbatim.
 */
function hasFrontmatterBlock(raw: string): boolean {
  return /^﻿?---\r?\n/.test(raw);
}

function frontmatterUnusable(raw: string, body: string): boolean {
  // An EMPTY file has nothing to lose either way; treat it as usable so an
  // empty `inbox.md` does not become a report entry.
  if (raw.trim() === "") return false;
  return body === raw;
}

/**
 * True for a file whose import needs NO frontmatter at all, so a missing
 * block is normal rather than a degradation.
 *
 * The inbox is the case that matters: THE APP ITSELF writes it. A campaign
 * that never had an `inbox.md` gets one from `POST /api/:campaign/inbox` as
 * plain `# Inbox\n\n- text` with no frontmatter (campaign-write.ts,
 * `appendInboxEntry`) — treating that as unusable would push every ingested
 * idea of such a campaign into `unknown_files` and out of the app's inbox.
 * The glossary is the same shape: `parseGlossaryBody` reads only the body,
 * and the frontmatter block holds at most a decorative `id`.
 *
 * Everything else keeps degrading: an npc, scene or session without
 * frontmatter has no id, and an invented id is a reference that never existed.
 *
 * A BROKEN frontmatter block still degrades even here — its `---` lines would
 * otherwise turn into inbox rows.
 */
function needsNoFrontmatter(cls: FileClass, raw: string): boolean {
  if (hasFrontmatterBlock(raw)) return false;
  return cls.kind === "inbox" || cls.kind === "glossary";
}

// --- the FTS index ------------------------------------------------------------

/**
 * Index one entity for search. Maintained explicitly from here (planning
 * section 2: "Pflege explizit aus der Store-Schicht") — the migration is the
 * first writer, Scheibe 2's store methods are the next.
 */
function indexForSearch(
  tx: DbWriter,
  campaignId: string,
  kind: string,
  entityId: string,
  title: string,
  ref: string,
  tags: string,
  body: string,
): void {
  tx.run(sql`
    insert into search_fts (title, ref, tags, body, campaign_id, kind, entity_id)
    values (${title}, ${ref}, ${tags}, ${body}, ${campaignId}, ${kind}, ${entityId})
  `);
}

// --- classification -----------------------------------------------------------

type FileClass =
  | { kind: "campaign" }
  | { kind: "chapter"; chapterId: string }
  | { kind: "scene"; chapterId: string; groupSlug: string }
  | { kind: "npc" }
  | { kind: "location" }
  | { kind: "session" }
  | { kind: "inbox" }
  | { kind: "glossary" }
  | { kind: "unknown"; reason: string };

/**
 * Which entity a campaign-relative path is. Stricter than
 * `kindFromPath` on purpose: that function answers the FORMAT question
 * ("what would this be"), while the migration must also decide what to do
 * with a path the format does not describe — `npcs/alt/fenn.md`, a scene
 * three directories deep, a `.txt` file. Those become `unknown_files`
 * instead of being force-fitted into a table.
 */
function classify(file: RawFile): FileClass {
  const segments = file.rel.split("/");
  const basename = segments[segments.length - 1]!;

  if (file.binary) {
    const size = file.bytes?.length ?? 0;
    return {
      kind: "unknown",
      reason: `Keine Textdatei (${size} Byte, binär) — nicht übernommen, die Datei bleibt im Baum.`,
    };
  }

  if (!file.markdown) {
    return { kind: "unknown", reason: "Keine Markdown-Datei — nicht übernommen, die Datei bleibt im Baum." };
  }

  if (segments.length === 1) {
    if (basename === "_campaign.md") return { kind: "campaign" };
    if (basename === "inbox.md") return { kind: "inbox" };
    if (GLOSSARY_FILES.has(basename)) return { kind: "glossary" };
    return {
      kind: "unknown",
      reason:
        "Markdown-Datei im Kampagnen-Wurzelverzeichnis, die keine bekannte Rolle hat " +
        "(erwartet: _campaign.md, inbox.md, glossary.md).",
    };
  }

  const first = segments[0]!;
  if (RESERVED_DIRS.has(first)) {
    if (segments.length !== 2) {
      return {
        kind: "unknown",
        reason: `Datei in einem Unterordner von ${first}/ — das Format kennt dort nur direkte Dateien.`,
      };
    }
    if (first === "npcs") return { kind: "npc" };
    if (first === "locations") return { kind: "location" };
    return { kind: "session" };
  }

  // Inside a chapter directory. The README caps the layout at two levels.
  if (segments.length === 2) {
    if (basename === "_chapter.md") return { kind: "chapter", chapterId: first };
    return { kind: "scene", chapterId: first, groupSlug: "" };
  }
  if (segments.length === 3) {
    if (basename === "_chapter.md") {
      return {
        kind: "unknown",
        reason:
          "_chapter.md in einem Orts-Unterordner — Kapitelmetadaten gehören direkt ins Kapitel.",
      };
    }
    return { kind: "scene", chapterId: first, groupSlug: segments[1]! };
  }
  return {
    kind: "unknown",
    reason: "Szene mehr als zwei Ebenen tief — das Format erlaubt maximal <Kapitel>/<Ort>/<Szene>.md.",
  };
}

// --- importing one campaign ---------------------------------------------------

/**
 * Import one campaign inside an open transaction. Every degradation appends
 * to `report`; the offending file stays where it is — the tree is input.
 */
function importCampaign(
  tx: DbWriter,
  campaign: RawCampaign,
  at: string,
  report: ReportEntry[],
): void {
  const campaignId = campaign.id;
  const unknown: RawFile[] = [];
  const degrade = (file: RawFile, reason: string): void => {
    report.push({ path: file.rel, reason });
    unknown.push(file);
  };

  // Parse everything once, in path order.
  interface Parsed {
    file: RawFile;
    cls: FileClass;
    frontmatter: Record<string, unknown>;
    body: string;
  }
  const parsed: Parsed[] = [];
  for (const file of campaign.files) {
    const cls = classify(file);
    if (cls.kind === "unknown") {
      degrade(file, cls.reason);
      continue;
    }
    // `kindFromPath` stays the format's own answer and is asserted against
    // our stricter classification for the cases where both have an opinion —
    // a divergence here would mean the two drifted apart.
    void kindFromPath(file.rel);
    const p = parseMarkdown(file.raw, file.rel, 0);
    if (frontmatterUnusable(file.raw, p.body) && !needsNoFrontmatter(cls, file.raw)) {
      degrade(
        file,
        hasFrontmatterBlock(file.raw)
          ? "Der Eigenschaften-Block konnte nicht gelesen werden (kaputtes YAML) — Datei unverändert übernommen."
          : "Datei ohne Eigenschaften-Block — Datei unverändert übernommen.",
      );
      continue;
    }
    parsed.push({ file, cls, frontmatter: p.properties, body: p.body });
  }

  const find = (kind: FileClass["kind"]): Parsed[] => parsed.filter((p) => p.cls.kind === kind);

  // 1. the campaign row (must exist first — everything references it).
  const campaignFiles = find("campaign");
  const campaignFm = campaignFiles[0];
  const campaignName = asString(campaignFm?.frontmatter.name);
  tx.insert(campaignsTable)
    .values({
      id: campaignId,
      // `parseMarkdown` falls a missing `name` back to the id; that is a
      // parser artifact, not an authored display name.
      name: campaignName === campaignId ? "" : campaignName,
      description: asOptionalString(campaignFm?.frontmatter.description) ?? null,
      body: campaignFm?.body.trim() === "" ? "" : (campaignFm?.body ?? ""),
      extra: packJson(
        campaignFm === undefined
          ? {}
          : splitFrontmatter(campaignFm.frontmatter, ["id", "name", "description"]),
      ),
    })
    .run();
  if (campaignFiles.length > 1) {
    for (const dup of campaignFiles.slice(1)) {
      degrade(dup.file, "Zweite _campaign.md — nur die erste wurde übernommen.");
    }
  }
  indexForSearch(
    tx,
    campaignId,
    "campaign",
    campaignId,
    campaignName === campaignId ? campaignId : campaignName,
    campaignId,
    "",
    campaignFm?.body ?? "",
  );

  // 2. chapters. A chapter exists because its DIRECTORY exists; `_chapter.md`
  //    only supplies title and status (README: the file is optional).
  const chapterMeta = new Map<string, Parsed>();
  for (const p of find("chapter")) {
    const id = (p.cls as { chapterId: string }).chapterId;
    if (chapterMeta.has(id)) {
      degrade(p.file, `Zweite _chapter.md für Kapitel „${id}" — nur die erste wurde übernommen.`);
      continue;
    }
    chapterMeta.set(id, p);
  }
  const chapterIds = [...new Set([...campaign.chapterDirs, ...chapterMeta.keys()])].sort();
  chapterIds.forEach((id, pos) => {
    const p = chapterMeta.get(id);
    const title = asString(p?.frontmatter.title, id);
    tx.insert(chaptersTable)
      .values({
        campaignId,
        id,
        title: title === "" ? id : title,
        status: asOptionalString(p?.frontmatter.status) ?? null,
        body: p?.body ?? "",
        extra: packJson(
          p === undefined ? {} : splitFrontmatter(p.frontmatter, ["id", "title", "status"]),
        ),
        pos,
      })
      .run();
    indexForSearch(tx, campaignId, "chapter", id, title === "" ? id : title, id, "", p?.body ?? "");
  });

  // 3. npcs and locations before scenes — not required by a foreign key
  //    (scene references are soft, schema.ts rule 3) but it keeps the
  //    id-collision reports in a readable order.
  const npcIds = new Set<string>();
  for (const p of find("npc")) {
    const id = asString(p.frontmatter.id);
    if (id === "" || npcIds.has(id)) {
      degrade(
        p.file,
        id === ""
          ? "NPC ohne verwendbare id — Datei unverändert übernommen."
          : `NPC-id „${id}" doppelt — die erste Datei gewinnt, diese wurde unverändert übernommen.`,
      );
      continue;
    }
    npcIds.add(id);
    const name = asString(p.frontmatter.name, id);
    const relations = parseRelationsSection(p.body);
    // `quickstats` is a MAP in the format (README, "Entität: NPC"). A
    // hand-edited file can hold a list or a scalar there, and packing that
    // into the object column would degrade it to `{}` — a value gone with no
    // trace. Keep it in `extra` under its own key and say so in the report.
    const rawQuickstats = p.frontmatter.quickstats;
    const quickstatsIsMap =
      typeof rawQuickstats === "object" && rawQuickstats !== null && !Array.isArray(rawQuickstats);
    const quickstatsMisshaped = rawQuickstats !== undefined && rawQuickstats !== null && !quickstatsIsMap;
    tx.insert(npcsTable)
      .values({
        campaignId,
        id,
        name,
        role: asOptionalString(p.frontmatter.role) ?? null,
        chapterId: asOptionalString(p.frontmatter.chapter) ?? null,
        status: asString(p.frontmatter.status, "unknown"),
        statblock: asOptionalString(p.frontmatter.statblock) ?? null,
        quickstats: packJson(quickstatsIsMap ? rawQuickstats : {}),
        voice: asOptionalString(p.frontmatter.voice) ?? null,
        appearance: asOptionalString(p.frontmatter.appearance) ?? null,
        // `## Beziehungen` becomes rows, so it must not also stay as prose.
        // Only the LINES that were parsed go (see removeRelationLines): a
        // `###` subsection under it, and any line that became no row, stay in
        // the body rather than vanishing.
        body: removeRelationLines(p.body),
        extra: packJson({
          ...splitFrontmatter(p.frontmatter, [
            "id",
            "name",
            "role",
            "chapter",
            "status",
            "statblock",
            "quickstats",
            "voice",
            "appearance",
          ]),
          // Only when it does not fit the column (see above).
          ...(quickstatsMisshaped ? { quickstats: rawQuickstats } : {}),
        }),
      })
      .run();
    if (quickstatsMisshaped) {
      degrade(
        p.file,
        '„quickstats" ist keine Schlüssel-Wert-Liste und passt nicht in die Quickstats-Spalte — ' +
          "der Wert wurde unverändert in die Zusatzfelder (extra) übernommen.",
      );
    }
    for (const relation of relations.relations) {
      tx.insert(relationsTable)
        .values({ campaignId, npcId: id, otherNpcId: relation.otherNpcId, note: relation.note, pos: relation.pos })
        .run();
    }
    for (const line of relations.foreignLines) {
      degrade(
        p.file,
        `Zeile unter „## Beziehungen" ist keine „- <npc-id>: <Text>"-Beziehung: „${line}"`,
      );
    }
    indexForSearch(
      tx,
      campaignId,
      "npc",
      id,
      name,
      id,
      asString(p.frontmatter.role),
      p.body,
    );
  }

  const locationIds = new Set<string>();
  for (const p of find("location")) {
    const id = asString(p.frontmatter.id);
    if (id === "" || locationIds.has(id)) {
      degrade(
        p.file,
        id === ""
          ? "Ort ohne verwendbare id — Datei unverändert übernommen."
          : `Ort-id „${id}" doppelt — die erste Datei gewinnt, diese wurde unverändert übernommen.`,
      );
      continue;
    }
    locationIds.add(id);
    const name = asString(p.frontmatter.name, id);
    tx.insert(locationsTable)
      .values({
        campaignId,
        id,
        name,
        chapterId: asOptionalString(p.frontmatter.chapter) ?? null,
        roll20Page: asOptionalString(p.frontmatter["roll20-page"]) ?? null,
        body: p.body,
        extra: packJson(splitFrontmatter(p.frontmatter, ["id", "name", "chapter", "roll20-page"])),
      })
      .run();
    indexForSearch(tx, campaignId, "location", id, name, id, "", p.body);
  }

  // 4. scenes plus their ordered npc and tag references.
  /** Location id -> the text the scene named it with, for the entries below. */
  const sceneLocationNames = new Map<string, string>();
  const sceneIds = new Set<string>();
  let scenePos = 0;
  for (const p of find("scene")) {
    const cls = p.cls as { chapterId: string; groupSlug: string };
    const id = asString(p.frontmatter.id);
    if (id === "" || sceneIds.has(id)) {
      degrade(
        p.file,
        id === ""
          ? "Szene ohne verwendbare id — Datei unverändert übernommen."
          : `Szenen-id „${id}" doppelt — die erste Datei gewinnt, diese wurde unverändert übernommen.`,
      );
      continue;
    }
    sceneIds.add(id);
    const title = asString(p.frontmatter.title, id);
    const npcRefs = asStringArray(p.frontmatter.npcs);
    const tags = asStringArray(p.frontmatter.tags);
    const rawLocation = (asOptionalString(p.frontmatter.location) ?? cls.groupSlug).trim();
    const locationSlug = rawLocation === "" ? "" : toSlug(rawLocation);
    // A `location` that transliterates to NOTHING („???", an emoji): the
    // field is imported empty, and that is a degrade the DM has to read —
    // it used to happen in silence (issue #100 review).
    if (rawLocation !== "" && locationSlug === "") {
      degrade(
        p.file,
        `location „${rawLocation}" ergibt keine Orts-id — Feld leer übernommen.`,
      );
    }
    const sceneLocation = locationSlug === "" ? null : locationSlug;
    if (sceneLocation !== null && sceneLocation !== rawLocation) {
      degrade(
        p.file,
        `location „${rawLocation}" ist keine Orts-id — als Ort „${sceneLocation}" angelegt.`,
      );
    }
    if (sceneLocation !== null) sceneLocationNames.set(sceneLocation, rawLocation);
    tx.insert(scenesTable)
      .values({
        campaignId,
        id,
        // The DIRECTORY decides which chapter a scene belongs to — that is
        // what the tree the DM has been looking at was built from. A
        // disagreeing `chapter:` key is kept in `extra` rather than dropped.
        chapterId: cls.chapterId,
        title,
        type: asString(p.frontmatter.type, "planned"),
        trigger: asOptionalString(p.frontmatter.trigger) ?? null,
        // `location` IS the group since issue #100, so the import derives
        // it the way the file tree meant it: an explicit value wins, an
        // empty one inherits the group DIRECTORY the file sat in. Free text
        // becomes the slug of that text (`Die Bucht` -> `die-bucht`) and the
        // entry is created below — the format's free-text location is gone.
        location: sceneLocation,
        status: asString(p.frontmatter.status, "draft"),
        handouts: packJson(asStringArray(p.frontmatter.handouts)),
        body: p.body,
        extra: packJson({
          ...splitFrontmatter(p.frontmatter, [
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
          ]),
          // Kept only when it disagrees with the directory (see above).
          ...(asOptionalString(p.frontmatter.chapter) !== undefined &&
          asOptionalString(p.frontmatter.chapter) !== cls.chapterId
            ? { chapter: p.frontmatter.chapter }
            : {}),
        }),
        pos: scenePos++,
      })
      .run();
    const seenNpcs = new Set<string>();
    npcRefs.forEach((npcId, pos) => {
      if (npcId === "" || seenNpcs.has(npcId)) return; // duplicate ref: no second row
      seenNpcs.add(npcId);
      tx.insert(sceneNpcsTable).values({ campaignId, sceneId: id, npcId, pos }).run();
    });
    const seenTags = new Set<string>();
    tags.forEach((tag, pos) => {
      if (tag === "" || seenTags.has(tag)) return;
      seenTags.add(tag);
      tx.insert(sceneTagsTable).values({ campaignId, sceneId: id, tag, pos }).run();
    });
    indexForSearch(tx, campaignId, "scene", id, title, id, tags.join(" "), p.body);
  }

  // 4b. Referencing creates (#70, #100): a scene's `location` is its group,
  // so an id without an entry would be a heading the campaign cannot name.
  // The entry gets the text the scene used as its `name` when that text was
  // not already the id — the file tree's `hafen/` directory and its free-text
  // locations become real entries here, and nowhere else.
  for (const [id, named] of [...sceneLocationNames].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (locationIds.has(id)) continue;
    locationIds.add(id);
    const name = named === id ? "" : named;
    tx.insert(locationsTable).values({ campaignId, id, name }).run();
    indexForSearch(tx, campaignId, "location", id, name === "" ? id : name, id, "", "");
  }

  // 5. sessions with pauses, log lines and played scenes.
  const sessionIds = new Set<string>();
  for (const p of find("session")) {
    const id = asString(p.frontmatter.id);
    if (id === "" || sessionIds.has(id)) {
      degrade(
        p.file,
        id === ""
          ? "Session ohne verwendbare id — Datei unverändert übernommen."
          : `Session-id „${id}" doppelt — die erste Datei gewinnt, diese wurde unverändert übernommen.`,
      );
      continue;
    }
    sessionIds.add(id);
    tx.insert(sessionsTable)
      .values({
        campaignId,
        id,
        started: asOptionalString(p.frontmatter.started) ?? null,
        ended: asOptionalString(p.frontmatter.ended) ?? null,
        // `## Log` becomes rows; everything else (`## Threads` above all)
        // stays as the session's body.
        body: removeSection(p.body, "Log", SECTION_LEVEL),
        extra: packJson(
          splitFrontmatter(p.frontmatter, [
            "id",
            "started",
            "ended",
            "scenes_played",
            "pauses",
            "reviewed",
          ]),
        ),
      })
      .run();

    // Pauses: `sessionPauses` (shared) already drops the broken entries —
    // that is the format's degrade rule, and it is reported here so the DM
    // learns that a pause went missing.
    const rawPauses = p.frontmatter.pauses;
    const rawPauseCount = Array.isArray(rawPauses)
      ? rawPauses.length
      : rawPauses === undefined || rawPauses === null
        ? 0
        : 1;
    const pauses = sessionPauses(p.frontmatter);
    pauses.forEach((pause, pos) => {
      tx.insert(pausesTable)
        .values({ campaignId, sessionId: id, pos, fromTs: pause.from, toTs: pause.to ?? null })
        .run();
    });
    if (rawPauseCount > pauses.length) {
      degrade(
        p.file,
        `${rawPauseCount - pauses.length} Pausen-Eintrag/Einträge waren unlesbar und wurden ` +
          "weggelassen (Datei unverändert übernommen).",
      );
    }

    // Log lines, with the `reviewed` hash list resolved onto the rows.
    const reviewed = new Set(asStringArray(p.frontmatter.reviewed));
    const matched = new Set<string>();
    for (const entry of parseLogSection(p.body)) {
      const isReviewed = reviewed.has(entry.hash);
      if (isReviewed) matched.add(entry.hash);
      tx.insert(logTable)
        .values({
          campaignId,
          sessionId: id,
          pos: entry.pos,
          raw: entry.raw,
          at: entry.at ?? null,
          sceneId: entry.sceneId ?? null,
          text: entry.text ?? null,
          hash: entry.hash,
          reviewed: isReviewed ? 1 : 0,
        })
        .run();
      if (entry.foreign) {
        degrade(p.file, `Log-Zeile ohne erkennbares Format als Rohtext übernommen: „${entry.raw}"`);
      }
    }
    const orphans = [...reviewed].filter((hash) => !matched.has(hash));
    if (orphans.length > 0) {
      degrade(
        p.file,
        `${orphans.length} Eintrag/Einträge in „reviewed" gehören zu keiner Log-Zeile mehr ` +
          `(${orphans.join(", ")}) und wurden verworfen.`,
      );
    }

    // `scenes_played` is an ORDERED list and a scene the party returned to
    // appears in it twice. `pos` is part of the key, so a repetition is a
    // second row: the sequence is what the review reads back.
    asStringArray(p.frontmatter.scenes_played).forEach((sceneId, pos) => {
      if (sceneId === "") return;
      tx.insert(playedTable).values({ campaignId, sessionId: id, sceneId, pos }).run();
    });
  }

  // 6. the inbox.
  const inboxFiles = find("inbox");
  const inbox = inboxFiles[0];
  if (inbox !== undefined) {
    for (const entry of parseInboxBody(inbox.body)) {
      tx.insert(inboxTable)
        .values({
          campaignId,
          pos: entry.pos,
          raw: entry.raw,
          text: entry.text ?? null,
          done: entry.done ? 1 : 0,
        })
        .run();
      if (entry.foreign) {
        degrade(inbox.file, `Inbox-Zeile ohne Listenformat als Rohtext übernommen: „${entry.raw}"`);
      }
    }
    const inboxExtra = splitFrontmatter(inbox.frontmatter, ["id"]);
    if (Object.keys(inboxExtra).length > 0) {
      degrade(
        inbox.file,
        `Felder der Inbox haben in der Datenbank keinen Platz: ` +
          `${Object.keys(inboxExtra).join(", ")} (Datei unverändert übernommen).`,
      );
    }
  }

  // 7. the glossary (planning F6: a structured table, not a blob).
  const glossaryFiles = find("glossary");
  const glossaryFile = glossaryFiles[0];
  if (glossaryFile !== undefined) {
    const result = parseGlossaryBody(glossaryFile.body);
    for (const entry of result.entries) {
      tx.insert(glossaryTable)
        .values({
          campaignId,
          term: entry.term,
          explanation: entry.explanation,
          pos: entry.pos,
        })
        .run();
      indexForSearch(
        tx,
        campaignId,
        "glossary",
        entry.term,
        entry.term,
        entry.term,
        "",
        entry.explanation,
      );
    }
    // Prose above the first heading belongs to no term — it is REPORTED and
    // kept, so a later save of the rendered glossary cannot delete it.
    if (result.preamble !== "") {
      tx.update(campaignsTable)
        .set({ glossaryIntro: result.preamble })
        .where(eq(campaignsTable.id, campaignId))
        .run();
    }
    for (const problem of result.problems) degrade(glossaryFile.file, problem);
    const glossaryExtra = splitFrontmatter(glossaryFile.frontmatter, ["id"]);
    if (Object.keys(glossaryExtra).length > 0) {
      degrade(
        glossaryFile.file,
        `Felder des Glossars haben in der Datenbank keinen Platz: ` +
          `${Object.keys(glossaryExtra).join(", ")} (Datei unverändert übernommen).`,
      );
    }
  }
  for (const dup of glossaryFiles.slice(1)) {
    degrade(dup.file, "Zweite Glossar-Datei — nur die erste wurde übernommen.");
  }
  for (const dup of inboxFiles.slice(1)) {
    degrade(dup.file, "Zweite inbox.md — nur die erste wurde übernommen.");
  }

  // 7b. `[[slug]]` body references (issue #68): the SECOND pass over the
  //     search index, once every row of this campaign exists. Bodies are
  //     indexed with their references replaced by the referenced display name
  //     (store/refs.ts), and while importing, half the entities a body points
  //     at have no row yet — so the expansion cannot happen inline.
  expandIndexedRefs(tx, campaignId);

}

// --- the entry point ----------------------------------------------------------

/**
 * Run the one-time migration of `root` into `db`. Safe to call on every boot:
 * a database that has already been migrated, or that simply holds data, is
 * left completely alone (rule 2).
 *
 * `force` skips only the marker/empty checks and exists for `grimoire seed`
 * on a scratch database — never for the boot path.
 */
export async function runInitialMigration(
  db: GrimoireDb,
  root: string,
  options: { force?: boolean } = {},
): Promise<MigrationOutcome> {
  const nothing = (skipped: MigrationOutcome["skipped"]): MigrationOutcome => ({
    migrated: false,
    skipped,
    campaigns: [],
    resumedFrom: [],
    report: [],
  });

  // Campaigns a previous run committed. Read even under `--force`, so a forced
  // seed does not try to insert a campaign that is already in there.
  let done = migratedCampaigns(db);

  if (options.force !== true) {
    const marker = db.all<{ value: string }>(
      sql`select value from meta where key = 'migrated_at'`,
    );
    if (marker.length > 0) return nothing("already-migrated");
    if (!isDbEmpty(db) && done.size === 0) {
      // The defensive rule (planning section 3): content without ANY marker is
      // still content. Overwriting it would be the one unrecoverable move.
      // (With per-campaign markers present we resume instead — see below.)
      return nothing("database-not-empty");
    }
  } else {
    // A forced run on a database that never ran the migration must not skip
    // anything because of stale markers from another source.
    if (isDbEmpty(db)) done = new Set();
  }

  const ids = await listCampaignDirs(root);
  if (ids.length === 0) return nothing("no-campaigns");

  const todo = ids.filter((id) => !done.has(id));
  const resumedFrom = ids.filter((id) => done.has(id));

  const at = new Date().toISOString();
  const runReport: RunReportEntry[] = [];
  const imported: string[] = [];

  const upsertMeta = (writer: DbWriter, key: string, value: string): void => {
    writer
      .insert(metaTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: metaTable.key, set: { value } })
      .run();
  };

  for (const id of todo) {
    // Read the whole campaign BEFORE opening the transaction: the driver is
    // synchronous, so no `await` may happen inside `db.transaction`.
    const campaign = await readCampaign(root, id);
    const report: ReportEntry[] = [];
    db.transaction((tx) => {
      const writer = tx as unknown as DbWriter;
      importCampaign(writer, campaign, at, report);
      // Same transaction as the rows: the marker cannot outlive a rollback,
      // and a crash after this commit leaves a resumable state.
      upsertMeta(writer, campaignMarkerKey(id), at);
    });
    for (const entry of report) runReport.push({ campaignId: id, path: entry.path, reason: entry.reason });
    imported.push(id);
  }

  upsertMeta(db, "migrated_at", at);
  upsertMeta(db, "migrated_from", path.resolve(root));

  return { migrated: true, campaigns: imported, resumedFrom, report: runReport, at };
}
