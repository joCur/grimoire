--> What an npc wants and what a place feels like become properties (ADR #29).
-->
--> Two nullable columns and no data step: both start empty. An existing
--> `## Will` or `## Atmosphäre` section stays where it is, as free text of the
--> entry's body — nothing is moved out of a body, and nothing reads it as
--> data any more.
ALTER TABLE `locations` ADD `atmosphere` text;--> statement-breakpoint
ALTER TABLE `npcs` ADD `motivation` text;
