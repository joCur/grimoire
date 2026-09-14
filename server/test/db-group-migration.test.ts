// The one-time data step of issue #100: `group_slug` becomes `location`.
//
// It runs on the RAW client, before the schema migrator drops the column
// (db/client.ts `openDb`) — so this exercises it the same way: an
// old-schema database built by hand, the step, then the assertions. That
// keeps the test honest about the one thing that matters, namely that the
// step reads a column the current schema no longer has.

import { describe, expect, test } from "bun:test";
import { migrateGroupsToLocations, NO_GROUP_MIGRATION } from "../src/db/group-migration";
import { openSqlite, type SqliteClient } from "../src/db/driver";

/** The pre-#100 shape of the three tables the step touches. */
async function oldSchemaDb(): Promise<SqliteClient> {
  const client = await openSqlite(":memory:");
  client.exec(`
    create table scenes (
      campaign_id text not null,
      id text not null,
      chapter_id text,
      group_slug text not null default '',
      location text,
      primary key (campaign_id, id)
    );
    create table locations (
      campaign_id text not null,
      id text not null,
      name text not null default '',
      body text not null default '',
      extra text not null default '{}',
      rev integer not null default 1,
      primary key (campaign_id, id)
    );
    create table meta (key text primary key, value text not null);
    create virtual table search_fts using fts5(
      title, ref, tags, body, campaign_id unindexed, kind unindexed, entity_id unindexed
    );
  `);
  return client;
}

function addScene(
  client: SqliteClient,
  id: string,
  group: string,
  location: string | null,
): void {
  client
    .prepare("insert into scenes (campaign_id, id, chapter_id, group_slug, location) values (?, ?, '01', ?, ?)")
    .run("beispiel", id, group, location);
}

function scenes(client: SqliteClient): Record<string, unknown>[] {
  return client.prepare("select id, location from scenes order by id").all();
}

function locations(client: SqliteClient): Record<string, unknown>[] {
  return client.prepare("select id, name from locations order by id").all();
}

describe("group_slug -> location (#100)", () => {
  test("an empty location inherits the group directory", async () => {
    const client = await oldSchemaDb();
    addScene(client, "ankunft", "hafen", null);
    const out = migrateGroupsToLocations(client);
    expect(scenes(client)).toEqual([{ id: "ankunft", location: "hafen" }]);
    // The group did not change, so the ADDRESS did not — nothing to report.
    expect(out.moved).toEqual([]);
    // …but the group has to be nameable, so the entry is created.
    expect(locations(client)).toEqual([{ id: "hafen", name: "" }]);
    expect(out.createdLocations).toEqual(["beispiel/hafen"]);
    client.close();
  });

  test("a location that disagrees with the group MOVES the scene, and is reported", async () => {
    const client = await oldSchemaDb();
    addScene(client, "ankunft", "hafen", "leuchtturm");
    const out = migrateGroupsToLocations(client);
    expect(scenes(client)).toEqual([{ id: "ankunft", location: "leuchtturm" }]);
    expect(out.moved).toEqual([
      { campaignId: "beispiel", sceneId: "ankunft", from: "hafen", to: "leuchtturm" },
    ]);
    expect(out.createdLocations).toEqual(["beispiel/leuchtturm"]);
    client.close();
  });

  test("free text becomes a location entry with the text as its name", async () => {
    const client = await oldSchemaDb();
    addScene(client, "bruecke", "", "Die alte Brücke");
    const out = migrateGroupsToLocations(client);
    expect(scenes(client)).toEqual([{ id: "bruecke", location: "die-alte-bruecke" }]);
    expect(locations(client)).toEqual([{ id: "die-alte-bruecke", name: "Die alte Brücke" }]);
    expect(out.moved).toEqual([
      { campaignId: "beispiel", sceneId: "bruecke", from: "", to: "die-alte-bruecke" },
    ]);
    expect(out.createdLocations).toEqual(["beispiel/die-alte-bruecke"]);
    // …and it is findable, like every other entry.
    expect(
      client.prepare("select entity_id from search_fts where kind = 'location'").all(),
    ).toEqual([{ entity_id: "die-alte-bruecke" }]);
    client.close();
  });

  test("an existing location entry is never overwritten", async () => {
    const client = await oldSchemaDb();
    client
      .prepare("insert into locations (campaign_id, id, name) values ('beispiel', 'leuchtturm', 'Der Leuchtturm')")
      .run();
    addScene(client, "ankunft", "hafen", "leuchtturm");
    const out = migrateGroupsToLocations(client);
    expect(locations(client)).toEqual([{ id: "leuchtturm", name: "Der Leuchtturm" }]);
    expect(out.createdLocations).toEqual([]);
    client.close();
  });

  test("a scene with neither group nor location stays on chapter level", async () => {
    const client = await oldSchemaDb();
    addScene(client, "frei", "", null);
    const out = migrateGroupsToLocations(client);
    expect(scenes(client)).toEqual([{ id: "frei", location: null }]);
    expect(out).toEqual(NO_GROUP_MIGRATION);
    client.close();
  });

  test("a location that yields no id is left untouched and reported", async () => {
    const client = await oldSchemaDb();
    // Nothing survives the transliteration, so there is no id to derive.
    // The step used to write `null` here — the only copy of the DM's text,
    // gone, and reported as a move to chapter level (issue #100 review).
    addScene(client, "ankunft", "hafen", "???");
    const out = migrateGroupsToLocations(client);
    expect(scenes(client)).toEqual([{ id: "ankunft", location: "???" }]);
    expect(out.moved).toEqual([]);
    expect(out.createdLocations).toEqual([]);
    expect(out.unresolved).toEqual([
      { campaignId: "beispiel", sceneId: "ankunft", location: "???" },
    ]);
    client.close();
  });

  test("a re-run after a failed 0009 reports nothing a second time", async () => {
    // 0009 is the migration that DROPS the column, and it is what makes this
    // step a no-op. A boot whose migrator failed after the step succeeded
    // therefore finds the old schema again — and used to re-derive and
    // RE-REPORT every move (issue #100 review). The marker ends that.
    const client = await oldSchemaDb();
    addScene(client, "ankunft", "hafen", "leuchtturm");
    expect(migrateGroupsToLocations(client).moved).toHaveLength(1);

    const again = migrateGroupsToLocations(client);
    expect(again).toEqual(NO_GROUP_MIGRATION);
    // …and nothing was written twice either.
    expect(locations(client)).toEqual([{ id: "leuchtturm", name: "" }]);
    client.close();
  });

  test("an open row keeps the step reporting until the DM fixes it", async () => {
    const client = await oldSchemaDb();
    addScene(client, "ankunft", "hafen", "???");
    expect(migrateGroupsToLocations(client).unresolved).toHaveLength(1);
    // No marker while something is open: the line has to keep appearing.
    expect(migrateGroupsToLocations(client).unresolved).toHaveLength(1);
    client.close();
  });

  test("a database without the column is a no-op — the step is idempotent", async () => {
    const client = await openSqlite(":memory:");
    client.exec("create table scenes (campaign_id text, id text, location text)");
    expect(migrateGroupsToLocations(client)).toEqual(NO_GROUP_MIGRATION);
    // …and so is a database that has no scenes table at all (a fresh file).
    const fresh = await openSqlite(":memory:");
    expect(migrateGroupsToLocations(fresh)).toEqual(NO_GROUP_MIGRATION);
    client.close();
    fresh.close();
  });
});
