# Die Datenbank hält die Regeln über ihre Spalten

## Entscheidung

### Jede Referenz ist ein Fremdschlüssel

Jede gespeicherte Referenz hat einen zusammengesetzten Fremdschlüssel
`(campaign_id, <referenz>)` mit `ON UPDATE CASCADE` und
`ON DELETE NO ACTION`. Eine Referenz nennt damit eine Zeile, die es gibt, und
die Datenbank garantiert das.

| Referenz | Ziel | Pflicht |
| -------- | ---- | ------- |
| `scenes.chapter_id` | `chapters` | ja — eine Szene gehört zu einem Kapitel |
| `scenes.location` | `locations` | nein |
| `scene_npcs.npc_id` | `npcs` | ja |
| `npcs.chapter_id` | `chapters` | nein |
| `locations.chapter_id` | `chapters` | nein |
| `threads.chapter_id` | `chapters` | ja |
| `log_entries.scene_id` | `scenes` | nein |
| `played_scenes.scene_id` | `scenes` | ja |

`generate_jobs.chapter` hat keinen Fremdschlüssel: ein Lauf mit „Neues
Kapitel" nennt das Kapitel, das er beim Übernehmen selbst anlegt
(`decisions/generator`).

**Eine Nennung legt nichts an.** Eine Zeile entsteht über ihren
Anlege-Endpunkt (dazu gehört „NPC anlegen" aus einer Log-Zeile in der
Nachbereitung) und über das Übernehmen eines Generator-Vorschlags, sonst
nirgends — und dazu gehört das Kapitel eines „Neues Kapitel"-Laufs. Eine
übernommene Szene nimmt die vorgeschlagenen NPCs und Orte desselben Laufs
mit, die sie nennt: sie sind Teil desselben Vorschlags. Was der DM abgelehnt
hat, bleibt abgelehnt; dann wird die Szene abgewiesen und nennt die fehlende
Zeile.

Wer in `npcs`, `location` oder `chapter`, in einer Log-Zeile oder in einer
gespielten Szene etwas nennt, das keine Zeile hat, bekommt 400 mit eigenem
Code (`npc_unknown`, `location_unknown`, `chapter_unknown`,
`log_scene_unknown`, `played_scene_unknown`) und dem Hinweis, die Zeile zuerst
anzulegen; geschrieben wird nichts. Der Ort einer Szene ist eine Orts-id oder
leer; Freitext ist 400 `location_not_an_id`.

**Eine Nennung im Text ist keine Referenz.** `[[id]]` und die Zeilen unter
`## Beziehungen` sind sichtbarer Text. Es gibt keine Tabelle für Beziehungen,
weil nichts in der Speicherung aus Text abgeleitet wird; eine Beziehung als
Daten wäre ein Feld im Dialog und im Generator, kein geparster Abschnitt
(`decisions/data-shape`). Ein `[[id]]` ohne Zeile wird als Text angezeigt,
ohne Fehler.

### Eine leere Zeile ist kein Fehler

Eine Zeile ohne Inhalt, etwa ein NPC, der nur seine id trägt, zeigt eine
dünne Karte, ist normal befüllbar und bekommt keinen „fehlt"-Platzhalter. Das
Übernehmen eines Generator-Vorschlags füllt einen leeren NPC oder Ort; einer
mit Inhalt ist ein Konflikt.

Ein NPC ist leer, wenn alle seine Felder auf ihrem Default stehen
(`isEmptyNpcRow` in `server/src/store/npcs.ts`); ein `status` außer dem
Default zählt als Inhalt. Ein Anlegen oder Übernehmen derselben id füllt einen
leeren NPC, statt zu kollidieren. Ein NPC mit Inhalt ist 409 `slug_taken` mit
einem freien Vorschlag, und geschrieben wird nichts. Der Text eines NPC, der
aus einer Log-Zeile entsteht, ist genau die Notiz, ohne Überschrift; ohne
Notiz bleibt er leer.

### Status und Typ sind CHECK-Constraints

