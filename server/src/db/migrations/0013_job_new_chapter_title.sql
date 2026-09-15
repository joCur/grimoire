-- The title of a „Neues Kapitel" run's chapter belongs to the JOB, not to the
-- browser. Until now it travelled only on the accept body (app state), so a
-- run reviewed after a navigation or a reload wrote its scenes with a
-- `chapter_id` that had no chapter row.
ALTER TABLE `generate_jobs` ADD `new_chapter_title` text;
