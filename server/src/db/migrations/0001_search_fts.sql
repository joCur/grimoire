-- The full-text index (planning #52 section 2). Hand-written on purpose:
-- FTS5 is a virtual table, drizzle-kit cannot model one, and a generated
-- diff would try to drop it on every later `generate`.
--
-- Column layout and the bm25 weights it implies (see schema.ts, searchRank —
-- `bm25(search_fts, 10, 6, 4, 1)`):
--
--   title  (10) the entity's display name — a hit here is what the DM meant
--   ref     (6) the id/slug — typed by anyone who knows the reference
--   tags    (4) authored keywords
--   body    (1) the markdown text; a hit here is context, not identity
--
-- `campaign_id`, `kind` and `entity_id` are UNINDEXED: they are filter and
-- payload columns (the search endpoint answers `SearchResult.kind`/`id`/
-- `path` from them) and indexing them would let a query match on a campaign
-- name or the word "scene".
--
-- Tokenizer `unicode61 remove_diacritics 2`: the data is German, and level 2
-- is the version that also folds diacritics on codepoints outside Latin-1
-- (level 1 is the legacy behaviour). This is what makes "muller" find
-- "Müller" and "leuchtturm" find "Leuchtturm".
--
-- The index is CONTENTLESS-EXTERNAL-CONTENT-free — a plain FTS5 table that
-- owns its copy of the text — and is maintained EXPLICITLY from the store
-- layer. No triggers: the rows it indexes come from six different tables
-- with different notions of "title", and a trigger per table would put that
-- mapping in SQL where nothing can test it.

CREATE VIRTUAL TABLE `search_fts` USING fts5(
	title,
	ref,
	tags,
	body,
	campaign_id UNINDEXED,
	kind UNINDEXED,
	entity_id UNINDEXED,
	tokenize = 'unicode61 remove_diacritics 2'
);
