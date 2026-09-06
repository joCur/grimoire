// The one-time markdown -> SQLite migration (issue #54, AK1–AK4).
//
// AK1 is asserted against the REAL example campaign (CLAUDE.md: develop
// against real data, no invented mock objects) — a temp COPY of it, because
// examples/ is the committed format reference and the migration must be
// provably able to run without touching it.
//
// AK2's broken fixtures are written into a scratch campaign inside the temp
// root instead of being committed to examples/: examples/ is the format
// CONTRACT, and a file with deliberately broken YAML in it would be a lie
// about the contract.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { openDb, type OpenDb } from "../src/db/client";
import { campaignMarkerKey, runInitialMigration } from "../src/db/migrate-campaigns";
import {
  campaigns,
  chapters,
  glossary,
  inboxEntries,
  locations,
  logEntries,
  meta,
  migrationReport,
  npcRelations,
  npcs,
  sceneNpcs,
  sceneTags,
  scenes,
  sessionPauses,
  sessionScenesPlayed,
  sessions,
  unknownFiles,
  unpackJson,
  unpackStringArray,
} from "../src/db/schema";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

let tmpRoot = "";
let open: OpenDb | undefined;

/** A fresh in-memory database with the schema applied. */
async function freshDb(): Promise<OpenDb> {
  open = await openDb(":memory:");
  return open;
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "grimoire-migration-"));
  await cp(EXAMPLES, tmpRoot, { recursive: true });
});

afterEach(async () => {
  open?.close();
  open = undefined;
  await rm(tmpRoot, { recursive: true, force: true });
});

// --- AK4: the file tree is never touched -----------------------------------

/**
 * A content hash of a whole directory tree: every file's relative path, its
 * size and its bytes, in sorted order. Two trees with the same digest are
 * byte-identical in structure AND content — which is exactly the promise
 * "CAMPAIGN_ROOT bleibt unangetastet" (AK4).
 */
async function hashTree(root: string): Promise<string> {
  const digest = createHash("sha256");
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        digest.update(`D:${relPath}\n`);
        await walk(abs, relPath);
        continue;
      }
      const bytes = await readFile(abs);
      digest.update(`F:${relPath}:${bytes.length}:`);
      digest.update(bytes);
      digest.update("\n");
    }
  };
  await walk(root, "");
  return digest.digest("hex");
}

// --- AK1: a complete, clean import of the example campaign -------------------

