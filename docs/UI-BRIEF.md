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
Typ-Marker: Szene, NPC, Ort, Eventualszene und die sechs Callout-Typen.
Monochrom, in Textfarbe, 16–20px. Keine bunten Icon-Illustrationen.

## Die Ansichten

### 1. Kapitel (Prep-Modus, Desktop; Route `/campaigns/:id`)
Job: Überblick und Ordnung. Kapitel > Szenen als ruhige Liste
(keine Karten-Grids), Status als dezente Marker, Eventualszenen visuell
als eigene Gruppe („Eventualszenen"). Die Liste steht in der Reihenfolge,
die der DM gelegt hat — der Ort ist keine Ebene mehr über den Szenen,
sondern ein Wort in der Metazeile der Zeile, neben Typ und Tags.
Umgelegt wird die Reihenfolge genau hier, mit Hoch/Runter an der Zeile:
leise wie alles andere, spürbar an der Zeile, die gerade dran ist, und
nicht als Dauerbeschriftung neben jeder Szene. Filter über Tags/Status,
globale Suche prominent (Cmd/Ctrl-K). Von hier: Szene öffnen,
Session starten, Generator aufrufen.

### 2. Szene (Lesen)
Job: eine Szene vollständig erfassen. Eigenschaften als kompakte Kopfzeile
(Typ, Trigger, Ort, Tags), NPC-Karten der Szene rechts (voice, Will,
Kurzwerte — genau diese drei), Body mit gerendertem Flow, einklappbaren
`If:`-Verzweigungen und den Callout-Blöcken. Read-Aloud siehe Signatur.
`[!check]` klar erkennbar (Akzentrahmen), `[!secret]` mit Auge-Marker
und leicht abgedunkelt — Geheimnisse sehen geheim aus.

### 3. Session-Ansicht (Session-Modus, Desktop; Route `live`)
Job: moderieren ohne suchen. Drei ruhige Zonen: links Szenenliste des
Kapitels in der Reihenfolge aus der Vorbereitung (geplant oben,
Eventualszenen darunter; umgelegt wird sie in der Kapitelübersicht, nicht
hier), Mitte aktuelle Szene, rechts NPCs + Schnellnotiz-Feld (immer
fokussierbar, Enter sendet). Der rote Faden des Abends ist ein einziger
Schritt unter der offenen Szene: „Nächste Szene: <Titel>" — er sagt, wohin
der DM als nächstes greift, ohne dass er die Liste absuchen muss. Beim
Betreten steht die erste Szene an, die noch nicht gespielt ist.
Kopfzeile: Sessionzeit (berechnet aus `started`), Pause,
Session beenden. Die Schnellnotiz ist nach dem Read-Aloud das
zweitwichtigste Element — nichts darf sie verdecken.

### 4. Mobil
Job: nachschlagen und einwerfen, nicht moderieren. Zwei Dinge auf der
Startfläche: Suche und Ideen-Eingabe. Szenen/NPCs als reine Leseansicht.
Keine Session-Ansicht auf Mobil erzwingen.

### 5. Nachbereitung (nach der Session; Route `review`)
Job: fünf Minuten Nachbereitung (der frühere Begriff „Ernte" ist in der UI
abgelöst — unklare Metaphorik). Notizen und Ideen mit `#thread`/`#npc`
gefiltert, je Notiz Ein-Klick-Aktionen (Handlungsstrang übernehmen,
vorgeschlagenen NPC anlegen, verwerfen). Fortschritt sichtbar („3 von 7 gesichtet").

## Ton der UI-Texte

Deutsch, Sätze klein, Verben zuerst („Session starten", „Szene öffnen").
Keine Ausrufezeichen, kein Fantasy-Sprech in Funktionstexten
(kein „Beschwöre eine neue Szene"). Leere Zustände laden zum Handeln ein
(„Noch keine Szenen in diesem Kapitel — erste Szene anlegen").

### Begriffe in der UI

Jede Ansicht und jede Aktion heißt nach ihrer Funktion — keine internen
Namen, keine Metaphern, keine Anglizismen, wo ein deutsches Wort trägt.
Routen, Query-Keys, Katalog-Keys und Format-Token (`inbox`-Liste, Hashtags,
Callout-Typen, Status-Werte) bleiben davon unberührt.

| UI sagt (de) | UI sagt (en) | früher |
|---|---|---|
| Kapitel | Chapters | Pool |
| Session-Ansicht | Session view | Live-Modus / Live-Ansicht |
| Nachbereitung | Session review | Ernte, Wrap-up |
| Ideen ohne Tag | Ideas without a tag | Ungetaggte Einträge, Notizen (Sektion der Nachbereitung) |
| Ideen | Ideas | Inbox |
| Entwürfe prüfen | Check drafts | Review (Generator) |
| Vorschlag prüfen | Check the proposal | Review (NPC-Generator) |
| Vorgeschlagene NPCs und Orte | Suggested NPCs and locations | Vorgeschlagene Einträge, Stubs |
| Eventualszene | Contingency scene | Kontingenz, „Falls es schiefgeht" |
| Probe | Check | Check (de) |
| Ergebnis | Outcome | Konsequenz |
| Markdown-Block | Markdown block | Roh-Block |
| Kurzwerte | Quick stats | Quickstats |
| Handlungsstrang | Storyline | Thread (en) |
| Eigenschaften | Properties | Frontmatter |
| Text | Text | Body |

## Nicht-Ziele

Keine Statblocks, kein Würfeln, keine Initiative, keine Spieler-Ansicht,
keine Ornament-Grafiken, keine Parallax-/Scroll-Effekte. Motion nur als
kurze, funktionale Übergänge (Einklappen, Fokuswechsel);
`prefers-reduced-motion` schaltet sie ab.

## Abnahme-Test je Ansicht

„Findet der DM mitten im Satz sprechend die Information, ohne den Satz
zu unterbrechen?" Wenn eine Design-Entscheidung diese Frage nicht
verbessert, ist sie Dekoration — weglassen.