Die vier geschlossenen Felder — `scenes.status`, `scenes.type`, `npcs.status`,
`chapters.status` — sind `CHECK`-Constraints ihrer Spalten. Die erlaubten
Werte stehen **einmal**, in den Modulen ihrer Entität (`SCENE_STATUSES` und
`SCENE_TYPES` in `shared/src/scene.ts`, `NPC_STATUSES` in `shared/src/npc.ts`,
`CHAPTER_STATUSES` in `shared/src/chapter.ts`); das Schema baut die
Constraints aus genau diesen Listen. Ein fremder Wert auf dem Schreibweg ist
400 `status_not_allowed` (`{ kind, value, allowed }`) bzw.
`scene_type_not_allowed` (`{ value, allowed }`), nicht ein
`CHECK constraint failed` aus SQLite.

Die Zeitstempel einer Session und ihrer Pausen haben genau eine Form,
`yyyy-mm-ddTHH:MM:SS` als zonenlose Lokalzeit (`server/src/store/time.ts`).
Der Server bildet sie aus dem Epochen-Wert, den der Client schreibt
(`decisions/resources`), und der Leser liest nur sie.

### ids sind unveränderlich

Die `id` einer Zeile wird beim Anlegen gesetzt und ändert sich danach nie.
Der Eigenschaften-Dialog zeigt sie als Kontext, bietet aber keine Änderung;
kein Schreibzugriff ändert sie. Die Personalisierung der id passiert einmal,
im Anlege-Dialog.

## Warum

Eine Regel, die nur die API einhält, ist eine Absprache: sie gilt an den
Stellen, an denen jemand daran gedacht hat. Ein Tippfehler aus dem Generator
oder aus einem direkten Schreibzugriff käme in der Spalte an und wäre danach
ein Wert, den die Leseansicht wörtlich anzeigt und niemand als Fehler
erkennt. Die Zeile ist die Wahrheit (`decisions/sqlite`), also gehört eine
Regel über den Inhalt einer Spalte in die Spalte — Referenzen als
Fremdschlüssel, geschlossene Wertelisten als CHECK.

„Format degradiert" widerspricht dem nicht. Degradieren ist eine Regel für
den **Leser**: ein unbekannter Callout und eine unbekannte Überschrift werden
angezeigt und werfen nie. Geschlossen ist der **Schreibweg**.

Die id ist der Referenz-Schlüssel des ganzen Modells: sie steht in jeder URL,
in jedem Fremdschlüssel und in jedem `[[id]]` im Text. Ein Apparat, der sie
nachträglich überall mitzieht, wäre der teuerste Teil der Schreibschicht und
würde praktisch nie gebraucht. Ein besserer **Titel** braucht keine neue id:
`[[id]]` löst immer auf den aktuellen Anzeigenamen auf.

Ein NPC existiert als Referenz-Schlüssel oft lange, bevor er etwas enthält;
eine Szene nennt ihn, und der DM füllt ihn später. Deshalb füllt ein Anlegen
die leere Zeile, statt an ihr zu scheitern.

## Folgen

- Es gibt keinen Endpunkt, der eine id ändert, keine Referenz-Kaskade und
  keinen Verwendungs-Bericht. Die `ON UPDATE CASCADE`-Fremdschlüssel bleiben
  im Schema: sie halten Kind-Zeilen ehrlich und kosten nichts.
- Anzeigenamen sind frei änderbar; der Suchindex zieht die referierenden
  Zeilen dabei nach (`server/src/store/refs.ts`).
- Ein neuer Wert in einer der Wertelisten ist eine Migration, keine Änderung
  an einer Konstante allein: eine fünfte Position im Status ist eine
  Entscheidung über das Datenmodell.
- Die App braucht für jeden Fehlercode einen Katalog-Eintrag; ohne ihn
  degradiert sie auf den englischen `error`-Satz (`decisions/i18n`).
- Nicht Teil der Entscheidung: ein Löschweg für Kapitel, Szenen, NPCs und
  Orte (es gibt keinen; `ON DELETE NO ACTION` sagt nur, dass ein solcher Weg
  eine eigene Entscheidung braucht) und Referenzen zwischen Kampagnen (die
  Fremdschlüssel schließen sie aus, weil `campaign_id` Teil jeder Referenz
  ist).