describe("AK1 — examples/beispiel imports completely and cleanly", () => {
  test("every table gets the rows the files describe, and the report is empty", async () => {
    const { db } = await freshDb();
    const outcome = await runInitialMigration(db, tmpRoot);

    expect(outcome.migrated).toBe(true);
    expect(outcome.campaigns).toEqual(["beispiel"]);

    // The headline assertion of AK1: a clean import leaves NOTHING to report
    // and nothing in the verbatim bucket.
    expect(db.select().from(migrationReport).all()).toEqual([]);
    expect(db.select().from(unknownFiles).all()).toEqual([]);
    expect(outcome.reportEntries).toBe(0);
    expect(outcome.unknownFiles).toBe(0);

    // campaign — name/description from _campaign.md, body preserved.
    const campaign = db.select().from(campaigns).all();
    expect(campaign).toHaveLength(1);
    expect(campaign[0]?.id).toBe("beispiel");
    expect(campaign[0]?.name).toBe("Der Leuchtturm von Salzhafen");
    expect(campaign[0]?.description).toContain("Küstenkampagne");
    expect(campaign[0]?.body).toContain("bodenständige Küstenfantasy");

    // chapter — from the DIRECTORY, title/status from _chapter.md.
    const chapterRows = db.select().from(chapters).all();
    expect(chapterRows).toHaveLength(1);
    expect(chapterRows[0]?.id).toBe("01-salzhafen");
    expect(chapterRows[0]?.title).toBe("Kapitel 1: Der Leuchtturm von Salzhafen");
    expect(chapterRows[0]?.status).toBe("active");
    expect(chapterRows[0]?.body).toContain("Offene Fäden");

    // scenes — contract fields as columns, the location-slug folder as the
    // display grouping, handouts as an ordered JSON list.
    const sceneRows = db.select().from(scenes).all();
    expect(sceneRows.map((s) => s.id).sort()).toEqual(["lighthouse-arrival", "smuggler-captured"]);
    const arrival = sceneRows.find((s) => s.id === "lighthouse-arrival");
    expect(arrival?.chapterId).toBe("01-salzhafen");
    expect(arrival?.groupSlug).toBe("hafen");
    expect(arrival?.title).toBe("Ankunft am Leuchtturm");
    expect(arrival?.type).toBe("planned");
    expect(arrival?.status).toBe("ready");
    expect(arrival?.location).toBe("leuchtturm");
    expect(unpackStringArray(arrival?.handouts)).toEqual(["Karte von Salzhafen"]);
    expect(arrival?.body).toContain("[!readaloud]");

    const contingency = sceneRows.find((s) => s.id === "smuggler-captured");
    expect(contingency?.type).toBe("contingency");
    expect(contingency?.trigger).toContain("Auskundschaften der Bucht");

    // scene_npcs / scene_tags — ORDER is authored information.
    expect(
      db
        .select()
        .from(sceneNpcs)
        .where(eq(sceneNpcs.sceneId, "lighthouse-arrival"))
        .all()
        .sort((a, b) => a.pos - b.pos)
        .map((r) => [r.npcId, r.pos]),
    ).toEqual([["jorna", 0]]);
    expect(
      db
        .select()
        .from(sceneTags)
        .where(eq(sceneTags.sceneId, "lighthouse-arrival"))
        .all()
        .sort((a, b) => a.pos - b.pos)
        .map((r) => r.tag),
    ).toEqual(["social", "travel"]);

    // npcs — every contract field, and `## Beziehungen` decomposed into rows
    // AND removed from the body (it is rendered from the rows now).
    const jorna = db.select().from(npcs).where(eq(npcs.id, "jorna")).all()[0];
    expect(jorna?.name).toBe("Hafenmeisterin Jorna");
    expect(jorna?.role).toContain("Hafenmeisterin von Salzhafen");
    expect(jorna?.status).toBe("alive");
    expect(jorna?.statblock).toBe("Roll20: Jorna");
    expect(jorna?.voice).toBe("knapp, wetterrau, duzt jeden");
    expect(jorna?.chapterId).toBe("01-salzhafen");
    expect(Object.keys(unpackJson(jorna?.quickstats))).toContain("insight");
    expect(jorna?.body).toContain("## Weiß");
    expect(jorna?.body).not.toContain("## Beziehungen");

    const relations = db
      .select()
      .from(npcRelations)
      .where(eq(npcRelations.npcId, "jorna"))
      .all();
    expect(relations).toHaveLength(1);
    expect(relations[0]?.otherNpcId).toBe("fenn");
    expect(relations[0]?.note).toBe("kennt ihn von früher — er fuhr einst ehrlich zur See");
    expect(relations[0]?.pos).toBe(0);

    // locations — including the hyphenated properties key.
    const leuchtturm = db.select().from(locations).all()[0];
    expect(leuchtturm?.id).toBe("leuchtturm");
    expect(leuchtturm?.roll20Page).toBe("Leuchtturm");
    expect(leuchtturm?.body).toContain("[!readaloud]");

    // session — zone-less strings kept verbatim, `## Log` gone from the body.
    const session = db.select().from(sessions).all()[0];
    expect(session?.id).toBe("2026-01-15");
    expect(session?.started).toBe("2026-01-15T19:30");
    expect(session?.ended).toBe("2026-01-15T22:45");
    expect(session?.body).toContain("## Threads");
    expect(session?.body).not.toContain("## Log");

    // log lines — parsed fields plus the raw line, in file order.
    const log = db
      .select()
      .from(logEntries)
      .all()
      .sort((a, b) => a.pos - b.pos);
    expect(log).toHaveLength(4);
    expect(log[0]?.at).toBe("19:52");
    expect(log[0]?.sceneId).toBe("lighthouse-arrival");
    expect(log[0]?.text).toContain("Spuren gefunden");
    expect(log[0]?.hash).toMatch(/^[0-9a-f]{8}$/);
    // A scene-less pause line keeps its time but has no scene context.
    expect(log[1]?.at).toBe("20:30");
    expect(log[1]?.sceneId).toBeNull();
    expect(log[1]?.text).toBe("— Pause");
    // Nothing was reviewed in the example file.
    expect(log.every((l) => l.reviewed === 0)).toBe(true);

    expect(
      db
        .select()
        .from(sessionScenesPlayed)
        .all()
        .map((r) => r.sceneId),
    ).toEqual(["lighthouse-arrival"]);

    // inbox — the idea line parsed, the `## Eingang` heading kept in place.
    const inbox = db
      .select()
      .from(inboxEntries)
      .all()
      .sort((a, b) => a.pos - b.pos);
    expect(inbox.map((e) => e.raw)).toEqual([
      "## Eingang",
      "- 2026-01-10 Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug #thread",
    ]);
    expect(inbox[0]?.text).toBeNull(); // structure, not an idea
    expect(inbox[1]?.text).toContain("Dorfschmied");
    expect(inbox[1]?.done).toBe(0);

    // glossary — term/explanation rows, arrow AND heading-section forms.
    const terms = db
      .select()
      .from(glossary)
      .all()
      .sort((a, b) => a.pos - b.pos);
    expect(terms.map((t) => t.term)).toEqual([
      "lighthouse keeper",
      "smugglers' cove",
      "read-aloud",
      "long rest / short rest",
      "Übersetzungs-Glossar",
      "Stil",
    ]);
    expect(terms[0]?.explanation).toBe("Leuchtturmwärter");
    expect(terms.find((t) => t.term === "Stil")?.explanation).toContain("bleiben Englisch");

    // meta — the marker and its provenance.
    const metaRows = Object.fromEntries(
      db
        .select()
        .from(meta)
        .all()
        .map((r) => [r.key, r.value]),
    );
    expect(metaRows.migrated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(metaRows.migrated_from).toBe(path.resolve(tmpRoot));
  });

  test("the entities land in the search index", async () => {
    const { db } = await freshDb();
    await runInitialMigration(db, tmpRoot);
    // The store layer maintains the FTS index explicitly; the migration is
    // its first writer. Reference queries from the planning.
    const hit = (q: string) =>
      db
        .all<{ entity_id: string; kind: string }>(
          sql`select entity_id, kind from search_fts where search_fts match ${q}
              order by bm25(search_fts, 10, 6, 4, 1)`,
        )
        .map((r) => r.entity_id);
    expect(hit("jorna")).toContain("jorna");

    // Prefix search reaches every entity kind that mentions the lighthouse.
    const leucht = hit("leucht*");
    expect(leucht).toContain("leuchtturm"); // the location
    expect(leucht).toContain("01-salzhafen"); // the chapter, via its title
    expect(leucht).toContain("jorna"); // the npc, via its body only
    // bm25 with the schema's weights ranks TITLE hits above a body-only one.
    expect(leucht.indexOf("leuchtturm")).toBeLessThan(leucht.indexOf("jorna"));

    // Glossary entries are indexed too (planning section 2).
    expect(hit("Leuchtturmwärter")).toContain("lighthouse keeper");
    // Tag search, and the diacritics folding the tokenizer was chosen for.
    expect(hit("travel")).toContain("lighthouse-arrival");
    expect(hit("kustenfantasy")).toContain("beispiel");
  });
});

// --- AK2: broken fixtures degrade, nothing is lost, nothing aborts ----------

describe("AK2 — broken fixtures degrade with a report", () => {
  const BROKEN_YAML = `---
id: kaputt
title: [unclosed
---

## Flow

Diese Szene hat kaputtes YAML.
`;

  const NO_FRONTMATTER = `# Einfach nur Text

Kein Properties, keine id — trotzdem darf nichts verloren gehen.
`;

  const COLLIDING = `---
id: lighthouse-arrival
title: Zweite Szene mit derselben id
---

Kollision.
`;

  const BROKEN_SESSION = `---
id: 2026-02-01
started: 2026-02-01T19:00
pauses:
  - from: 2026-02-01T20:00
    to: 2026-02-01T20:10
  - from: kaputt
    to: 2026-02-01T21:00
  - from: 2026-02-01T21:30
    to: ebenfalls-kaputt
reviewed: [deadbeef]
---

## Log

- 19:30 (lighthouse-arrival) Eine ganz normale Zeile
Diese Zeile ist keine Log-Zeile.

## Threads

- [ ] bleibt erhalten
`;

  const BROKEN_GLOSSARY = `---
id: glossary
---

Freitext ganz oben, der zu keinem Begriff gehört.

# Glossar

- ship → Schiff
- ship → Boot
`;

  beforeEach(async () => {
    const broken = path.join(tmpRoot, "kaputt");
    await mkdir(path.join(broken, "01-kapitel", "ort"), { recursive: true });
    await mkdir(path.join(broken, "npcs", "alt"), { recursive: true });
    await mkdir(path.join(broken, "sessions"), { recursive: true });
    await writeFile(path.join(broken, "01-kapitel", "ort", "kaputt.md"), BROKEN_YAML, "utf8");
    await writeFile(path.join(broken, "01-kapitel", "ort", "nackt.md"), NO_FRONTMATTER, "utf8");
    // The colliding scene sorts AFTER the original, so the original wins.
    await cp(
      path.join(tmpRoot, "beispiel", "01-salzhafen", "hafen", "ankunft-leuchtturm.md"),
      path.join(broken, "01-kapitel", "aaa-original.md"),
    );
    await writeFile(path.join(broken, "01-kapitel", "zzz-kollision.md"), COLLIDING, "utf8");
    await writeFile(path.join(broken, "sessions", "2026-02-01.md"), BROKEN_SESSION, "utf8");
    await writeFile(path.join(broken, "glossary.md"), BROKEN_GLOSSARY, "utf8");
    // An unknown file type and a file in a place the format does not describe.
    await writeFile(path.join(broken, "notizen.txt"), "lose Notizen", "utf8");
    await writeFile(path.join(broken, "npcs", "alt", "fenn.md"), "---\nid: fenn\n---\nalt", "utf8");
  });

  test("the import completes and reports every degradation", async () => {
    const { db } = await freshDb();
    const outcome = await runInitialMigration(db, tmpRoot);

    // No abort: BOTH campaigns are in, the good one still clean.
    expect(outcome.migrated).toBe(true);
    expect(outcome.campaigns).toEqual(["beispiel", "kaputt"]);
    expect(
      db.select().from(migrationReport).where(eq(migrationReport.campaignId, "beispiel")).all(),
    ).toEqual([]);

    const report = db
      .select()
      .from(migrationReport)
      .where(eq(migrationReport.campaignId, "kaputt"))
      .all();
    const reasonFor = (rel: string) =>
      report.filter((r) => r.path === rel).map((r) => r.reason);

    // 1. broken YAML -> unknown_files, verbatim.
    expect(reasonFor("01-kapitel/ort/kaputt.md").join(" ")).toContain("kaputtes YAML");
    // 2. missing properties -> unknown_files, verbatim.
    expect(reasonFor("01-kapitel/ort/nackt.md").join(" ")).toContain("ohne Eigenschaften-Block");
    // 3. id collision -> the first file wins.
    expect(reasonFor("01-kapitel/zzz-kollision.md").join(" ")).toContain("doppelt");
    // 4. broken pauses -> dropped, but reported.
    expect(reasonFor("sessions/2026-02-01.md").join(" ")).toContain("Pausen-Eintrag");
    // 5. a foreign log line -> kept as raw, reported.
    expect(reasonFor("sessions/2026-02-01.md").join(" ")).toContain("Log-Zeile ohne erkennbares");
    // 6. an orphaned `reviewed` hash -> discarded, reported.
    expect(reasonFor("sessions/2026-02-01.md").join(" ")).toContain("reviewed");
    // 7. unassignable glossary text + duplicate term.
    expect(reasonFor("glossary.md").join(" ")).toContain("vor der ersten Überschrift");
    expect(reasonFor("glossary.md").join(" ")).toContain("mehrfach");
    // 8. unknown file type and a path the format does not describe.
    expect(reasonFor("notizen.txt").join(" ")).toContain("Keine Markdown-Datei");
    expect(reasonFor("npcs/alt/fenn.md").join(" ")).toContain("Unterordner");

    // NOTHING IS LOST: every degraded file is in unknown_files byte for byte.
    const stored = new Map(
      db
        .select()
        .from(unknownFiles)
        .where(eq(unknownFiles.campaignId, "kaputt"))
        .all()
        .map((r) => [r.path, r.content]),
    );
    for (const [rel, expected] of [
      ["01-kapitel/ort/kaputt.md", BROKEN_YAML],
      ["01-kapitel/ort/nackt.md", NO_FRONTMATTER],
      ["01-kapitel/zzz-kollision.md", COLLIDING],
      ["sessions/2026-02-01.md", BROKEN_SESSION],
      ["glossary.md", BROKEN_GLOSSARY],
      ["notizen.txt", "lose Notizen"],
      ["npcs/alt/fenn.md", "---\nid: fenn\n---\nalt"],
    ] as const) {
      expect(stored.get(rel)).toBe(expected);
    }

    // The first file wins the id collision — content proves which one.
    const winner = db
      .select()
      .from(scenes)
      .where(and(eq(scenes.campaignId, "kaputt"), eq(scenes.id, "lighthouse-arrival")))
      .all()[0];
    expect(winner?.title).toBe("Ankunft am Leuchtturm");

    // The usable parts of the broken session came through anyway.
    const pauses = db
      .select()
      .from(sessionPauses)
      .where(eq(sessionPauses.campaignId, "kaputt"))
      .all();
    expect(pauses).toHaveLength(1);
    expect(pauses[0]?.fromTs).toBe("2026-02-01T20:00");
    expect(pauses[0]?.toTs).toBe("2026-02-01T20:10");

    const log = db
      .select()
      .from(logEntries)
      .where(eq(logEntries.campaignId, "kaputt"))
      .all()
      .sort((a, b) => a.pos - b.pos);
    expect(log).toHaveLength(2);
    expect(log[0]?.text).toContain("ganz normale Zeile");
    // The foreign line keeps its raw text and nothing else.
    expect(log[1]?.raw).toBe("Diese Zeile ist keine Log-Zeile.");
    expect(log[1]?.text).toBeNull();
    expect(log[1]?.at).toBeNull();
    // The rest of the session file survived as its body.
    const session = db
      .select()
      .from(sessions)
      .where(eq(sessions.campaignId, "kaputt"))
      .all()[0];
    expect(session?.body).toContain("bleibt erhalten");

    // The glossary's usable lines came through; the duplicate did not win.
    const terms = db
      .select()
      .from(glossary)
      .where(eq(glossary.campaignId, "kaputt"))
      .all();
    expect(terms.find((t) => t.term === "ship")?.explanation).toBe("Schiff");
  });
});

// --- review follow-ups: the content-loss holes ------------------------------
//
// Every test here is one review finding. They all guard the same rule: the
// migration may degrade and it may report, but it may never lose a line.

describe("no silent content loss", () => {
  /** A scratch campaign with just the files a test needs. */
  async function campaignWith(files: Record<string, string | Uint8Array>): Promise<string> {
    const id = "review";
    const root = path.join(tmpRoot, id);
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content as never);
    }
    return id;
  }

  test("an inbox.md the APP wrote — no properties — is imported, not degraded", async () => {
    // campaign-write.ts `appendInboxEntry` creates exactly this file when a
    // campaign has no inbox yet. Degrading it hid every ingested idea.
    const id = await campaignWith({
      "_campaign.md": "---\nid: review\nname: Review\n---\n",
      "inbox.md": "# Inbox\n\n- eine Idee aus der App #thread\n- [x] schon erledigt\n",
    });
    const { db } = await freshDb();
    await runInitialMigration(db, tmpRoot);

    const rows = db
      .select()
      .from(inboxEntries)
      .where(eq(inboxEntries.campaignId, id))
      .all()
      .sort((a, b) => a.pos - b.pos);
    expect(rows.map((r) => r.raw)).toEqual([
      "# Inbox",
      "- eine Idee aus der App #thread",
      "- [x] schon erledigt",
    ]);
    expect(rows[1]?.text).toBe("eine Idee aus der App #thread");
    expect(rows[2]?.done).toBe(1);
    // And it is NOT a degradation: no report entry, nothing in unknown_files.
    expect(db.select().from(migrationReport).where(eq(migrationReport.campaignId, id)).all()).toEqual(
      [],
    );
    expect(db.select().from(unknownFiles).where(eq(unknownFiles.campaignId, id)).all()).toEqual([]);
  });

  test("a glossary without properties is imported too", async () => {
    const id = await campaignWith({
      "_campaign.md": "---\nid: review\n---\n",
      "glossary.md": "# Glossar\n\n- cove -> Bucht\n",
    });
    const { db } = await freshDb();
    await runInitialMigration(db, tmpRoot);
    expect(
      db.select().from(glossary).where(eq(glossary.campaignId, id)).all().map((t) => t.term),
    ).toContain("cove");
    expect(db.select().from(migrationReport).where(eq(migrationReport.campaignId, id)).all()).toEqual(
      [],
    );
  });

  test("an inbox with a BROKEN properties block still degrades verbatim", async () => {
    const broken = "---\nid: [unclosed\n---\n\n- eine Idee\n";
    const id = await campaignWith({
      "_campaign.md": "---\nid: review\n---\n",
      "inbox.md": broken,
    });
    const { db } = await freshDb();
    await runInitialMigration(db, tmpRoot);
    expect(db.select().from(inboxEntries).where(eq(inboxEntries.campaignId, id)).all()).toEqual([]);
    expect(
      db.select().from(unknownFiles).where(eq(unknownFiles.campaignId, id)).all()[0]?.content,
    ).toBe(broken);
  });

  test("a `### ` subsection under `## Log` survives in the session body", async () => {
    const id = await campaignWith({
      "_campaign.md": "---\nid: review\n---\n",
      "sessions/2026-03-01.md":
        "---\nid: 2026-03-01\nstarted: 2026-03-01T19:00\n---\n\n" +
        "## Log\n\n- 19:00 (a) los\n\n### Nachtrag\n\nDer Wärter log.\n\n## Threads\n\n- [ ] t\n",
    });
    const { db } = await freshDb();
    await runInitialMigration(db, tmpRoot);
    const session = db.select().from(sessions).where(eq(sessions.campaignId, id)).all()[0];
    // The lines that became rows are gone …
    expect(session?.body).not.toContain("19:00");
    // … everything else is still there, including the subsection.
    expect(session?.body).toContain("### Nachtrag");
    expect(session?.body).toContain("Der Wärter log.");
    expect(session?.body).toContain("## Threads");
  });

  test("a second `## Log` section is not deleted along with the first", async () => {
    const id = await campaignWith({
      "_campaign.md": "---\nid: review\n---\n",
      "sessions/2026-03-02.md":
        "---\nid: 2026-03-02\n---\n\n## Log\n\n- 19:00 (a) eins\n\n## Log\n\n- 20:00 (a) zwei\n",
    });
    const { db } = await freshDb();
    await runInitialMigration(db, tmpRoot);
    const log = db.select().from(logEntries).where(eq(logEntries.campaignId, id)).all();
    expect(log.map((l) => l.text)).toEqual(["eins"]);
    const session = db.select().from(sessions).where(eq(sessions.campaignId, id)).all()[0];
    // The second section was never parsed — so it stays readable in the body.
    expect(session?.body).toContain("- 20:00 (a) zwei");
  });

  test("`scenes_played` keeps repetitions and their order", async () => {
    const id = await campaignWith({
      "_campaign.md": "---\nid: review\n---\n",
      "sessions/2026-03-03.md":
        "---\nid: 2026-03-03\nscenes_played: [hafen, leuchtturm, hafen]\n---\n",
    });
    const { db } = await freshDb();
    await runInitialMigration(db, tmpRoot);
    expect(
      db
        .select()
        .from(sessionScenesPlayed)
        .where(eq(sessionScenesPlayed.campaignId, id))
        .all()
        .sort((a, b) => a.pos - b.pos)
        .map((r) => r.sceneId),
    ).toEqual(["hafen", "leuchtturm", "hafen"]);
  });

  test("a `quickstats` that is not a map is kept in extra and reported", async () => {
    const id = await campaignWith({
      "_campaign.md": "---\nid: review\n---\n",
      "npcs/fenn.md": "---\nid: fenn\nname: Fenn\nquickstats: [ac 12, hp 9]\n---\n\nText.\n",
    });
    const { db } = await freshDb();
    await runInitialMigration(db, tmpRoot);
    const fenn = db.select().from(npcs).where(eq(npcs.campaignId, id)).all()[0];
    expect(unpackJson(fenn?.quickstats)).toEqual({});
    // The value itself is not gone — it moved to the extra fields.
    expect(unpackJson(fenn?.extra).quickstats).toEqual(["ac 12", "hp 9"]);
    expect(
      db
        .select()
        .from(migrationReport)
        .where(eq(migrationReport.campaignId, id))
        .all()
        .map((r) => r.reason)
        .join(" "),
    ).toContain("quickstats");
  });

  test("a binary file is stored as BYTES and the report says so", async () => {
    // A png header — not valid UTF-8, so decoding it would mangle it.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);
    const id = await campaignWith({
      "_campaign.md": "---\nid: review\n---\n",
      "karte.png": png,
    });
    const { db } = await freshDb();
    await runInitialMigration(db, tmpRoot);
    const row = db
      .select()
      .from(unknownFiles)
      .where(and(eq(unknownFiles.campaignId, id), eq(unknownFiles.path, "karte.png")))
      .all()[0];
    // The bytes are byte-for-byte what was on disk …
    expect(row?.contentBlob).not.toBeNull();
    expect(Array.from(row?.contentBlob ?? new Uint8Array())).toEqual(Array.from(png));
    // … and no mangled text pretends to be the file.
    expect(row?.content).toBe("");
    const reason = db
      .select()
      .from(migrationReport)
      .where(eq(migrationReport.campaignId, id))
      .all()
      .map((r) => r.reason)
      .join(" ");
    expect(reason).toContain("binär");
    expect(reason).toContain("content_blob");
    // The old claim was a lie and must not come back.
    expect(reason).not.toContain("Inhalt unverändert übernommen");
  });

  test("a UTF-8 text file with non-ASCII characters is still stored as text", async () => {
    const text = "lose Notizen über Salzhäfen — mit Gedankenstrich\n";
    const id = await campaignWith({
      "_campaign.md": "---\nid: review\n---\n",
      "notizen.txt": text,
    });
    const { db } = await freshDb();
    await runInitialMigration(db, tmpRoot);
    const row = db
      .select()
      .from(unknownFiles)
      .where(and(eq(unknownFiles.campaignId, id), eq(unknownFiles.path, "notizen.txt")))
      .all()[0];
    expect(row?.content).toBe(text);
    expect(row?.contentBlob).toBeNull();
  });
});

