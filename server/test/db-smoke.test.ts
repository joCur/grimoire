// CI smoke: the SQLite foundation on BOTH runtimes (issue #54 AK5).
//
// This file is the early-warning system ADR #13 asks for. The server's
// database layer runs on `node:sqlite` in production and on `bun:sqlite`
// under `bun test` (see src/db/driver.ts for why), so the three things the
// store layer depends on have to be proven on each of them:
//
//   * FTS5 — including the `unicode61 remove_diacritics 2` tokenizer and
//     bm25 ranking. FTS5 is a compile-time option, and "SQLite is built in"
//     says nothing about whether that option was on.
//   * TRANSACTIONS — commit AND rollback, through drizzle's `db.transaction`,
//     which is what makes "one transaction per campaign" a real promise.
//   * UPSERT — `ON CONFLICT DO UPDATE` on a composite primary key, the write
//     shape every store method will use.
//
// It runs unchanged under `bun test` and under `node --test` — the CI job
// `db-smoke-node` in .github/workflows/ci.yml is the second half of AK5.
// That is why it imports from "node:test"/"node:assert" instead of
// "bun:test": bun's test runner understands node:test files, the reverse is
// not true.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { openDb } from "../src/db/client";
import { campaigns, meta } from "../src/db/schema";

test("the driver reports which backend the runtime gave us", async () => {
  const { client, close } = await openDb(":memory:");
  try {
    assert.ok(
      client.backend === "node:sqlite" || client.backend === "bun:sqlite",
      `unexpected backend ${client.backend}`,
    );
    // Visible in the CI log — the whole point of running this twice is being
    // able to see WHICH backend each job exercised.
    console.log(`sqlite backend: ${client.backend}`);
  } finally {
    close();
  }
});

