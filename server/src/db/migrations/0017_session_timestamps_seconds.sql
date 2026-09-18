--> Minute-precise session timestamps get their seconds.
-->
--> `sessions.started`, `sessions.ended` and both ends of a `session_pauses`
--> row have ONE shape, `yyyy-MM-ddTHH:mm:ss` (store/time.ts), and the boot
--> check (db/timestamp-preflight.ts) refuses a database holding anything
--> else. Installations that recorded sessions before the seconds were written
--> hold `yyyy-MM-ddTHH:mm` values, and those would keep such a database from
--> starting at all.
-->
--> This is a MIGRATION and not a repair because the completion is LOSSLESS and
--> DETERMINISTIC: the value says which minute it is, `:00` is the only second
--> that minute's stated precision allows, and the reading of the timestamp
--> does not change. Nothing here has to be guessed, so nothing is asked of the
--> DM. Every OTHER shape is left exactly as it is — what `19:30` on an unknown
--> day was meant to be is a reading only the DM can supply, and the boot check
--> names those values instead.
-->
--> Two steps per column, in order:
-->
-->   1. The SEPARATOR. A value whose day and time are otherwise in shape but
-->      separated by a space becomes the `T` form. `substr(…, 11, 1)` is that
-->      separator; the two halves are matched with GLOB, so only digits in the
-->      right places qualify.
-->   2. The SECONDS. A minute-precise value — the date, `T`, hour and minute
-->      and nothing more — gets `:00` appended.
-->
--> The steps are written as two statements rather than one expression so the
--> second one also picks up what the first one just turned into the `T` form.
-->
--> It is idempotent: a canonical value matches neither step, so a second run
--> changes nothing.

UPDATE `sessions` SET `started` = substr(`started`, 1, 10) || 'T' || substr(`started`, 12)
WHERE `started` IS NOT NULL
  AND substr(`started`, 11, 1) = ' '
  AND substr(`started`, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND (substr(`started`, 12) GLOB '[0-9][0-9]:[0-9][0-9]'
    OR substr(`started`, 12) GLOB '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]');--> statement-breakpoint
UPDATE `sessions` SET `started` = `started` || ':00'
WHERE `started` IS NOT NULL
  AND length(`started`) = 16
  AND `started` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]';--> statement-breakpoint
UPDATE `sessions` SET `ended` = substr(`ended`, 1, 10) || 'T' || substr(`ended`, 12)
WHERE `ended` IS NOT NULL
  AND substr(`ended`, 11, 1) = ' '
  AND substr(`ended`, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND (substr(`ended`, 12) GLOB '[0-9][0-9]:[0-9][0-9]'
    OR substr(`ended`, 12) GLOB '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]');--> statement-breakpoint
UPDATE `sessions` SET `ended` = `ended` || ':00'
WHERE `ended` IS NOT NULL
  AND length(`ended`) = 16
  AND `ended` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]';--> statement-breakpoint
UPDATE `session_pauses` SET `from_ts` = substr(`from_ts`, 1, 10) || 'T' || substr(`from_ts`, 12)
WHERE `from_ts` IS NOT NULL
  AND substr(`from_ts`, 11, 1) = ' '
  AND substr(`from_ts`, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND (substr(`from_ts`, 12) GLOB '[0-9][0-9]:[0-9][0-9]'
    OR substr(`from_ts`, 12) GLOB '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]');--> statement-breakpoint
UPDATE `session_pauses` SET `from_ts` = `from_ts` || ':00'
WHERE `from_ts` IS NOT NULL
  AND length(`from_ts`) = 16
  AND `from_ts` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]';--> statement-breakpoint
UPDATE `session_pauses` SET `to_ts` = substr(`to_ts`, 1, 10) || 'T' || substr(`to_ts`, 12)
WHERE `to_ts` IS NOT NULL
  AND substr(`to_ts`, 11, 1) = ' '
  AND substr(`to_ts`, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND (substr(`to_ts`, 12) GLOB '[0-9][0-9]:[0-9][0-9]'
    OR substr(`to_ts`, 12) GLOB '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]');--> statement-breakpoint
UPDATE `session_pauses` SET `to_ts` = `to_ts` || ':00'
WHERE `to_ts` IS NOT NULL
  AND length(`to_ts`) = 16
  AND `to_ts` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]';
