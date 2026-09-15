--> issue #100: a scene's group IS its `location`, so the independent
--> `group_slug` is gone. The DATA step that carries the old grouping over
--> into `location` runs in TypeScript right BEFORE this file
--> (db/group-migration.ts, called from db/client.ts `openDb`) — it needs
--> this column, and its slug derivation is not expressible in SQL.
ALTER TABLE `scenes` DROP COLUMN `group_slug`;