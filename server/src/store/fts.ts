// FTS5 index maintenance (issue #57, planning section 2: "Pflege explizit
// aus der Store-Schicht").
//
// No triggers on purpose: the six indexed kinds live in six tables with six
// different notions of "title", and a trigger per table would put that
// mapping into SQL where nothing can test it — and would make the Node smoke
// job depend on trigger parity between the two SQLite backends.
//
// The contract is one row per (campaign_id, kind, entity_id). Every writer
// calls `indexEntity` after changing content; `dropEntity` removes it. Both
// are idempotent: the delete-then-insert shape means a double call cannot
// leave two rows behind.

import { sql } from "drizzle-orm";
import type { GrimoireDb } from "../db/client";

export interface IndexedEntity {
  kind: string;
  entityId: string;
  /** Display name — bm25 weight 10. */
  title: string;
  /** The id/slug anyone who knows the reference would type — weight 6. */
  ref: string;
  /** Authored keywords, space separated — weight 4. */
  tags: string;
  /** The markdown text — weight 1: a hit here is context, not identity. */
  body: string;
}

export function dropEntity(
  db: GrimoireDb,
  campaignId: string,
  kind: string,
  entityId: string,
): void {
  db.run(sql`
    delete from search_fts
    where campaign_id = ${campaignId} and kind = ${kind} and entity_id = ${entityId}
  `);
}

/** Replace one entity's index row (delete + insert — see the note above). */
export function indexEntity(db: GrimoireDb, campaignId: string, entity: IndexedEntity): void {
  dropEntity(db, campaignId, entity.kind, entity.entityId);
  db.run(sql`
    insert into search_fts (title, ref, tags, body, campaign_id, kind, entity_id)
    values (${entity.title}, ${entity.ref}, ${entity.tags}, ${entity.body},
            ${campaignId}, ${entity.kind}, ${entity.entityId})
  `);
}

/** Move an entity's index row to a new id (the rename cascade, issue #30). */
export function renameEntityIndex(
  db: GrimoireDb,
  campaignId: string,
  kind: string,
  oldId: string,
  newId: string,
): void {
  db.run(sql`
    update search_fts set entity_id = ${newId}, ref = ${newId}
    where campaign_id = ${campaignId} and kind = ${kind} and entity_id = ${oldId}
  `);
}