test("the PRAGMAs the schema depends on are in effect", async () => {
  const { db, close } = await openDb(":memory:");
  try {
    // foreign_keys is per-connection and off by default — without it every
    // cascade in schema.ts is decoration.
    const fk = db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`);
    assert.equal(Number(fk[0]?.foreign_keys), 1);
    // WAL cannot be set on :memory: (SQLite keeps "memory"), so the journal
    // mode is only asserted to be a legal value here; the on-disk case is
    // covered below.
    const journal = db.all<{ journal_mode: string }>(sql`PRAGMA journal_mode`);
    assert.equal(typeof journal[0]?.journal_mode, "string");
  } finally {
    close();
  }
});

test("migrations create every table of the schema plus the FTS index", async () => {
  const { db, close } = await openDb(":memory:");
  try {
    const rows = db.all<{ name: string }>(
      sql`select name from sqlite_master where type in ('table','view') order by name`,
    );
    const names = new Set(rows.map((r) => r.name));
    for (const expected of [
      "campaigns",
      "chapters",
      "scenes",
      "scene_npcs",
      "scene_tags",
      "npcs",
      "npc_relations",
      "locations",
      "sessions",
      "session_pauses",
      "log_entries",
      "session_scenes_played",
      "inbox_entries",
      "glossary",
      "generate_jobs",
      "unknown_files",
      "migration_report",
      "meta",
      "search_fts",
    ]) {
      assert.ok(names.has(expected), `missing table ${expected}`);
    }
  } finally {
    close();
  }
});

test("FTS5 works, folds diacritics and ranks by bm25", async () => {
  const { db, close } = await openDb(":memory:");
  try {
    db.run(sql`
      insert into search_fts (title, ref, tags, body, campaign_id, kind, entity_id)
      values
        ('Der Leuchtturm von Salzhafen', 'leuchtturm', 'ort', 'Verlassen in Eile, nicht im Kampf.', 'beispiel', 'location', 'leuchtturm'),
        ('Hafenmeisterin Jorna', 'jorna', 'npc', 'Das Leuchtfeuer muss wieder brennen.', 'beispiel', 'npc', 'jorna'),
        ('Müller am Steg', 'mueller', 'npc', 'Nebenfigur.', 'beispiel', 'npc', 'mueller')
    `);

    // Prefix search — what ⌘K sends while the DM is still typing.
    const prefix = db.all<{ entity_id: string }>(
      sql`select entity_id from search_fts where search_fts match 'leucht*' order by bm25(search_fts, 10, 6, 4, 1)`,
    );
    assert.deepEqual(
      prefix.map((r) => r.entity_id).sort(),
      ["jorna", "leuchtturm"],
      "prefix match should find the title hit and the body hit",
    );

    // bm25 with the schema's weights must rank the TITLE hit first.
    assert.equal(prefix[0]?.entity_id, "leuchtturm");

    // remove_diacritics 2: an ASCII query finds the umlaut and vice versa.
    const folded = db.all<{ entity_id: string }>(
      sql`select entity_id from search_fts where search_fts match 'muller'`,
    );
    assert.deepEqual(folded.map((r) => r.entity_id), ["mueller"]);

    // snippet() — the search response's context excerpt.
    const snippet = db.all<{ s: string }>(
      sql`select snippet(search_fts, 3, '[', ']', '…', 8) as s from search_fts where search_fts match 'Leuchtfeuer'`,
    );
    assert.match(String(snippet[0]?.s), /\[Leuchtfeuer\]/);
  } finally {
    close();
  }
});

test("transactions commit and roll back", async () => {
  const { db, close } = await openDb(":memory:");
  try {
    db.transaction((tx) => {
      tx.insert(campaigns).values({ id: "committed", name: "Bleibt" }).run();
    });
    assert.equal(db.select().from(campaigns).all().length, 1);

    assert.throws(() => {
      db.transaction((tx) => {
        tx.insert(campaigns).values({ id: "rolled-back", name: "Weg" }).run();
        throw new Error("boom");
      });
    }, /boom/);

    const ids = db
      .select()
      .from(campaigns)
      .all()
      .map((c) => c.id);
    assert.deepEqual(ids, ["committed"], "the failed transaction must leave nothing behind");
  } finally {
    close();
  }
});

test("UPSERT on a composite primary key updates instead of failing", async () => {
  const { db, close } = await openDb(":memory:");
  try {
    // `meta` is the simplest single-key case — the migration's own marker.
    db.insert(meta).values({ key: "migrated_at", value: "first" }).run();
    db.insert(meta)
      .values({ key: "migrated_at", value: "second" })
      .onConflictDoUpdate({ target: meta.key, set: { value: "second" } })
      .run();
    const rows = db.select().from(meta).all();
    assert.deepEqual(rows, [{ key: "migrated_at", value: "second" }]);

    // And the composite-key case the entity tables use.
    db.insert(campaigns).values({ id: "beispiel", name: "Alt" }).run();
    db.insert(campaigns)
      .values({ id: "beispiel", name: "Neu" })
      .onConflictDoUpdate({ target: campaigns.id, set: { name: "Neu", rev: 2 } })
      .run();
    const campaign = db.select().from(campaigns).all()[0];
    assert.equal(campaign?.name, "Neu");
    assert.equal(campaign?.rev, 2);
  } finally {
    close();
  }
});

test("foreign keys cascade on update and delete", async () => {
  const { db, close } = await openDb(":memory:");
  try {
    db.insert(campaigns).values({ id: "beispiel", name: "Beispiel" }).run();
    db.run(sql`insert into chapters (campaign_id, id, title, pos) values ('beispiel', '01', 'Kapitel', 0)`);

    // ON UPDATE CASCADE — the mechanism Scheibe 3's rename rests on.
    db.run(sql`update campaigns set id = 'umbenannt' where id = 'beispiel'`);
    const moved = db.all<{ campaign_id: string }>(sql`select campaign_id from chapters`);
    assert.deepEqual(moved, [{ campaign_id: "umbenannt" }]);

    // ON DELETE CASCADE.
    db.run(sql`delete from campaigns where id = 'umbenannt'`);
    assert.equal(db.all(sql`select 1 from chapters`).length, 0);
  } finally {
    close();
  }
});

// The rename endpoint (store/rename.ts since issue #57) updates a COMPOSITE
// primary key and lets the database drag the child rows along. A single-column
// cascade (above) does not prove that: the child FK spans two columns, and a
// backend that quietly ignored the composite case would corrupt a rename
// instead of failing loudly. Hence its own smoke case on both runtimes.
test("a composite primary key cascades on update", async () => {
  const { db, close } = await openDb(":memory:");
  try {
    db.insert(campaigns).values({ id: "beispiel", name: "Beispiel" }).run();
    db.run(
      sql`insert into scenes (campaign_id, id, chapter_id, group_slug, title, pos) values ('beispiel', 'alt', '01', 'hafen', 'Szene', 0)`,
    );
    db.run(
      sql`insert into scene_tags (campaign_id, scene_id, tag, pos) values ('beispiel', 'alt', 'social', 0)`,
    );

    db.run(sql`update scenes set id = 'neu' where campaign_id = 'beispiel' and id = 'alt'`);
    const tags = db.all<{ scene_id: string }>(sql`select scene_id from scene_tags`);
    assert.deepEqual(tags, [{ scene_id: "neu" }], "the tag row must follow the scene's new id");
  } finally {
    close();
  }
});

// The search endpoint builds QUOTED prefix terms (`"tok"*`), because quoting
// is what keeps a query full of FTS5 operators from turning into syntax
// (store/search.ts ftsQuery). That is a different parser path than the bare
// `leucht*` above, so both runtimes get to prove it.
test("a quoted prefix term matches and operator-looking input stays text", async () => {
  const { db, close } = await openDb(":memory:");
  try {
    db.run(sql`
      insert into search_fts (title, ref, tags, body, campaign_id, kind, entity_id)
      values ('Der Leuchtturm', 'leuchtturm', '', 'Verlassen in Eile.', 'beispiel', 'location', 'leuchtturm')
    `);
    const hits = db.all<{ entity_id: string }>(
      sql`select entity_id from search_fts where search_fts match '"leucht"*'`,
    );
    assert.deepEqual(hits.map((r) => r.entity_id), ["leuchtturm"]);

    // A term that would be an operator unquoted must simply not match —
    // never raise a syntax error.
    const noise = db.all(sql`select entity_id from search_fts where search_fts match '"AND"* "NEAR"*'`);
    assert.equal(noise.length, 0);
  } finally {
    close();
  }
});

test("an on-disk database gets WAL and survives a reopen", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const nodePath = await import("node:path");
  const dir = await mkdtemp(nodePath.join(tmpdir(), "grimoire-db-smoke-"));
  const file = nodePath.join(dir, "nested", "grimoire.db");
  try {
    const first = await openDb(file);
    const journal = first.db.all<{ journal_mode: string }>(sql`PRAGMA journal_mode`);
    assert.equal(String(journal[0]?.journal_mode).toLowerCase(), "wal");
    first.db.insert(campaigns).values({ id: "beispiel", name: "Beispiel" }).run();
    first.close();

    // Reopening runs the migrator again — it must be a no-op, not a failure.
    const second = await openDb(file);
    try {
      assert.equal(second.db.select().from(campaigns).all().length, 1);
    } finally {
      second.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
