# Grimoire — Datenformat & Konventionen

> **Status (ab ADR #13):** Source of Truth ist eine **SQLite-Datenbank**
> (`GRIMOIRE_DATA/grimoire.db`), nicht mehr der Dateibaum. Dieses Dokument
> hat deshalb zwei Hälften, und die Trennung ist wichtig:
>
> - **Import-Format (historisch)** — Ordnerstruktur, Dateinamen und die
>   Frontmatter-Blöcke der Entitäten. Genau dieses Format liest das
>   **Dev-/E2E-Werkzeug `grimoire seed`** (siehe `docs/DEPLOYMENT.md`
>   Abschnitt 2b); `examples/` ist seine Referenz und damit die Fixture-Quelle
>   von Tests und E2E. Der **Server importiert nichts** — eine frische Instanz
>   startet leer (Issue #79). Nichts Neues wird in diesem Format geschrieben —
>   die Beschreibung bleibt, weil `seed` jederzeit wieder laufen kann und weil
>   `examples/` weiter das committete Beispiel ist.
> - **Body-Vokabular — normativ.** Callouts (`> [!readaloud]` &c.), die
>   `## If:`-Abschnitte und die Log-/Inbox-Hashtags gelten unverändert: sie
>   sind der Inhalt der `body`-Spalten, das was der Renderer versteht und was
>   der Generator produzieren muss. Die Frontmatter-KEYS bleiben ebenso
>   verbindlich — sie sind die Spalten des Schemas
>   (`server/src/db/schema.ts`) und die Felder von `GET /file`.
>
> Wo unten „Datei" steht, ist heute ein **Dokument** gemeint: eine Zeile, die
> die API unter demselben Pfad adressiert (`GET /api/:campaign/file?path=…`
> liefert sie als Frontmatter + Body, gerendert aus den Spalten).

Alle **Keys sind Englisch** (stabil, maschinenlesbar), alle **Inhalte Deutsch**.
Grundprinzip: Das Format degradiert, es validiert nicht — unbekannte
Überschriften und Callouts werden als normaler Text gerendert, nichts bricht.
Das gilt für den Import genauso wie für die Anzeige: was die Migration nicht
versteht, landet verbatim in `unknown_files` samt Eintrag im
Migrations-Report — nichts geht verloren, nichts bricht ab.

## Ordnerstruktur (Import-Format, historisch)

```
examples/                  # generische Beispielkampagne — committet, Format-Referenz
campaigns/                 # ECHTE Kampagnendaten — in .gitignore, bleiben lokal
  <campaign-id>/
    _campaign.md            # optional: Anzeigename, Beschreibung
    <chapter>/              # z. B. 01-salzhafen
      _chapter.md           # Kapitelnotizen, offene Fäden
      <location-slug>/      # grobe Orts-Gruppierung (max. 2 Ebenen!)
        <scene>.md
    npcs/<id>.md
    locations/<id>.md
    sessions/<id>.md           # von der App verwaltet, id ist opak
    inbox.md                   # Ideen-Eingang, append-only
    glossary.md                # Übersetzungs-Glossar für den Generator
```

## Entität: Kampagne

`_campaign.md` im Kampagnen-Root — Gegenstück zur `_chapter.md`-Konvention.
Beim Import optional; fehlt sie, heißt die Kampagne wie ihr Ordner. Das
Dokument selbst existiert danach immer (die Kampagnen-Zeile IST es), und ohne
eigenen Namen ist der Anzeigename die id — in der Kampagnenliste und im
Dokument gleich.

```yaml
---
id: beispiel                # = Ordnername, stabil
name: Der Leuchtturm von Salzhafen   # Anzeigename in der UI
description: <Kurzbeschreibung, eine Zeile>
---
```

Body = freier Notizraum für Kampagnenweites. Weitere Frontmatter-Keys
(z. B. `system`) sind erlaubt und bleiben erhalten.

## Entität: Szene

```yaml
---
id: lighthouse-arrival      # slug, stabil, NIE ändern (Referenzen!)
title: Ankunft am Leuchtturm  # Anzeigename, frei änderbar
type: planned | contingency
trigger: <Freitext>         # nur bei contingency: wann feuert sie?
chapter: 01-salzhafen
location: leuchtturm        # id aus locations/ ODER freier String
npcs: [jorna, fenn]         # ids aus npcs/
handouts: ["Karte von Salzhafen"]  # Name des Roll20-Handouts, nur Verweis
tags: [social, travel]      # frei; empfohlen: combat, social, stealth, travel
status: draft | ready | played | dropped
---
```

### Abschnitte (H2)

| Überschrift        | Bedeutung                                            |
| ------------------ | ---------------------------------------------------- |
| `## Flow`          | Standardablauf, wenn nichts Besonderes passiert      |
| `## If: <Bedingung>` | Verzweigung; Bedingung ist Freitext (Deutsch). Wird einklappbar gerendert |
| alles andere       | normaler Abschnitt, keine Sonderbehandlung           |

### Callouts (Obsidian-Syntax)

| Callout          | Bedeutung / Rendering                                        |
| ---------------- | ------------------------------------------------------------ |
| `> [!readaloud]` | Vorlesetext — groß, serifig, Copy-Button für Roll20-Chat     |
| `> [!check]`     | Würfelmechanik (DCs, Contested Checks) — farblich auffällig  |
| `> [!secret]`    | Info, die Spieler NICHT haben — wird ins Weltwissen aggregiert |
| `> [!outcome]`   | Konsequenz über die Szene hinaus — Kandidat für Faden-Tracker |
| `> [!loot]`      | Beute / Gegenstände                                          |
| `> [!note]`      | Freitext-Marginal des DM                                     |

### Referenzen im Fließtext: `[[slug]]`

`[[jorna]]` in einem Body-Text ist eine Referenz auf eine Entität. Sie gilt in
jedem Body (Szene, NPC, Ort, Kapitel, Kampagnen-Notiz) und in jedem Callout.

- **Gespeichert wird immer der slug**, nie der Name. Den aktuellen Anzeigenamen
  setzt erst die Anzeige ein — nach einer Umbenennung stimmt der Text also
  überall, ohne dass eine Datei angefasst wird.
- Referenzierbar sind **NPC, Ort und Szene**. Kollidieren slugs über Arten
  hinweg, gewinnt **NPC > Ort > Szene**. Kapitel sind nicht referenzierbar.
- In den Klammern steht **nur der slug** in kebab-case (`[[alte-mole]]`); es
  gibt **keinen Anzeigetext** (`[[jorna|Jorna]]` ist normaler Text). Endungen
  stehen außerhalb: `[[jorna]]s Boot` → „Jornas Boot".
- **Code ist keine Prosa**: In Code-Blöcken und in `` `[[jorna]]` `` bleibt die
  Schreibweise wörtlich stehen — sie wird nicht aufgelöst, nicht indexiert und
  von einer Umbenennung nicht angefasst.
- In der Kopfzeile eines `## If:`-Zweigs erscheint der aufgelöste **Name als
  Text** (kein Link): der Klick faltet den Zweig.
- **Degradation**: Ein slug, den keine Entität hat, bleibt als `[[slug]]`
  sichtbar stehen — kein Fehler, und er wird lebendig, sobald die Entität
  existiert.
- Klick: in der Leseansicht ein Link zur Entität, im Live-Modus öffnet er die
  Detail-Schublade, ohne die Session zu verlassen.
- Bestehende Prosa bleibt unverändert — Namen im Text sind weiterhin erlaubt,
  nur eben nicht mitwandernd.

## Entität: NPC

```yaml
---
id: fenn
name: Fenn
role: <einzeiler>
chapter: 01-salzhafen           # wo eingeführt
status: alive | dead | missing | unknown
statblock: "Roll20: <Sheet-Name>"   # Verweis, KEINE Kopie
quickstats: { wis: +2, insight: +2, passive-perception: 13 }  # frei, nur was sozial gebraucht wird
voice: <wie klingt er/sie>
appearance: <1-2 Merkmale>
---
```

Abschnitte: `## Will` (Motivation), `## Weiß` (`[!secret]`-Callouts),
`## Beziehungen` (Liste `- <npc-id>: <Freitext>`), `## Notizen`
(wird von der App im Review-Schritt befüllt — nicht von Hand pflegen).

Kleinst-NPCs bekommen KEIN File, bis sie wiederkehren. Bis dahin: Zeile im
Szenentext oder `#npc`-Lognotiz.

> **Seit dem DB-Cutover (Issue #70):** Wer eine id REFERENZIERT, legt sie an.
> Trägt man in `npcs:` einer Szene, in `location:` (als Slug) oder in
> `## Beziehungen` eine unbekannte id ein, entsteht im selben Schreibvorgang
> ein LEERER Eintrag (id, Name = id, Status Default). Ein referenzierter
> Eintrag ist damit nie „fehlt", höchstens leer — leere Einträge rendern als
> normale, dünne Karten und sind normal befüllbar. Ausnahme und Grenze:
> `location:` darf auch freier Text sein; ein Wert, der KEIN Kebab-Slug ist
> (Leerzeichen, Großschreibung), bleibt reiner Text und bekommt keinen
> Eintrag. `npcs:` hat diese Freitext-Hälfte NICHT — dort steht eine id,
> ein neuer Eintrag ohne Slug-Form wird mit 400 abgelehnt (Bestand, den die
> Migration mitgebracht hat, bleibt lesbar und speicherbar). `chapter:` legt
> nichts an: ein unbekanntes Kapitel ist 400, bei Szene, NPC und Ort gleich.

## Entität: Ort

```yaml
---
id: leuchtturm
name: Der Leuchtturm von Salzhafen
chapter: 01-salzhafen
roll20-page: "Leuchtturm"       # Verweis auf die Page, keine Karten-Kopie
---
```

Abschnitte frei; empfohlen: `## Beim ersten Betreten` (mit `[!readaloud]`),
`## Atmosphäre`, `## Wer ist hier`.

## Entität: Session (von der App verwaltet)

```yaml
---
id: 019a4f3c-6d21-7b8e-9c04-5f1ab2d7e380   # opak, nur Adresse — nichts liest sie
started: 2026-08-19T19:32:41
ended: 2026-08-19T23:10:08      # gesetzt bei "Session beenden"
pauses: [{from: 2026-08-19T21:40:12, to: 2026-08-19T21:58:03}]   # Pausen, App-verwaltet
scenes_played: [lighthouse-arrival, smuggler-captured]   # automatisch gepflegt
reviewed: [a1b2c3d4]            # Kurzhashes gesichteter Log-Zeilen (Review-Schritt)
---
```

- `id`: eine opake Zufalls-id (UUID). Sie ist nur die Adresse der Datei;
  Reihenfolge, Datum und jede Anzeige kommen aus `started`. Ältere Dateien
  tragen ein Datum als id (`2026-08-19`, `2026-08-19-2`) — bleibt gültig,
  wird aber nicht mehr ausgewertet.
- `## Log`: append-only, Format `- HH:MM (scene-id) Text #hashtags`
  — Zeitstempel und Szenen-Kontext setzt die App automatisch.
- `## Threads`: Checkliste offener Fäden, im Review-Schritt befüllt.
- Timer = (`ended` ?? jetzt) − `started` − Summe der Pausen. Kein laufender
  Zustand im Client: den Epochen-Wert der zonenlosen Zeitstempel liefert der
  Server (nur er kennt die Zeitzone der Wanduhr-Ziffern).
- `started`/`ended` schreibt die App sekundengenau (`yyyy-mm-ddTHH:MM:SS`),
  damit die Uhr einer frisch gestarteten Session bei 0:00:00 beginnt und nicht
  mitten in der Minute. Minutengenaue Werte aus älteren Dateien und von Hand
  bleiben gültig — der Parser liest beide Breiten.
- `pauses`: Liste von `{from, to}` in derselben zonenlosen Lokalzeit wie
  started/ended, ebenfalls sekundengenau. Ein Eintrag OHNE `to` heißt „läuft
  gerade in einer Pause" — dann steht die Uhr. „Session beenden" schließt
  eine offene Pause. Handeditierbar; degradiert wie alles andere: kaputte
  Einträge (fehlendes/unlesbares `from`, unlesbares `to`) werden ignoriert,
  nie ein Fehler.
- Pause schreibt zusätzlich die Log-Zeile `— Pause`, „Weiter" die Zeile
  `— Weiter` — das Log bleibt die lesbare Chronik des Abends.
- `reviewed`: von der App im Review-Schritt gepflegt. Ein Eintrag ist der
  Kurzhash (erste 8 Hex-Zeichen von SHA-256) der ROHEN Log-Zeile — so
  bleibt `## Log` strikt append-only und externes Umsortieren ist egal.

### Review-Aktionen (App-verwaltet)

- „Als Faden übernehmen" → append `- [ ] <Text>` unter `## Offene Fäden`
  der `_chapter.md` des aktiven Kapitels (Abschnitt wird angelegt, wenn er
  fehlt).
- „NPC-Stub anlegen" → erzeugt `npcs/<slug>.md` mit Minimal-Frontmatter
  (`status: alive` — wer am Tisch auftaucht, lebt; Ausnahmen stellt der
  DM um) und dem Log-Text unter `## Notizen`. Existiert der
  Slug, meldet die App einen Konflikt statt zu überschreiben.
- Erledigte Inbox-Einträge werden zu `- [x] …` umgeschrieben — die EINE
  dokumentierte Ausnahme vom Append-only der Inbox, damit erledigte Ideen
  nicht in jeder künftigen Review wieder auftauchen.

### Hashtags im Log (Konvention, App filtert danach)

`#thread` offener Faden · `#npc` improvisierter NPC · `#loot` Beute ·
`#decision` Spieler-Entscheidung · `#date` In-Game-Datum (z. B. `#date Tag 4`)

## Inbox

`inbox.md` — append-only, gleiche Hashtag-Konventionen wie das Session-Log,
aber sessionunabhängig. Wird im Review-Schritt zusammen mit dem Log gezeigt.

## Schreibregeln

- Geschrieben wird ausschließlich über die API (`server/src/server.ts` führt
  die Endpoints auf): Session-Logs, Inbox, Frontmatter-Patches, Body-Edits,
  Review-Aktionen, Generator-Drafts, Rename.
- Ein externer Editor auf dem Dateibaum wirkt **nicht** mehr: die Datenbank
  ist die Wahrheit, die Altdateien bleiben unangetastet liegen und werden
  ignoriert (ADR #13).
- Konfliktschutz: jeder Patch trägt das Guard-Token mit, das der Lesevorgang
  geliefert hat (`mtimeMs` im Wire-Format, intern die Zeilenversion `rev`).
  Passt es nicht mehr, antwortet der Server 409 und die App sagt „Inzwischen
  geändert — neu laden" statt still zu überschreiben.
- Append-only bleibt Regel für Session-Log und Inbox (ADR #4); die eine
  dokumentierte Ausnahme ist das Abhaken erledigter Inbox-Zeilen.

## Generator

Siehe `generator/README.md`. Kurzfassung: Quelltext (EN) rein →
Szenen-Drafts (DE, dieses Format) raus, immer `status: draft`,
immer mit Review-Vorschau vor dem Speichern.
