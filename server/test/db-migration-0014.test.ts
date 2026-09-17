// What migration 0014 does to the data it finds — the one-time step that
// adds the reference constraints.
//
// WHAT IS PINNED HERE AND WHAT IS NOT: the constraints themselves are a
// schema declaration, and a test that re-asserts them would only repeat it —
// every schema change would then be a test change too. The API half of that
// behaviour (a reference that names nothing is refused, a scene needs a
// chapter) is asserted where the DM
// meets it, in test/reference-integrity.test.ts. What IS pinned is the
// CONTENT of the migration: a released migration never changes again, so
// what it does to a DM's rows is a promise, and these cases are what caught
// it deleting `scene_npcs` and `scene_tags` in silence.
//
// Two subjects, and they are separate on purpose:
//
//   1. THE REBUILD. SQLite cannot add a constraint to an existing table, so
//      the migration rebuilds seven tables — and the migrator runs inside a
//      transaction, where `PRAGMA foreign_keys` is ignored. Dropping the old
//      `scenes` therefore deletes every `scene_npcs` and `scene_tags` row
//      through their cascade. The migration sets those rows aside first;
//      these cases are what says so, and they fail if it stops doing it.
//      The relation notes belong to the same subject: they only ever existed
//      as rows, so the migration writes them into the npc's own text before
//      the table goes.
//   2. THE PRE-FLIGHT that runs before all of it — TypeScript, not SQL: data
//      that cannot satisfy the constraints, or a relations heading the
//      write-back cannot place, aborts the start, with the offending values
//      in the report and nothing migrated.
//
// The old-schema database is built BY HAND, like the other pre-migration
// step's test next to this one: that is what keeps the case honest about
// running against a schema the current one no longer has.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS_DIR, openDb } from "../src/db/client";
import { openSqlite, type SqliteClient } from "../src/db/driver";
import {
  assertMigrationReady,
  findReferenceProblems,
  findRelationHeadingProblems,
  referenceProblemReport,
  relationHeadingReport,
} from "../src/db/reference-preflight";

// --- the rebuild ------------------------------------------------------------

/** The schema as it stood before the constraints, for the tables they touch. */
async function preConstraintDb(): Promise<SqliteClient> {
  const client = await openSqlite(":memory:");
  client.exec("PRAGMA foreign_keys = ON");
  client.exec(`
    create table campaigns (id text primary key, name text not null default '');
    create table chapters (
      campaign_id text not null, id text not null, title text not null default '',
      status text, body text not null default '', extra text not null default '{}',
      pos integer not null default 0, rev integer not null default 1,
      primary key (campaign_id, id),
      foreign key (campaign_id) references campaigns(id) on update cascade on delete cascade
    );
    create table locations (
      campaign_id text not null, id text not null, name text not null default '',
      chapter_id text, roll20_page text, body text not null default '',
      extra text not null default '{}', rev integer not null default 1,
      primary key (campaign_id, id),
      foreign key (campaign_id) references campaigns(id) on update cascade on delete cascade
    );
    create table npcs (
      campaign_id text not null, id text not null, name text not null default '',
      role text, chapter_id text, status text not null default 'unknown', statblock text,
      quickstats text not null default '{}', voice text, appearance text,
      body text not null default '', extra text not null default '{}',
      rev integer not null default 1,
      primary key (campaign_id, id),
      foreign key (campaign_id) references campaigns(id) on update cascade on delete cascade
    );
    create table npc_relations (
      campaign_id text not null, npc_id text not null, other_npc_id text not null,
      note text not null default '', pos integer not null,
      primary key (campaign_id, npc_id, other_npc_id),
      foreign key (campaign_id, npc_id) references npcs(campaign_id, id)
        on update cascade on delete cascade
    );
    create table scenes (
      campaign_id text not null, id text not null, chapter_id text,
      title text not null default '', type text not null default 'planned', trigger text,
      location text, status text not null default 'draft', handouts text not null default '[]',
      body text not null default '', extra text not null default '{}',
      pos integer not null default 0, rev integer not null default 1,
      primary key (campaign_id, id),
      foreign key (campaign_id) references campaigns(id) on update cascade on delete cascade
    );
    create table scene_npcs (
      campaign_id text not null, scene_id text not null, npc_id text not null,
      pos integer not null,
      primary key (campaign_id, scene_id, npc_id),
      foreign key (campaign_id, scene_id) references scenes(campaign_id, id)
        on update cascade on delete cascade
    );
    create table scene_tags (
      campaign_id text not null, scene_id text not null, tag text not null,
      pos integer not null,
      primary key (campaign_id, scene_id, tag),
      foreign key (campaign_id, scene_id) references scenes(campaign_id, id)
        on update cascade on delete cascade
    );
    create table sessions (
      campaign_id text not null, id text not null, started text, ended text,
      body text not null default '', extra text not null default '{}',
      rev integer not null default 1, created_at integer not null default 0,
      primary key (campaign_id, id),
      foreign key (campaign_id) references campaigns(id) on update cascade on delete cascade
    );
    create table log_entries (
      campaign_id text not null, session_id text not null, pos integer not null,
      raw text not null, at text, scene_id text, text text,
      hash text not null default '', reviewed integer not null default 0,
      primary key (campaign_id, session_id, pos),
      foreign key (campaign_id, session_id) references sessions(campaign_id, id)
        on update cascade on delete cascade
    );
    create table session_scenes_played (
      campaign_id text not null, session_id text not null, scene_id text not null,
      pos integer not null,
      primary key (campaign_id, session_id, pos),
      foreign key (campaign_id, session_id) references sessions(campaign_id, id)
        on update cascade on delete cascade
    );
  `);
  return client;
}