// --- AK3: idempotency ---------------------------------------------------------

describe("AK3 — a second run does nothing", () => {
  test("the marker makes the second run a no-op", async () => {
    const { db } = await freshDb();
    const first = await runInitialMigration(db, tmpRoot);
    expect(first.migrated).toBe(true);
    const before = db.select().from(scenes).all().length;
    const markerBefore = db.select().from(meta).all().find((r) => r.key === "migrated_at")?.value;

    const second = await runInitialMigration(db, tmpRoot);
    expect(second.migrated).toBe(false);
    expect(second.skipped).toBe("already-migrated");
    // Not one extra row, and the marker still says when the real run happened.
    expect(db.select().from(scenes).all().length).toBe(before);
    expect(db.select().from(campaigns).all().length).toBe(1);
    expect(db.select().from(meta).all().find((r) => r.key === "migrated_at")?.value).toBe(
      markerBefore,
    );
  });

  test("a run interrupted between two campaigns RESUMES instead of dead-ending", async () => {
    // The crash scenario: campaign A is committed (its per-campaign marker
    // with it), the process dies before B, so the global `migrated_at` was
    // never written. Without per-campaign markers the next run would see
    // "content, no marker" and skip forever.
    await mkdir(path.join(tmpRoot, "zweite"), { recursive: true });
    await writeFile(
      path.join(tmpRoot, "zweite", "_campaign.md"),
      "---\nid: zweite\nname: Zweite Kampagne\n---\n",
      "utf8",
    );

    const { db } = await freshDb();
    // Simulate the interrupted run: import "beispiel" only, no global marker.
    const half = await runInitialMigration(db, tmpRoot, { force: true });
    expect(half.migrated).toBe(true);
    db.delete(meta).where(eq(meta.key, "migrated_at")).run();
    db.delete(meta).where(eq(meta.key, campaignMarkerKey("zweite"))).run();
    db.delete(campaigns).where(eq(campaigns.id, "zweite")).run();
    expect(db.select().from(campaigns).all().map((c) => c.id)).toEqual(["beispiel"]);

    const resumed = await runInitialMigration(db, tmpRoot);
    expect(resumed.migrated).toBe(true);
    // Only the missing campaign was imported; the committed one was left alone.
    expect(resumed.campaigns).toEqual(["zweite"]);
    expect(resumed.resumedFrom).toEqual(["beispiel"]);
    expect(db.select().from(campaigns).all().map((c) => c.id).sort()).toEqual([
      "beispiel",
      "zweite",
    ]);
    // Exactly one row per campaign — nothing was imported twice.
    expect(db.select().from(campaigns).all()).toHaveLength(2);
    // And now the run is finished for good.
    const third = await runInitialMigration(db, tmpRoot);
    expect(third.skipped).toBe("already-migrated");
  });

  test("the report is attributable to ONE run — `outcome.runId` is the filter", async () => {
    // The CLI printed the whole cumulative table, so a resumed run presented
    // an earlier run's findings as if they had just happened.
    const first = path.join(tmpRoot, "eins");
    await mkdir(first, { recursive: true });
    await writeFile(path.join(first, "_campaign.md"), "---\nid: eins\n---\n", "utf8");
    await writeFile(path.join(first, "notizen.txt"), "lose Notizen", "utf8");

    const { db } = await freshDb();
    const run1 = await runInitialMigration(db, tmpRoot);
    expect(run1.reportEntries).toBe(1);
    expect(run1.runId).toBeDefined();

    // A second campaign appears and the run is re-opened (the resume path).
    const second = path.join(tmpRoot, "zwei");
    await mkdir(second, { recursive: true });
    await writeFile(path.join(second, "_campaign.md"), "---\nid: zwei\n---\n", "utf8");
    await writeFile(path.join(second, "andere.txt"), "andere Notizen", "utf8");
    db.delete(meta).where(eq(meta.key, "migrated_at")).run();

    const run2 = await runInitialMigration(db, tmpRoot);
    expect(run2.campaigns).toEqual(["zwei"]);
    // A run id, not a timestamp: two runs can share an `at` to the millisecond.
    expect(run2.runId).not.toBe(run1.runId);
    expect(run2.reportEntries).toBe(1);

    // The table is cumulative …
    expect(db.select().from(migrationReport).all()).toHaveLength(2);
    // … but this run's rows are exactly the ones the CLI prints.
    const thisRun = db
      .select()
      .from(migrationReport)
      .where(eq(migrationReport.runId, run2.runId ?? ""))
      .all();
    expect(thisRun.map((r) => r.path)).toEqual(["andere.txt"]);
  });

  test("a non-empty database without a marker is never overwritten", async () => {
    const { db } = await freshDb();
    // Content, but no `migrated_at` — e.g. a database written by an app
    // version before the marker existed, or a restored backup.
    db.insert(campaigns).values({ id: "beispiel", name: "Von Hand angelegt" }).run();

    const outcome = await runInitialMigration(db, tmpRoot);
    expect(outcome.migrated).toBe(false);
    expect(outcome.skipped).toBe("database-not-empty");
    expect(db.select().from(campaigns).all()[0]?.name).toBe("Von Hand angelegt");
    expect(db.select().from(scenes).all()).toEqual([]);
  });

  test("an empty source is not an error", async () => {
    const { db } = await freshDb();
    const empty = await mkdtemp(path.join(os.tmpdir(), "grimoire-empty-"));
    try {
      const outcome = await runInitialMigration(db, empty);
      expect(outcome.migrated).toBe(false);
      expect(outcome.skipped).toBe("no-campaigns");
      // And no marker was written: the next boot must still be able to import.
      expect(db.select().from(meta).all()).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

// --- AK4: CAMPAIGN_ROOT stays byte-identical --------------------------------

describe("AK4 — the file tree is left untouched", () => {
  test("the campaign root is byte-identical before and after the migration", async () => {
    const before = await hashTree(tmpRoot);
    const filesBefore = new Set<string>();
    const collect = async (dir: string, rel: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const next = rel === "" ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) await collect(path.join(dir, e.name), next);
        else filesBefore.add(next);
      }
    };
    await collect(tmpRoot, "");
    const mtimesBefore = new Map<string, number>();
    for (const rel of filesBefore) {
      mtimesBefore.set(rel, (await stat(path.join(tmpRoot, rel))).mtimeMs);
    }

    const { db } = await freshDb();
    const outcome = await runInitialMigration(db, tmpRoot);
    expect(outcome.migrated).toBe(true);

    // Content and structure: identical.
    expect(await hashTree(tmpRoot)).toBe(before);

    // And not even an mtime moved — the importer only ever reads. (A marker
    // file, the thing the PO explicitly ruled out, would show up in the tree
    // hash above; this catches an in-place rewrite of identical bytes.)
    for (const [rel, mtimeMs] of mtimesBefore) {
      expect((await stat(path.join(tmpRoot, rel))).mtimeMs).toBe(mtimeMs);
    }
  });
});
