# Grimoire — Datenformat & Konventionen

Ein **Dokument** ist eine Zeile in der SQLite-Datenbank
(`GRIMOIRE_DATA/grimoire.db`, ADR #13), angesprochen über eine **Adresse**.
`GET /api/:campaign/file?path=…` liefert sie als `properties` (die Spalten,
in Vertragsreihenfolge) plus `body` (Markdown). Die Speicherform steht genau
einmal in `server/src/db/schema.ts`, das Adressschema genau einmal in
`server/src/store/paths.ts` — dieses Dokument beschreibt, was in den beiden
Hälften stehen darf.

Alle **Keys sind Englisch** (stabil, maschinenlesbar), alle **Inhalte
Deutsch**. Grundprinzip: **Das Format degradiert, es validiert nicht** —
unbekannte Überschriften und Callouts werden als normaler Text gerendert,
nichts bricht.

Markdown ist das Inhaltsformat der Bodies, nicht die Speicherform. Wer einen
Markdown-Baum einlesen will, findet das Import-Format im Anhang.

## Adressen

Adressen tragen **keine Dateiendung**. Das vollständige Schema:

| Adresse | Dokument |
| ------- | -------- |
| `_campaign` | die Kampagne |
| `inbox` | die Inbox-Liste |
| `glossary` | das Glossar |
| `<kapitel>/_chapter` | ein Kapitel |
| `<kapitel>/<szenen-id>` | eine Szene |
| `<kapitel>/<orts-id>/<szenen-id>` | eine Szene, die diesen Ort nennt |
| `npcs/<id>` | ein NPC |
| `locations/<id>` | ein Ort |
| `sessions/<id>` | eine Session |

Die Adresse einer Szene ist ihre `id`, nie ein Anzeigename. Ids entstehen beim
Anlegen in der UI aus dem getippten Namen, nach genau einer Regel
(`@grimoire/shared/slug`), und bleiben dann, wie sie sind — Umbenennen ist ein
eigener Vorgang mit Referenz-Kaskade.

**Die Gruppe einer Szene IST ihr `location` (Issue #100).** Es gibt kein
eigenes Gruppenfeld: Adresse und Kapitelübersicht werden aus `location`
abgeleitet, eine Szene ohne `location` liegt auf Kapitelebene (die App zeigt
sie unter „Ohne Ort"). Ändert der DM `location`, zieht die Szene um — die alte
Adresse zeigt weiter auf dieselbe Szene, der Server antwortet mit der neuen
und die App ersetzt die URL (ADR #17).

**Kein Dokument, sondern eine Liste:** das **Kampagnenwissen** (Issue #53 —
Namenskonventionen, Fakten, Stilregeln für den Generator) hat keine Adresse
und kein Markdown-Format. Es entsteht in der UI (`/settings`) und wird über
`GET/PUT /api/:campaign/knowledge` gepflegt. Das Glossar ist derselbe Fall mit
einer Ausnahme: es hat aus historischen Gründen zusätzlich die Adresse
`glossary`.

## Eigenschaften je Entität

Die Keys sind verbindlich — sie sind die Spalten des Schemas und heißen auf
der Leitung `properties`. Unbekannte Keys bleiben erhalten (Spalte `extra`).

### Kampagne

```yaml
id: beispiel                # stabil
name: Der Leuchtturm von Salzhafen   # Anzeigename in der UI
description: <Kurzbeschreibung, eine Zeile>
```

Das Dokument existiert immer (die Kampagnen-Zeile IST es); ohne eigenen Namen
ist der Anzeigename die id. Body = freier Notizraum für Kampagnenweites.

### Szene

```yaml
id: lighthouse-arrival      # slug, stabil, NIE ändern (Referenzen!)
title: Ankunft am Leuchtturm  # Anzeigename, frei änderbar
type: planned | contingency
trigger: <Freitext>         # nur bei contingency: wann feuert sie?
chapter: 01-salzhafen
location: leuchtturm        # Orts-id — zugleich die Gruppe der Szene
npcs: [jorna, fenn]         # NPC-ids
handouts: ["Karte von Salzhafen"]  # Name des Roll20-Handouts, nur Verweis
tags: [social, travel]      # frei; empfohlen: combat, social, stealth, travel
status: draft | ready | played | dropped
```

### NPC

```yaml
id: fenn
name: Fenn
role: <einzeiler>
chapter: 01-salzhafen           # wo eingeführt
status: alive | dead | missing | unknown
statblock: "Roll20: <Sheet-Name>"   # Verweis, KEINE Kopie
quickstats: { wis: +2, insight: +2, passive-perception: 13 }  # frei, nur was sozial gebraucht wird
voice: <wie klingt er/sie>
appearance: <1-2 Merkmale>
```

Abschnitte: `## Will` (Motivation), `## Weiß` (`[!secret]`-Callouts),
`## Beziehungen` (Liste `- <npc-id>: <Freitext>`), `## Notizen`
(wird von der App im Review-Schritt befüllt — nicht von Hand pflegen).

Kleinst-NPCs bekommen KEINEN eigenen Eintrag, bis sie wiederkehren. Bis
dahin: Zeile im Szenentext oder `#npc`-Lognotiz.

### Ort

```yaml
id: leuchtturm
name: Der Leuchtturm von Salzhafen
chapter: 01-salzhafen
roll20-page: "Leuchtturm"       # Verweis auf die Page, keine Karten-Kopie
```

Abschnitte frei; empfohlen: `## Beim ersten Betreten` (mit `[!readaloud]`),
`## Atmosphäre`, `## Wer ist hier`.

### Session (von der App verwaltet)

```yaml
id: 019a4f3c-6d21-7b8e-9c04-5f1ab2d7e380   # opak, nur Adresse — nichts liest sie
started: 2026-08-19T19:32:41
ended: 2026-08-19T23:10:08      # gesetzt bei "Session beenden"
pauses: [{from: 2026-08-19T21:40:12, to: 2026-08-19T21:58:03}]   # Pausen, App-verwaltet
scenes_played: [lighthouse-arrival, smuggler-captured]   # automatisch gepflegt
reviewed: [a1b2c3d4]            # Kurzhashes gesichteter Log-Zeilen (Review-Schritt)
```

- `id`: eine opake Zufalls-id (UUID). Sie ist nur die Adresse; Reihenfolge,
  Datum und jede Anzeige kommen aus `started`. Ältere Sessions tragen ein
  Datum als id (`2026-08-19`, `2026-08-19-2`) — bleibt gültig, wird aber
  nicht mehr ausgewertet.
- `## Log`: append-only, Format `- HH:MM (scene-id) Text #hashtags`
  — Zeitstempel und Szenen-Kontext setzt die App automatisch.
- `## Threads`: Checkliste offener Fäden, im Review-Schritt befüllt.
- Timer = (`ended` ?? jetzt) − `started` − Summe der Pausen. Kein laufender
  Zustand im Client: den Epochen-Wert der zonenlosen Zeitstempel liefert der
  Server (nur er kennt die Zeitzone der Wanduhr-Ziffern).
- `started`/`ended` schreibt die App sekundengenau (`yyyy-mm-ddTHH:MM:SS`),
  damit die Uhr einer frisch gestarteten Session bei 0:00:00 beginnt und nicht
  mitten in der Minute. Minutengenaue Werte aus älteren Beständen bleiben
  gültig — der Parser liest beide Breiten.
- `pauses`: Liste von `{from, to}` in derselben zonenlosen Lokalzeit wie
  started/ended, ebenfalls sekundengenau. Ein Eintrag OHNE `to` heißt „läuft
  gerade in einer Pause" — dann steht die Uhr. „Session beenden" schließt
  eine offene Pause. Degradiert wie alles andere: kaputte Einträge
  (fehlendes/unlesbares `from`, unlesbares `to`) werden ignoriert, nie ein
  Fehler.
- Pause schreibt zusätzlich die Log-Zeile `— Pause`, „Weiter" die Zeile
  `— Weiter` — das Log bleibt die lesbare Chronik des Abends.
- `reviewed`: von der App im Review-Schritt gepflegt. Ein Eintrag ist der
  Kurzhash (erste 8 Hex-Zeichen von SHA-256) der ROHEN Log-Zeile — so
  bleibt `## Log` strikt append-only.

## Weiche Referenzen: Referenzieren legt an

Wer eine id REFERENZIERT, legt sie an (Issue #70). Trägt man in `npcs:` einer
Szene, in `location:` oder in `## Beziehungen` eine unbekannte id ein,
entsteht im selben Schreibvorgang ein LEERER Eintrag (id, Name = id, Status
Default). Ein referenzierter Eintrag ist damit nie „fehlt", höchstens leer —
leere Einträge rendern als normale, dünne Karten und sind normal befüllbar.

In `location:` steht eine id; ein Wert ohne Slug-Form wird mit 400 abgelehnt
(Issue #100 — die id ist zugleich die Gruppe der Szene). `chapter:` legt
nichts an: ein unbekanntes Kapitel ist 400, bei Szene, NPC und Ort gleich.

## Body-Vokabular

Der `body` ist Markdown und gehört dem Inhalt. Was der Renderer versteht —
und was der Generator produzieren muss:

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

### Tabellen (GFM-Pipe-Tabellen)

Das einzige aus GFM übernommene Konstrukt — für Zufallstabellen und
Begegnungslisten, die als Prosa unlesbar wären. Die Syntax: **Kopfzeile**,
**Trennzeile** aus `|---|` (eine Zelle je Spalte) und **Rand-Pipes** links und
rechts in jeder Zeile. Tabellen gelten in jedem Body, in **jedem Callout** und
in `## If:`-Abschnitten.

```markdown
> [!note] Zufallsbegegnung an der Bucht
>
> | W6 | Was die Brandung anschwemmt |
> | --- | --- |
> | 1–2 | Ein leeres Fass mit fremdem Brandzeichen |
> | 3–4 | Ein Ruder, frisch gekerbt |
> | 5–6 | Eine Laterne, das Glas rußgeschwärzt |
```

(Im Callout steht die Tabelle unter demselben `>`-Block wie der Text — siehe
`examples/beispiel/01-salzhafen/hafen/ankunft-leuchtturm.md`.)

- **Nur Tabellen.** Kein Durchgestrichen (`~~x~~`), **keine Aufgabenlisten**,
  keine Auto-Links, keine Fußnoten. `- [x]` bleibt bewusst normaler
  Listentext: es ist die Abhak-Syntax der Inbox, kein Kontrollkästchen.
- **Degradation wie überall**: Eine Zeile mit Pipes ohne gültige Trennzeile
  ist keine Tabelle, sondern Text — nichts bricht.
- **Anzeige**: Die Tabelle scrollt in einem eigenen Container; auf dem Handy
  scrollt die Tabelle, nie die Seite.
- **Block-Composer**: Eine Tabelle ist kein eigener Blocktyp, sondern Teil des
  Text- bzw. Callout-Blocks; sie wird als Markdown bearbeitet.

### Referenzen im Fließtext: `[[slug]]`

`[[jorna]]` in einem Body-Text ist eine Referenz auf eine Entität. Sie gilt in
jedem Body (Szene, NPC, Ort, Kapitel, Kampagnen-Notiz) und in jedem Callout.

- **Gespeichert wird immer der slug**, nie der Name. Den aktuellen Anzeigenamen
  setzt erst die Anzeige ein — nach einer Umbenennung stimmt der Text also
  überall, ohne dass ein Body angefasst wird.
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

### Hashtags im Log (Konvention, App filtert danach)

`#thread` offener Faden · `#npc` improvisierter NPC · `#loot` Beute ·
`#decision` Spieler-Entscheidung · `#date` In-Game-Datum (z. B. `#date Tag 4`)

`#pc` Notiz zu einem Spielercharakter. Ein optionaler zweiter Tag benennt den
Charakter (`#pc #kaela`); die Namen sind frei, es gibt keine PC-Entität und
nichts zu pflegen. Die Nachbereitung sammelt solche Zeilen im Abschnitt
„Spielercharaktere", gruppiert nach dem zweiten Tag (ohne zweiten Tag:
„Allgemein"). `#pc` gewinnt gegen die übrigen Tags: die Zeile wird nicht als
Handlungsstrang oder NPC angeboten, sondern nur abgehakt („Erledigt") oder
offen gelassen („Behalten") — PC-Notizen sind Erinnerungen für den Tisch,
kein Kampagneninhalt.

## Inbox

`inbox` — append-only, gleiche Hashtag-Konventionen wie das Session-Log,
aber sessionunabhängig. Wird im Review-Schritt zusammen mit dem Log gezeigt.

## Review-Aktionen (App-verwaltet)

- „Als Handlungsstrang übernehmen" → append `- [ ] <Text>` unter
  `## Offene Fäden` von `<kapitel>/_chapter` des aktiven Kapitels (Abschnitt
  wird angelegt, wenn er fehlt).
- „NPC-Stub anlegen" → erzeugt `npcs/<slug>` mit Minimal-Eigenschaften
  (`status: alive` — wer am Tisch auftaucht, lebt; Ausnahmen stellt der DM
  um) und dem Log-Text unter `## Notizen`. Existiert der Slug, meldet die App
  einen Konflikt statt zu überschreiben.
- Erledigte Inbox-Einträge werden zu `- [x] …` umgeschrieben — die EINE
  dokumentierte Ausnahme vom Append-only der Inbox, damit erledigte Ideen
  nicht in jeder künftigen Review wieder auftauchen.

## Schreibregeln

- Geschrieben wird ausschließlich über die API (`server/src/server.ts` führt
  die Endpoints auf): Session-Logs, Inbox, `PATCH /properties`, Body-Edits,
  Review-Aktionen, Generator-Drafts, Rename.
- Konfliktschutz: jeder Patch trägt das Guard-Token mit, das der Lesevorgang
  geliefert hat (`rev`, die Zeilenversion). Passt es nicht mehr, antwortet der
  Server 409 und die App sagt „Inzwischen geändert — neu laden" statt still zu
  überschreiben.
- Append-only bleibt Regel für Session-Log und Inbox (ADR #4); die eine
  dokumentierte Ausnahme ist das Abhaken erledigter Inbox-Zeilen.

## Generator

Siehe `generator/README.md`. Kurzfassung: Quelltext (EN) rein →
Szenen-Drafts (DE, dieses Format) raus, immer `status: draft`,
immer mit Review-Vorschau vor dem Speichern.

Ein Szenen-Lauf ist eine **Pipeline** (#102): ein Gliederungs-Aufruf legt die
Szenen und ihre ids fest, danach wird jede Szene und jeder neue Eintrag
einzeln geschrieben. Ein Formfehler kostet damit nur den betroffenen Teil,
fertige Szenen sind sofort prüfbar, und ein defekter Teil lässt sich einzeln
wiederholen. Die Gliederung ist ein systeminterner Schritt — sie wird nie
angezeigt.

## Anhang: Import-Format für `grimoire seed`

Ein Markdown-Baum ist **Eingabe**, keine Speicherform: das Dev-/E2E-Werkzeug
`grimoire seed [dir]` liest ihn (Default `examples/`, Report auf stdout, siehe
`docs/DEPLOYMENT.md` Abschnitt 2b). Der Server importiert nichts — eine
frische Instanz startet leer. Referenz des Formats ist die committete
Beispielkampagne unter `examples/`; sie ist zugleich die Fixture-Quelle von
Tests und E2E und wird deshalb nie umformatiert.

Die Eigenschaften einer Entität stehen im Baum als YAML-Frontmatter-Block
(`---` … `---`) über dem Body; die Keys sind dieselben wie oben. Dateinamen
sind **kein** Teil der Identität — die `id` aus dem Frontmatter gewinnt, und
was der Import nicht versteht, landet verbatim in `unknown_files` samt Eintrag
im Migrations-Report: nichts geht verloren, nichts bricht ab.

```
examples/                  # generische Beispielkampagne — committet, Format-Referenz
  <campaign-id>/
    _campaign.md            # optional: Anzeigename, Beschreibung
    <chapter>/              # z. B. 01-salzhafen
      _chapter.md           # Kapitelnotizen, offene Fäden
      <orts-id>/            # Ort-Gruppierung; der Import setzt daraus
                            # `location`, wenn die Szene keines nennt
        <scene>.md
    npcs/<id>.md
    locations/<id>.md
    sessions/<id>.md
    inbox.md                   # Ideen-Eingang, append-only
    glossary.md                # Übersetzungs-Glossar für den Generator
```

Fehlt die `_campaign.md`, heißt die Kampagne wie ihr Ordner.