/** One campaign whose references all resolve — the case that migrates. */
function seedResolvable(client: SqliteClient): void {
  client.exec(`
    insert into campaigns (id, name) values ('beispiel', 'Beispiel');
    insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01', 'Kapitel', 0);
    insert into locations (campaign_id, id, name, chapter_id) values ('beispiel', 'hafen', 'Hafen', '01');
    insert into npcs (campaign_id, id, name, chapter_id) values ('beispiel', 'jorna', 'Jorna', '01');
    insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos)
      values ('beispiel', 'jorna', 'fenn', 'kennt ihn', 0);
    insert into scenes (campaign_id, id, chapter_id, location, title, pos)
      values ('beispiel', 'ankunft', '01', 'hafen', 'Ankunft', 0);
    insert into scene_npcs (campaign_id, scene_id, npc_id, pos) values ('beispiel', 'ankunft', 'jorna', 0);
    insert into scene_tags (campaign_id, scene_id, tag, pos) values ('beispiel', 'ankunft', 'social', 0);
    insert into sessions (campaign_id, id, started) values ('beispiel', 's1', '2026-01-15T19:30');
    insert into log_entries (campaign_id, session_id, pos, raw, at, scene_id, text, hash)
      values ('beispiel', 's1', 0, '- 19:52 (ankunft) Spuren', '19:52', 'ankunft', 'Spuren', 'abc');
    insert into session_scenes_played (campaign_id, session_id, scene_id, pos)
      values ('beispiel', 's1', 'ankunft', 0);
  `);
}

/** Run the committed migration exactly as the migrator does: one transaction. */
function applyConstraintMigration(client: SqliteClient): void {
  const file = path.join(MIGRATIONS_DIR, "0014_reference_constraints.sql");
  const statements = readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  client.transaction(() => {
    for (const statement of statements) client.exec(statement);
  }).immediate();
}

function rows(client: SqliteClient, query: string): Record<string, unknown>[] {
  return client.prepare(query).all();
}

