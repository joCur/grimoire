// The one-time data step: `group_slug` becomes `location`.
//
// WHY IT RUNS BEFORE THE SCHEMA MIGRATOR
//
// Migration 0009 DROPS `scenes.group_slug`, and the data this step needs is
// in that column. The rule it applies is not expressible in SQL either: a
// free-text `location` becomes a location ID, and that derivation is the
// German transliteration of `@grimoire/shared/slug` („Die Bucht" ->
// `die-bucht`). So the step is TypeScript, and `openDb` runs it on the raw
// client while the old schema is still there — a pre-migration hook, guarded
// by "does `scenes.group_slug` still exist". On a database that has already
// migrated (and on every fresh one) it is a no-op and reports nothing.
//
// WHAT IT DOES, per scene:
//
//   1. `location` empty  -> the scene inherits its GROUP (`hafen/…` becomes
//      `location: hafen`). That is what the file tree meant, and it keeps the
//      DM's grouping exactly as it was.
//   2. `location` is free text -> it becomes the slug of that text, and the
//      location entry is created with the text as its `name`. The format's
//      free-text exception is gone, so there is no third option.
//   3. `location` names an entry that does not exist -> the empty entry is
//      created. Without it the chapter view would show a heading for a
//      location the campaign cannot name — and since every reference became
//      a foreign key, such a scene could not be stored at all. This is the
//      ONE place that still creates an entry for a reference, and only for
//      the one column this step derives, on a database that predates it.
//
// Every scene whose ADDRESS changes is reported, because that is what a DM
// notices: `<chapter>/<old-group>/<id>` is a link they may have written down.

import { toSlug } from "@grimoire/shared/slug";
import type { SqliteClient } from "./driver";

export interface GroupMigrationMove {
  campaignId: string;
  sceneId: string;
  /** The group the scene sat in, "" for chapter level. */
  from: string;
  /** The location id it sits under now, "" for chapter level. */
  to: string;
}

/** A `location` this step could not turn into an id — left as it was. */
export interface GroupMigrationUnresolved {
  campaignId: string;
  sceneId: string;
  /** The text the scene named, verbatim. */
  location: string;
}

export interface GroupMigrationOutcome {
  /** Scenes whose address changed, in a stable order. */
  moved: GroupMigrationMove[];
  /** `<campaign>/<location-id>` per entry this step created. */
  createdLocations: string[];
  /**
   * Scenes whose `location` transliterates to NOTHING (`„???"`, an emoji).
   * They are reported instead of migrated: the row keeps the text it had,
   * because inventing an id for it — or dropping it, which is what this step
   * used to do — is a decision only the DM can make.
   */
  unresolved: GroupMigrationUnresolved[];
}

export const NO_GROUP_MIGRATION: GroupMigrationOutcome = {
  moved: [],
  createdLocations: [],
  unresolved: [],
};

/** Is there such a table? Asked before every raw-client query below. */
function hasTable(client: SqliteClient, name: string): boolean {
  return (
    client
      .prepare("select name from sqlite_master where type = 'table' and name = ?")
      .all(name).length > 0
  );
}

/** Does this database still have the pre-migration column? */
function hasGroupSlug(client: SqliteClient): boolean {
  if (!hasTable(client, "scenes")) return false;
  return client
    .prepare("pragma table_info(scenes)")
    .all()
    .some((row) => row.name === "group_slug");
}

/**
 * The `meta` marker that says this step has nothing left to do.
 *
 * "The column is gone" is the step's idempotency guard, and it is the
 * migrator that removes it — so a boot whose MIGRATOR failed after this step
 * succeeded (0009 is the migration that drops the column) finds the old
 * schema again and re-derived everything: the writes were idempotent, but
 * the boot log re-reported every moved scene as if it had just moved. The
 * marker is the missing half: written in the SAME transaction as the writes,
 * so it exists exactly when the derivation is complete.
 *
 * It is written only when NOTHING is left open (`unresolved`) — a scene whose
 * location yields no id still needs the DM, and that line should keep
 * appearing until it does.
 */
const MIGRATION_DONE_KEY = "group_migration_100";

