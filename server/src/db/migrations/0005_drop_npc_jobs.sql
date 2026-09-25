--> An npc is its own resource with its own type (ADR #31), and so are the
--> generator's npc proposals: a scene run lists them under `result.npcs`,
--> its outline under `npcs` beside `locations`, an NPC run carries its npc
--> as the npc without its guard, and an npc is augmented by an `npc-augment`
--> run that names it in `npc_id`. The DM's changes to a proposed npc live in
--> `npc_edits`.
-->
--> A stored job that carries an npc in the earlier form is deleted, not
--> converted (ADR #28, ADR #31): an NPC run, an augment run on an npc, a
--> scene run whose `stubs` hold one and a scene run whose outline proposes an
--> npc or a location in its `entries`. Every other scene run keeps its result
--> with an empty `npcs` list, and its outline gets empty `npcs` and
--> `locations` lists.
ALTER TABLE `generate_jobs` ADD `npc_id` text;--> statement-breakpoint
ALTER TABLE `generate_jobs` ADD `npc_edits` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
DELETE FROM `generate_jobs`
WHERE `kind` = 'npc'
   OR `target_path` LIKE 'npcs/%'
   OR CASE
        WHEN json_valid(`result`) THEN coalesce(json_array_length(`result`, '$.stubs'), 0) > 0
        ELSE 0
      END
   OR CASE
        WHEN json_valid(`pipeline`)
          THEN coalesce(json_array_length(`pipeline`, '$.outline.entries'), 0) > 0
        ELSE 0
      END;--> statement-breakpoint
UPDATE `generate_jobs`
SET `result` = json_set(json_remove(`result`, '$.stubs'), '$.npcs', json('[]'))
WHERE json_valid(`result`) AND json_type(`result`, '$.npcs') IS NULL;--> statement-breakpoint
UPDATE `generate_jobs`
SET `pipeline` = json_set(
  json_remove(`pipeline`, '$.outline.entries'),
  '$.outline.npcs', json('[]'),
  '$.outline.locations', json('[]')
)
WHERE json_valid(`pipeline`)
  AND json_type(`pipeline`, '$.outline') = 'object'
  AND json_type(`pipeline`, '$.outline.npcs') IS NULL;--> statement-breakpoint
UPDATE `generate_jobs`
SET `review` = json_remove(`review`, '$.entries')
WHERE json_valid(`review`) AND json_type(`review`, '$.entries') IS NOT NULL;