describe("the rebuild keeps every row", () => {
  test("the child rows of a rebuilt table survive the migration", async () => {
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      applyConstraintMigration(client);

      // The rows whose tables were dropped and rebuilt around them.
      expect(rows(client, "select scene_id, npc_id, pos from scene_npcs")).toEqual([
        { scene_id: "ankunft", npc_id: "jorna", pos: 0 },
      ]);
      expect(rows(client, "select scene_id, tag, pos from scene_tags")).toEqual([
        { scene_id: "ankunft", tag: "social", pos: 0 },
      ]);
      expect(rows(client, "select pos, raw, at, scene_id, text, hash from log_entries")).toEqual([
        {
          pos: 0,
          raw: "- 19:52 (ankunft) Spuren",
          at: "19:52",
          scene_id: "ankunft",
          text: "Spuren",
          hash: "abc",
        },
      ]);
      expect(rows(client, "select session_id, scene_id, pos from session_scenes_played")).toEqual([
        { session_id: "s1", scene_id: "ankunft", pos: 0 },
      ]);
      // …and the parents, with their values.
      expect(rows(client, "select id, chapter_id, location, title, pos from scenes")).toEqual([
        { id: "ankunft", chapter_id: "01", location: "hafen", title: "Ankunft", pos: 0 },
      ]);
      expect(rows(client, "select id, name, chapter_id from npcs")).toEqual([
        { id: "jorna", name: "Jorna", chapter_id: "01" },
      ]);
      expect(rows(client, "select id, name, chapter_id from locations")).toEqual([
        { id: "hafen", name: "Hafen", chapter_id: "01" },
      ]);
    } finally {
      client.close();
    }
  });

  test("the constraints are in place afterwards, and nothing is left over", async () => {
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      applyConstraintMigration(client);

      const fks = rows(client, "pragma foreign_key_list(scenes)").map((row) => row.table);
      expect(new Set(fks)).toEqual(new Set(["campaigns", "chapters", "locations"]));
      expect(() =>
        client
          .prepare(
            "insert into scenes (campaign_id, id, chapter_id, title, pos) values ('beispiel', 'x', '99', 'X', 1)",
          )
          .run(),
      ).toThrow(/FOREIGN KEY constraint failed/);

      // A table that was NOT rebuilt still points at the one that was: the
      // parent was dropped and recreated under the same name, and that is
      // what the rebuild has to leave intact.
      expect(() =>
        client
          .prepare(
            "insert into scene_tags (campaign_id, scene_id, tag, pos) values ('beispiel', 'weg', 'social', 1)",
          )
          .run(),
      ).toThrow(/FOREIGN KEY constraint failed/);

      // The relations table is gone, and so are the migration's own tables.
      const tables = rows(
        client,
        "select name from sqlite_master where type = 'table' order by name",
      ).map((row) => row.name as string);
      expect(tables).not.toContain("npc_relations");
      expect(tables.filter((name) => name.startsWith("__"))).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("dropping a rebuilt parent inside a transaction takes its child rows", async () => {
    // The reason the migration puts the rows aside: `PRAGMA foreign_keys` is
    // ignored inside a transaction, so the implicit delete of a DROP TABLE
    // fires the children's cascade. Without the backup tables the two cases
    // above would come back empty.
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      client.transaction(() => {
        client.exec("PRAGMA foreign_keys = OFF");
        client.exec("DROP TABLE scenes");
      }).immediate();
      expect(rows(client, "select scene_id from scene_npcs")).toEqual([]);
      expect(rows(client, "select scene_id from scene_tags")).toEqual([]);
    } finally {
      client.close();
    }
  });
});

// --- the relation notes ------------------------------------------------------

describe("the relation notes survive the table", () => {
  /**
   * `## Beziehungen` only ever existed as ROWS: the importer took the lines
   * out of the npc's text and the read path rendered them back, so dropping
   * the table without writing the section into the text would delete the
   * DM's notes. The migration writes it first — and these are the strings
   * the reader produced for the same rows, character for character: the
   * heading, a blank line, one `- <id>: <note>` line per row in `pos` order,
   * an empty note as `- <id>:`.
   */
  const withRelations = (client: SqliteClient): void => {
    client.exec(`
      insert into campaigns (id, name) values ('beispiel', 'Beispiel');
      insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01', 'Kapitel', 0);
      insert into npcs (campaign_id, id, name, body) values
        ('beispiel', 'jorna', 'Jorna', '## Will' || char(10) || char(10) || 'Das Leuchtfeuer.' || char(10) || char(10) || '## Notizen' || char(10) || char(10) || '- aus dem Log' || char(10)),
        ('beispiel', 'fenn', 'Fenn', '## Will' || char(10) || char(10) || 'Raus.' || char(10) || char(10) || '## Beziehungen' || char(10) || char(10) || 'eine Zeile, die keine Beziehung war' || char(10)),
        ('beispiel', 'holm', 'Holm', '## Will' || char(10) || char(10) || 'Seine Netze.' || char(10));
      insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos) values
        ('beispiel', 'jorna', 'fenn', 'kennt ihn von früher', 0),
        ('beispiel', 'jorna', 'holm', '', 1),
        ('beispiel', 'jorna', 'metta', 'schuldet ihr [[hafengeld]]', 2),
        ('beispiel', 'fenn', 'jorna', 'alte Bekannte', 0);
    `);
  };

  test("a text without the heading gets the section appended, in pos order", async () => {
    const client = await preConstraintDb();
    try {
      withRelations(client);
      applyConstraintMigration(client);
      const body = (
        rows(client, "select body from npcs where id = 'jorna'")[0] as { body: string }
      ).body;
      expect(body).toBe(
        "## Will\n\nDas Leuchtfeuer.\n\n## Notizen\n\n- aus dem Log\n" +
          "\n## Beziehungen\n\n" +
          "- fenn: kennt ihn von früher\n" +
          "- holm:\n" +
          "- metta: schuldet ihr [[hafengeld]]\n",
      );
    } finally {
      client.close();
    }
  });

  test("a text that already has the heading keeps one, with the prose under it", async () => {
    const client = await preConstraintDb();
    try {
      withRelations(client);
      applyConstraintMigration(client);
      const body = (
        rows(client, "select body from npcs where id = 'fenn'")[0] as { body: string }
      ).body;
      expect(body).toBe(
        "## Will\n\nRaus.\n\n## Beziehungen\n\n" +
          "- jorna: alte Bekannte\n" +
          "\neine Zeile, die keine Beziehung war\n",
      );
      expect(body.split("## Beziehungen").length - 1).toBe(1);
    } finally {
      client.close();
    }
  });

  test("an npc without relations keeps its text byte for byte", async () => {
    const client = await preConstraintDb();
    try {
      withRelations(client);
      applyConstraintMigration(client);
      expect(
        (rows(client, "select body from npcs where id = 'holm'")[0] as { body: string }).body,
      ).toBe("## Will\n\nSeine Netze.\n");
    } finally {
      client.close();
    }
  });
});

