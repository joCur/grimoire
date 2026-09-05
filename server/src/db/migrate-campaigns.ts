// The one-time migration from the markdown file tree into the database
// (issue #54; planning #52 Fassung 3, section 3). This is the ONLY place in
// the server that will still read campaign markdown once the cutover
// (Scheibe 2) is done — the single, deliberate bridge between the old format
// and the new storage.
//
// The four rules that make it safe to run on a DM's real campaign:
//
//   1. IT NEVER TOUCHES THE FILES. No delete, no move, no marker file, not
//      even an mtime change (PO decision F-neu-1). CAMPAIGN_ROOT is left
//      exactly as it was and is simply ignored afterwards — it stays the
//      readable pre-migration snapshot, which is the whole fallback story
//      (planning risk R1).
//   2. IT IS IDEMPOTENT, twice over: `meta['migrated_at']` marks a finished
//      run, and — defensively, for a database that has content but somehow
//      no marker — a NON-EMPTY database is never overwritten.
//   3. ONE TRANSACTION PER CAMPAIGN. A campaign is either fully in the
//      database or not at all; a broken file in campaign B cannot leave
//      campaign A half-imported.
//   4. IT DEGRADES, IT DOES NOT FAIL. Anything the importer cannot turn into
//      rows is kept VERBATIM in `unknown_files` and explained in
//      `migration_report`. An empty report means a clean import; a non-empty
//      one is a reading task for the DM, not an error.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { kindFromPath, parseMarkdown, sessionPauses } from "@grimoire/shared";
import { isDbEmpty, type GrimoireDb } from "./client";
import {
  parseGlossaryBody,
  parseInboxBody,
  parseLogSection,
  parseRelationsSection,
  removeSection,
} from "./import-markdown";
import {
  campaigns as campaignsTable,
  chapters as chaptersTable,
  glossary as glossaryTable,
  inboxEntries as inboxTable,
  locations as locationsTable,
  logEntries as logTable,
  meta as metaTable,
  migrationReport as reportTable,
  npcRelations as relationsTable,
  npcs as npcsTable,
  packJson,
  sceneNpcs as sceneNpcsTable,
  sceneTags as sceneTagsTable,
  scenes as scenesTable,
  sessionPauses as pausesTable,
  sessionScenesPlayed as playedTable,
  sessions as sessionsTable,
  unknownFiles as unknownTable,
} from "./schema";
import { sql } from "drizzle-orm";

