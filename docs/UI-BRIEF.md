# UI-BRIEF — Grimoire

## Subjekt und Job

Grimoire ist das digitale Zauberbuch eines Spielleiters. Nutzer: genau eine
Person, abends, oft bei gedimmtem Licht, während sie gleichzeitig spricht,
zuhört und Roll20 bedient. Der eine Job jeder Ansicht: **die nächste
Information in unter drei Sekunden liefern, ohne den Erzählfluss zu brechen.**

Grimoire ist ein Werkzeug mit Charakter, kein Fantasy-Themepark.
Die Metapher (Buch, Seiten, vorbereitete Zauber) darf in Material und
Typografie spürbar sein — niemals in Ornament-Rahmen, Pergament-Texturen,
Drachen-Deko oder Fraktur.

## Design-Richtung

**Stimmung:** ruhige Bibliothek bei Kerzenlicht, nicht Dungeon. Dunkler
Primärmodus (Abend-Sessions), warm statt kalt — tiefes Anthrazit mit
braunem Unterton statt Blau-Schwarz. Eine einzige Akzentfarbe im Bereich
gedämpftes Gold/Messing (an Buchschnitt und Lesebändchen orientiert),
sparsam eingesetzt: aktive Szene, Fokus, Primäraktion. Semantische Farben
(Erfolg/Warnung/Gefahr) nur für Status, nie zur Dekoration.

**Typografie trägt die Persönlichkeit:**
- Read-Aloud-Text ist der Star: eine literarische Serif
  (z. B. Source Serif 4 oder Literata), 18–20px, großzügiger Zeilenabstand.
  Das ist der Text, der laut vorgelesen wird — er muss aussehen wie aus
  einem Buch, nicht wie aus einem Admin-Panel.
- UI-Chrome: eine unaufgeregte Sans (z. B. Inter oder system-ui), klein
  und leise. Die UI flüstert, der Inhalt spricht.
- Monospace nur für ids und Quickstats-Badges.

**Signatur-Element (die eine mutige Entscheidung):** Der Read-Aloud-Block.
Er wird als „Buchseite im Interface" behandelt — leicht abgesetzter,
etwas hellerer/wärmerer Hintergrund, Serif, ein feines Lesebändchen-Detail
als linke Akzentlinie, Copy-Button (für Roll20) erst bei Hover/Fokus.
Alles andere im Interface ist bewusst still, damit dieser Block trägt.

**Ikonografie:** Lucide für Funktionales (Navigation, Aktionen, Status).
game-icons.net (CC BY, als eigene React-Komponenten eingecheckt) NUR als
Typ-Marker: Szene, NPC, Ort, Kontingenz und die sechs Callout-Typen.
Monochrom, in Textfarbe, 16–20px. Keine bunten Icon-Illustrationen.

## Die Ansichten

### 1. Pool (Prep-Modus, Desktop)
Job: Überblick und Ordnung. Kapitel > Ort > Szenen als ruhige Liste
(keine Karten-Grids), Status als dezente Marker, Kontingenzen visuell
als eigene Gruppe („Falls es schiefgeht"). Filter über Tags/Status,
globale Suche prominent (Cmd/Ctrl-K). Von hier: Szene öffnen,
Session starten, Generator aufrufen.

### 2. Szene (Lesen)
Job: eine Szene vollständig erfassen. Frontmatter als kompakte Kopfzeile
(Typ, Trigger, Ort, Tags), NPC-Karten der Szene rechts (voice, Will,
Quickstats — genau diese drei), Body mit gerendertem Flow, einklappbaren
`If:`-Verzweigungen und den Callout-Blöcken. Read-Aloud siehe Signatur.
`[!check]` klar erkennbar (Akzentrahmen), `[!secret]` mit Auge-Marker
und leicht abgedunkelt — Geheimnisse sehen geheim aus.

### 3. Live (Session-Modus, Desktop)
Job: moderieren ohne suchen. Drei ruhige Zonen: links Szenen-Pool des
Kapitels (geplant oben, Kontingenzen darunter), Mitte aktuelle Szene,
rechts NPCs + Schnellnotiz-Feld (immer fokussierbar, Enter sendet).
Kopfzeile: Sessionzeit (berechnet aus `started`), Pause-Eintrag,
Session beenden. Die Schnellnotiz ist nach dem Read-Aloud das
zweitwichtigste Element — nichts darf sie verdecken.

### 4. Mobil
Job: nachschlagen und einwerfen, nicht moderieren. Zwei Dinge auf der
Startfläche: Suche und Inbox-Eingabe. Szenen/NPCs als reine Leseansicht.
Kein Live-Modus auf Mobil erzwingen.

### 5. Review (nach der Session)
Job: fünf Minuten Ernte. Log- und Inbox-Einträge mit `#thread`/`#npc`
gefiltert, je Eintrag Ein-Klick-Aktionen (Thread übernehmen, NPC-Stub
anlegen, verwerfen). Fortschritt sichtbar („3 von 7 gesichtet").

## Ton der UI-Texte

Deutsch, Sätze klein, Verben zuerst („Session starten", „Szene öffnen").
Keine Ausrufezeichen, kein Fantasy-Sprech in Funktionstexten
(kein „Beschwöre eine neue Szene"). Leere Zustände laden zum Handeln ein
(„Noch keine Szenen in diesem Kapitel — erste Szene anlegen").

## Nicht-Ziele

Keine Statblocks, kein Würfeln, keine Initiative, keine Spieler-Ansicht,
keine Ornament-Grafiken, keine Parallax-/Scroll-Effekte. Motion nur als
kurze, funktionale Übergänge (Einklappen, Fokuswechsel);
`prefers-reduced-motion` schaltet sie ab.

## Abnahme-Test je Ansicht

„Findet der DM mitten im Satz sprechend die Information, ohne den Satz
zu unterbrechen?" Wenn eine Design-Entscheidung diese Frage nicht
verbessert, ist sie Dekoration — weglassen.