/**
 * An npc that carries relation notes plus the heading spelled the way the
 * argument says — the shapes the write-back is asked about.
 */
function withHeading(client: SqliteClient, id: string, heading: string): void {
  client
    .prepare("insert into npcs (campaign_id, id, name, body) values ('beispiel', ?, ?, ?)")
    .run(id, id, `## Will\n\nRaus.\n\n${heading}\n\n- eine Zeile in Prosa\n`);
  client
    .prepare(
      "insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos)" +
        " values ('beispiel', ?, 'metta', 'alte Bekannte', 0)",
    )
    .run(id);
}

describe("a relations heading the write-back cannot place refuses the start", () => {
  // The write-back handles the CANONICAL heading only. Every spelling below
  // was recognised by the deleted reader, so the notes stood under it — and
  // the write-back would append a SECOND section next to it. Refusing is what
  // keeps that from happening quietly; normalising the prose is the DM's call.
  const refused: Array<[string, string]> = [
    ["two spaces", "##  Beziehungen"],
    ["a tab", "##\tBeziehungen"],
    ["a longer word", "## Beziehungenx"],
    ["something after the word", "## Beziehungen (alt)"],
  ];

  for (const [label, heading] of refused) {
    test(`${label} is named by npc id, and nothing is migrated`, async () => {
      const client = await preConstraintDb();
      try {
        client.exec("insert into campaigns (id, name) values ('beispiel', 'Beispiel')");
        withHeading(client, "fenn", heading);
        expect(findRelationHeadingProblems(client)).toEqual([
          { entry: "beispiel/fenn", line: heading },
        ]);
        expect(() => assertMigrationReady(client)).toThrow(/Relation notes cannot be placed/);
        // The refusal ran INSTEAD of the migration: the table is still there
        // and the text is untouched.
        expect(rows(client, "select count(*) as n from npc_relations")[0]).toEqual({ n: 1 });
        expect(
          (rows(client, "select body from npcs where id = 'fenn'")[0] as { body: string }).body,
        ).toContain(heading);
      } finally {
        client.close();
      }
    });
  }

  test("the canonical heading is fine in any case, and so is a text without one", async () => {
    const client = await preConstraintDb();
    try {
      client.exec("insert into campaigns (id, name) values ('beispiel', 'Beispiel')");
      // A THIRD hash is a different heading level; the deleted reader never
      // read it as the section either, so the write-back appends its own —
      // which is exactly what the reader did. No discrepancy, no refusal.
      withHeading(client, "fenn", "## BEZIEHUNGEN  ");
      withHeading(client, "holm", "### Beziehungen");
      expect(findRelationHeadingProblems(client)).toEqual([]);
      expect(() => assertMigrationReady(client)).not.toThrow();
    } finally {
      client.close();
    }
  });

  test("an npc with NO notes is not asked about its headings", async () => {
    // The write-back only touches texts it writes into, so a heading in any
    // other text cannot produce a second section.
    const client = await preConstraintDb();
    try {
      client.exec(`
        insert into campaigns (id, name) values ('beispiel', 'Beispiel');
        insert into npcs (campaign_id, id, name, body) values
          ('beispiel', 'jorna', 'Jorna', '##  Beziehungen' || char(10)),
          ('beispiel', 'fenn', 'Fenn', '## Beziehungen' || char(10));
        insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos)
          values ('beispiel', 'fenn', 'jorna', '', 0);
      `);
      expect(findRelationHeadingProblems(client)).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("a migrated database is not asked either", async () => {
    const { client, close } = await openDb(":memory:");
    try {
      expect(findRelationHeadingProblems(client)).toEqual([]);
    } finally {
      close();
    }
  });

  test("the report names every offending entry and says what to write", () => {
    const report = relationHeadingReport([
      { entry: "beispiel/fenn", line: "##  Beziehungen" },
      { entry: "beispiel/jorna", line: "##\tBeziehungen" },
    ]).join("\n");
    expect(report).toContain("beispiel/fenn");
    expect(report).toContain("beispiel/jorna");
    expect(report).toContain("##  Beziehungen");
    expect(report).toContain("Write the heading as exactly `## Beziehungen`");
    expect(report).toContain("Nothing has been migrated.");
  });
});

// --- the pre-flight ---------------------------------------------------------

describe("the pre-flight in front of the constraints", () => {
  test("a database whose references resolve has nothing to report", async () => {
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      expect(findReferenceProblems(client)).toEqual([]);
      expect(() => assertMigrationReady(client)).not.toThrow();
    } finally {
      client.close();
    }
  });

  test("a migrated database is not asked again", async () => {
    const { client, close } = await openDb(":memory:");
    try {
      expect(findReferenceProblems(client)).toEqual([]);
    } finally {
      close();
    }
  });

  test("every unresolvable reference is named with its values and its count", async () => {
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      // One of each: a scene with no chapter, a chapter that does not exist,
      // a location, an npc in a list, a played scene and a log marker.
      client.exec(`
        insert into scenes (campaign_id, id, chapter_id, location, title, pos)
          values ('beispiel', 'ohne-kapitel', null, null, 'Ohne', 1);
        insert into scenes (campaign_id, id, chapter_id, location, title, pos)
          values ('beispiel', 'fremd', '99-weg', 'nirgendwo', 'Fremd', 2);
        insert into scene_npcs (campaign_id, scene_id, npc_id, pos)
          values ('beispiel', 'ankunft', 'alte-fischerin', 1);
        insert into npcs (campaign_id, id, name, chapter_id)
          values ('beispiel', 'holm', 'Holm', '99-weg');
        insert into locations (campaign_id, id, name, chapter_id)
          values ('beispiel', 'mole', 'Mole', '99-weg');
        insert into log_entries (campaign_id, session_id, pos, raw, scene_id)
          values ('beispiel', 's1', 1, '- 20:00 (weg) x', 'weg');
        insert into session_scenes_played (campaign_id, session_id, scene_id, pos)
          values ('beispiel', 's1', 'weg', 1);
      `);

      const problems = findReferenceProblems(client);
      const at = (table: string, column: string) =>
        problems.find((p) => p.table === table && p.column === column && p.target !== "");
      expect(at("scenes", "chapter_id")).toMatchObject({
        target: "chapters",
        rows: 1,
        values: ["beispiel/99-weg"],
      });
      expect(at("scenes", "location")).toMatchObject({
        target: "locations",
        values: ["beispiel/nirgendwo"],
      });
      expect(at("scene_npcs", "npc_id")).toMatchObject({
        target: "npcs",
        values: ["beispiel/alte-fischerin"],
      });
      expect(at("npcs", "chapter_id")).toMatchObject({ target: "chapters", rows: 1 });
      expect(at("locations", "chapter_id")).toMatchObject({ target: "chapters", rows: 1 });
      expect(at("log_entries", "scene_id")).toMatchObject({
        target: "scenes",
        values: ["beispiel/weg"],
      });
      expect(at("session_scenes_played", "scene_id")).toMatchObject({
        target: "scenes",
        values: ["beispiel/weg"],
      });
      // The scene that names no chapter at all is its own line.
      expect(problems).toContainEqual({
        table: "scenes",
        column: "chapter_id",
        target: "",
        rows: 1,
        values: [],
      });

      // The report says where the data is wrong and what has to happen.
      const report = referenceProblemReport(problems).join("\n");
      expect(report).toContain("scenes.location -> locations");
      expect(report).toContain("beispiel/nirgendwo");
      expect(report).toContain("1 entry names something that does not exist");
      expect(report).toContain("1 entry names nothing at all, and the reference is mandatory");
      expect(report).toContain("Correct this data in the previous version of the app");
      expect(report).toContain("Nothing has been migrated.");

      // And the start is aborted.
      expect(() => assertMigrationReady(client)).toThrow(/Reference check failed/);
    } finally {
      client.close();
    }
  });

  test("a reference into ANOTHER campaign names nothing", async () => {
    // `campaign_id` is part of every reference, so a chapter that exists in
    // one campaign is no chapter for a scene in another — the foreign keys
    // rule cross-campaign references out, and the pre-flight says so first.
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      client.exec(`
        insert into campaigns (id, name) values ('zweite', 'Zweite');
        insert into chapters (campaign_id, id, title, pos) values ('zweite', '77-fremd', 'Fremd', 0);
        insert into scenes (campaign_id, id, chapter_id, title, pos)
          values ('beispiel', 'geliehen', '77-fremd', 'Geliehen', 3);
      `);
      const problem = findReferenceProblems(client).find(
        (p) => p.table === "scenes" && p.column === "chapter_id" && p.target === "chapters",
      );
      expect(problem).toMatchObject({ rows: 1, values: ["beispiel/77-fremd"] });
    } finally {
      client.close();
    }
  });

  test("a mandatory value that is BLANK is reported as such, not as a bare slash", async () => {
    // An empty string is not null, so it is not „names nothing at all" — it
    // names an entry whose id is "", and the report has to show that as
    // something a reader can see.
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      client.exec(
        "insert into scenes (campaign_id, id, chapter_id, title, pos)" +
          " values ('beispiel', 'leer', '', 'Leer', 4)",
      );
      const problems = findReferenceProblems(client);
      expect(
        problems.find((p) => p.table === "scenes" && p.column === "chapter_id" && p.target !== ""),
      ).toMatchObject({ values: ["beispiel/(leer)"] });
      expect(referenceProblemReport(problems).join("\n")).toContain("beispiel/(leer)");
    } finally {
      client.close();
    }
  });

  test("the check reads only — it writes nothing, not even on a failure", async () => {
    // „Nothing has been migrated" is a promise about the data, so the check
    // that prints it must not touch a row itself.
    const client = await preConstraintDb();
    try {
      seedResolvable(client);
      client.exec(`
        insert into scenes (campaign_id, id, chapter_id, location, title, pos)
          values ('beispiel', 'fremd', '99-weg', 'nirgendwo', 'Fremd', 2);
        insert into npcs (campaign_id, id, name, body) values
          ('beispiel', 'metta', 'Metta', '##  Beziehungen' || char(10));
        insert into npc_relations (campaign_id, npc_id, other_npc_id, note, pos)
          values ('beispiel', 'metta', 'jorna', 'kennt sie', 0);
      `);
      const snapshot = (): string =>
        JSON.stringify([
          rows(client, "select * from scenes order by id"),
          rows(client, "select * from npcs order by id"),
          rows(client, "select * from npc_relations order by npc_id, other_npc_id"),
          rows(client, "select * from chapters order by id"),
          rows(client, "select name from sqlite_master where type = 'table' order by name"),
        ]);
      const before = snapshot();
      expect(() => assertMigrationReady(client)).toThrow();
      expect(snapshot()).toBe(before);
    } finally {
      client.close();
    }
  });

  test("many offending values are listed up to a cap and then counted", () => {
    const values = Array.from({ length: 25 }, (_, i) => `beispiel/weg-${String(i).padStart(2, "0")}`);
    const report = referenceProblemReport([
      { table: "scenes", column: "location", target: "locations", rows: 25, values },
    ]).join("\n");
    expect(report).toContain("beispiel/weg-00");
    expect(report).toContain("and 5 more");
    expect(report).not.toContain("beispiel/weg-24");
  });
});
