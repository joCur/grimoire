--> A scene is its own resource with its own type (ADR #31), and so are the
--> generator's scene proposals: a scene run lists them under
--> `result.scenes`, each the scene without its guard, and the DM's changes to
--> a proposed scene live in `scene_edits`, by the scene's id. A scene is
--> augmented by a `scene-augment` run that names it in `scene_id`.
-->
--> A stored job that carries a scene in the earlier form is deleted, not
--> converted (ADR #28, ADR #31): an augment run on a scene and a scene run
--> whose result holds a scene or whose review edited one. Every other job
--> keeps its row.
ALTER TABLE `generate_jobs` ADD `scene_id` text;--> statement-breakpoint
ALTER TABLE `generate_jobs` ADD `scene_edits` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
DELETE FROM `generate_jobs`
WHERE `kind` = 'augment'
   OR `draft_edits` <> '{}'
   OR CASE
        WHEN json_valid(`result`) THEN coalesce(json_array_length(`result`, '$.scenes'), 0) > 0
        ELSE 0
      END;--> statement-breakpoint
ALTER TABLE `generate_jobs` DROP COLUMN `target_path`;--> statement-breakpoint
ALTER TABLE `generate_jobs` DROP COLUMN `draft_edits`;
