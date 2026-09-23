--> The order of a chapter's scenes: a per-chapter `pos` and a guard for it.
-->
--> TWO STEPS, one subject.
-->
--> 1. `chapters.scene_order_rev` — the guard token of the ORDER. The chapter
-->    already has a `rev`, and it guards the chapter ENTRY (its properties
-->    and its text, ADR #23); the order is a list of its own, written as a
-->    whole by `PUT /chapters/:chapter/scene-order`. Sharing one counter
-->    would mean each write 409s the other's open editor, so the order gets
-->    its own — the same reasoning the three list guards on `campaigns`
-->    carry. It starts at 1, like they do.
-->
--> 2. `scenes.pos` becomes the order of the scenes WITHIN their chapter.
-->
--> Until now `pos` was handed out as a campaign-wide `max + 1` at creation
--> and never written again, and the chapter overview ignored it: it grouped
--> the scenes by their location, ordered the groups by the location's
--> display name and the scenes inside a group by their address. There was no
--> way for the DM to say what comes first.
-->
--> The UPDATE gives every existing scene the position it is ALREADY
--> displayed at, so nothing appears to move — the order simply becomes
--> writable. The rule it reproduces, per chapter:
-->
-->   1. the scenes that name a location come first, the ones that name none
-->      last (the overview's trailing "Ohne Ort" section),
-->   2. then by the location's DISPLAY NAME — its `name`, or its id when
-->      nobody has named it — because the name is what the heading showed,
-->   3. then by the scene's address, which inside one location group differs
-->      only in the scene id.
-->
--> It NUMBERS EACH CHAPTER FRESH from 0 and keeps none of the old
--> campaign-wide values: those left arbitrary gaps between chapters, and
--> appending a scene to a chapter counts against its own siblings now, not
--> against numbers another chapter handed out.
-->
--> It is expressible in SQL because every part of it is a column or a join:
--> unlike the `group_slug` step (db/group-migration.ts) nothing here has to
--> be transliterated, so no pre-migrator data step is needed.
-->
--> Idempotent: running it again computes the same positions from the same
--> rows. `pos` keeps its `NOT NULL DEFAULT 0`, so a fresh database is
--> untouched and a campaign with one scene per chapter simply gets a 0.
ALTER TABLE `chapters` ADD `scene_order_rev` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE scenes
SET pos = ordered.rn - 1
FROM (
  SELECT
    campaign_id,
    id,
    row_number() OVER (
      PARTITION BY campaign_id, chapter_id
      ORDER BY no_location, group_name, id
    ) AS rn
  FROM (
    SELECT
      s.campaign_id AS campaign_id,
      s.id AS id,
      s.chapter_id AS chapter_id,
      CASE WHEN s.location IS NULL OR s.location = '' THEN 1 ELSE 0 END AS no_location,
      COALESCE(NULLIF(l.name, ''), s.location, '') AS group_name
    FROM scenes s
    LEFT JOIN locations l
      ON l.campaign_id = s.campaign_id AND l.id = s.location
  )
) AS ordered
WHERE ordered.campaign_id = scenes.campaign_id AND ordered.id = scenes.id;
