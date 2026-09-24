--> A location is its own resource with its own type (ADR #31), and so are
--> the generator's location proposals: a scene run lists them under
--> `result.locations`, and a location is augmented by a `location-augment`
--> run that names it in `location_id`.
-->
--> A stored job that carries a location in the earlier form is deleted, not
--> converted (ADR #28): an augment run on a location and a scene run whose
--> `stubs` hold one. Every other scene run keeps its result and gets its empty
--> `locations` list.
ALTER TABLE `generate_jobs` ADD `location_id` text;--> statement-breakpoint
DELETE FROM `generate_jobs`
WHERE `target_path` LIKE 'locations/%'
   OR CASE
        WHEN json_valid(`result`) THEN EXISTS (
          SELECT 1 FROM json_each(`result`, '$.stubs')
          WHERE json_extract(`value`, '$.kind') = 'location'
        )
        ELSE 0
      END;--> statement-breakpoint
UPDATE `generate_jobs`
SET `result` = json_set(`result`, '$.locations', json('[]'))
WHERE json_valid(`result`) AND json_type(`result`, '$.locations') IS NULL;
