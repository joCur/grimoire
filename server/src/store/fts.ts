// FTS5 index maintenance, kept explicitly from the store layer
// rather than by triggers.
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

// NOTE: there is deliberately no "move the index row to a new id" helper. An
// id never changes, and a changed display name is a full re-index — see
// store/search-index.ts `reindexRow`, which hands each kind to the domain module
// that knows what its title is.