function alreadyMigrated(client: SqliteClient): boolean {
  if (!hasTable(client, "meta")) return false;
  return client.prepare("select 1 from meta where key = ?").all(MIGRATION_DONE_KEY).length > 0;
}

interface SceneRow {
  campaign_id: string;
  id: string;
  group_slug: string;
  location: string | null;
}

/**
 * Derive `location` from `group_slug` for every scene that needs it, and
 * create the location entries the result references.
 *
 * Idempotent twice over: the column it reads is gone after migration 0009,
 * and a boot that ran this step but not the migrator finds the
 * MIGRATION_DONE_KEY marker and does nothing — so the boot log reports each
 * moved scene exactly once, in the boot that moved it.
 */
export function migrateGroupsToLocations(client: SqliteClient): GroupMigrationOutcome {
  if (!hasGroupSlug(client)) return NO_GROUP_MIGRATION;
  if (alreadyMigrated(client)) return NO_GROUP_MIGRATION;

  const rows = client
    .prepare("select campaign_id, id, group_slug, location from scenes order by campaign_id, id")
    .all() as unknown as SceneRow[];
  if (rows.length === 0) return NO_GROUP_MIGRATION;

  const setLocation = client.prepare("update scenes set location = ? where campaign_id = ? and id = ?");
  const locationExists = client.prepare("select 1 from locations where campaign_id = ? and id = ?");
  const insertLocation = client.prepare(
    "insert into locations (campaign_id, id, name, body, extra, rev) values (?, ?, ?, '', '{}', 1)",
  );
  // Prepared on FIRST USE: most databases create no entry at all here (every
  // group directory the DM had is already a location), and a statement
  // against the FTS table is the one query in this step that can fail on a
  // database whose virtual table was never created.
  let indexLocation: ReturnType<SqliteClient["prepare"]> | undefined;
  const indexLocationStatement = (): ReturnType<SqliteClient["prepare"]> => {
    indexLocation ??= client.prepare(
      "insert into search_fts (title, ref, tags, body, campaign_id, kind, entity_id) values (?, ?, '', '', ?, 'location', ?)",
    );
    return indexLocation;
  };

  const moved: GroupMigrationMove[] = [];
  const createdLocations: string[] = [];
  const unresolved: GroupMigrationUnresolved[] = [];

  client
    .transaction(() => {
      for (const row of rows) {
        const group = (row.group_slug ?? "").trim();
        const declared = (row.location ?? "").trim();
        const source = declared === "" ? group : declared;
        const target = source === "" ? "" : toSlug(source);
        // Nothing survives the transliteration („???", an emoji-only name).
        // The row is left EXACTLY as it is and reported: writing `null` here
        // deleted the only copy of the text the DM had typed, and reported it
        // as a move to chapter level — a data loss dressed up as a migration.
        if (source !== "" && target === "") {
          unresolved.push({ campaignId: row.campaign_id, sceneId: row.id, location: source });
          continue;
        }
        if (target !== declared) {
          setLocation.run(target === "" ? null : target, row.campaign_id, row.id);
        }
        if (target !== group) {
          moved.push({ campaignId: row.campaign_id, sceneId: row.id, from: group, to: target });
        }
        if (target === "") continue;
        if (locationExists.all(row.campaign_id, target).length > 0) continue;
        // The name is the TEXT the scene named, unless that text already was
        // the id — an entry whose name repeats its id says nothing, and
        // render.ts falls back to the id anyway.
        const name = source === target ? "" : source;
        insertLocation.run(row.campaign_id, target, name);
        indexLocationStatement().run(name === "" ? target : name, target, row.campaign_id, target);
        createdLocations.push(`${row.campaign_id}/${target}`);
      }
      // The marker commits WITH the writes (or not at all) — see
      // MIGRATION_DONE_KEY. Open rows keep the step reporting.
      if (unresolved.length === 0 && hasTable(client, "meta")) {
        client
          .prepare("insert or replace into meta (key, value) values (?, ?)")
          .run(MIGRATION_DONE_KEY, new Date().toISOString());
      }
    })
    .immediate();

  return { moved, createdLocations, unresolved };
}