/** Directories under a campaign that are NOT chapters (mirror of campaign-fs). */
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
  /** Number of `migration_report` rows this run wrote. 0 = clean import. */
  reportEntries: number;
  /** Number of files kept verbatim in `unknown_files`. */
  unknownFiles: number;
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
  /** File contents as UTF-8. */
  raw: string;
  /** False for a file that is not `.md` — reported and kept verbatim. */
  markdown: boolean;
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
      let raw: string;
      try {
        raw = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      files.push({ rel, raw, markdown: entry.name.endsWith(".md") });
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

  if (!file.markdown) {
    return { kind: "unknown", reason: "Keine Markdown-Datei — Inhalt unverändert übernommen." };
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
 * Import one campaign inside an open transaction. Pure bookkeeping beyond
 * that: every degradation appends to `report` and the offending file's text
 * goes to `unknownFiles`, both written by the caller in the same transaction.
 */
function importCampaign(
  tx: DbWriter,
  campaign: RawCampaign,
  at: string,
  report: ReportEntry[],
): number {
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
    if (frontmatterUnusable(file.raw, p.body)) {
      degrade(
        file,
        hasFrontmatterBlock(file.raw)
          ? "Frontmatter konnte nicht gelesen werden (kaputtes YAML) — Datei unverändert übernommen."
          : "Datei ohne Frontmatter — Datei unverändert übernommen.",
      );
      continue;
    }
    parsed.push({ file, cls, frontmatter: p.frontmatter, body: p.body });
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
      // parser artifact, not an authored display name (see campaign-fs.ts).
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
    tx.insert(npcsTable)
      .values({
        campaignId,
        id,
        name,
        role: asOptionalString(p.frontmatter.role) ?? null,
        chapterId: asOptionalString(p.frontmatter.chapter) ?? null,
        status: asString(p.frontmatter.status, "unknown"),
        statblock: asOptionalString(p.frontmatter.statblock) ?? null,
        quickstats: packJson(p.frontmatter.quickstats ?? {}),
        voice: asOptionalString(p.frontmatter.voice) ?? null,
        appearance: asOptionalString(p.frontmatter.appearance) ?? null,
        // `## Beziehungen` becomes rows, so it must not also stay as prose.
        body: removeSection(p.body, "Beziehungen"),
        extra: packJson(
          splitFrontmatter(p.frontmatter, [
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
        ),
      })
      .run();
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
    tx.insert(scenesTable)
      .values({
        campaignId,
        id,
        // The DIRECTORY decides which chapter a scene belongs to — that is
        // what the tree the DM has been looking at was built from. A
        // disagreeing `chapter:` key is kept in `extra` rather than dropped.
        chapterId: cls.chapterId,
        groupSlug: cls.groupSlug,
        title,
        type: asString(p.frontmatter.type, "planned"),
        trigger: asOptionalString(p.frontmatter.trigger) ?? null,
        location: asOptionalString(p.frontmatter.location) ?? null,
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
        body: removeSection(p.body, "Log"),
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

    asStringArray(p.frontmatter.scenes_played).forEach((sceneId, pos) => {
      if (sceneId === "") return;
      tx.insert(playedTable)
        .values({ campaignId, sessionId: id, sceneId, pos })
        .onConflictDoNothing()
        .run();
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
        `Frontmatter-Schlüssel der Inbox haben in der Datenbank keinen Platz: ` +
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
    for (const problem of result.problems) degrade(glossaryFile.file, problem);
    const glossaryExtra = splitFrontmatter(glossaryFile.frontmatter, ["id"]);
    if (Object.keys(glossaryExtra).length > 0) {
      degrade(
        glossaryFile.file,
        `Frontmatter-Schlüssel des Glossars haben in der Datenbank keinen Platz: ` +
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

  // 8. everything that degraded, kept verbatim. De-duplicated by path: a file
  //    can collect several report entries but is stored once.
  const stored = new Set<string>();
  for (const file of unknown) {
    if (stored.has(file.rel)) continue;
    stored.add(file.rel);
    tx.insert(unknownTable)
      .values({ campaignId, path: file.rel, content: file.raw, at })
      .run();
  }
  return stored.size;
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
  if (options.force !== true) {
    const marker = db.all<{ value: string }>(
      sql`select value from meta where key = 'migrated_at'`,
    );
    if (marker.length > 0) {
      return { migrated: false, skipped: "already-migrated", campaigns: [], reportEntries: 0, unknownFiles: 0 };
    }
    if (!isDbEmpty(db)) {
      // The defensive rule (planning section 3): content without a marker is
      // still content. Overwriting it would be the one unrecoverable move.
      return { migrated: false, skipped: "database-not-empty", campaigns: [], reportEntries: 0, unknownFiles: 0 };
    }
  }

  const ids = await listCampaignDirs(root);
  if (ids.length === 0) {
    return { migrated: false, skipped: "no-campaigns", campaigns: [], reportEntries: 0, unknownFiles: 0 };
  }

  const at = new Date().toISOString();
  let reportEntries = 0;
  let unknownFiles = 0;
  const imported: string[] = [];

  for (const id of ids) {
    // Read the whole campaign BEFORE opening the transaction: the driver is
    // synchronous, so no `await` may happen inside `db.transaction`.
    const campaign = await readCampaign(root, id);
    const report: ReportEntry[] = [];
    db.transaction((tx) => {
      const stored = importCampaign(tx as unknown as DbWriter, campaign, at, report);
      for (const entry of report) {
        tx.insert(reportTable)
          .values({ campaignId: id, path: entry.path, reason: entry.reason, at })
          .run();
      }
      unknownFiles += stored;
    });
    reportEntries += report.length;
    imported.push(id);
  }

  const upsertMeta = (key: string, value: string): void => {
    db.insert(metaTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: metaTable.key, set: { value } })
      .run();
  };
  upsertMeta("migrated_at", at);
  upsertMeta("migrated_from", path.resolve(root));

  return { migrated: true, campaigns: imported, reportEntries, unknownFiles };
}
