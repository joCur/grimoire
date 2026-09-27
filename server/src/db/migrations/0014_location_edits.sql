--> The DM's changes to a proposed location of a generator run stand on the
--> job, like those to a proposed scene or npc; every stored job has none yet.
ALTER TABLE `generate_jobs` ADD `location_edits` text DEFAULT '{}' NOT NULL;
