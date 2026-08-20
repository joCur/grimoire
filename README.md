# Grimoire — Datenformat & Konventionen

Source of Truth ist dieser Ordner: Markdown-Dateien mit YAML-Frontmatter.
Alle **Keys sind Englisch** (stabil, maschinenlesbar), alle **Inhalte Deutsch**.
Grundprinzip: Das Format degradiert, es validiert nicht — unbekannte
Überschriften und Callouts werden als normaler Text gerendert, nichts bricht.

## Ordnerstruktur

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
    sessions/<yyyy-mm-dd>.md   # von der App verwaltet
    inbox.md                   # Ideen-Eingang, append-only
    glossary.md                # Übersetzungs-Glossar für den Generator
```

## Entität: Kampagne (optional)

`_campaign.md` im Kampagnen-Root — Gegenstück zur `_chapter.md`-Konvention.
Fehlt die Datei, zeigt die UI den Ordnernamen; nichts bricht.

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
id: 2026-08-19
started: 2026-08-19T19:32
ended: 2026-08-19T23:10         # gesetzt bei "Session beenden"
scenes_played: [lighthouse-arrival, smuggler-captured]   # automatisch gepflegt
reviewed: [a1b2c3d4]            # Kurzhashes gesichteter Log-Zeilen (Review-Schritt)
---
```

- `## Log`: append-only, Format `- HH:MM (scene-id) Text #hashtags`
  — Zeitstempel und Szenen-Kontext setzt die App automatisch.
- `## Threads`: Checkliste offener Fäden, im Review-Schritt befüllt.
- Timer = jetzt − `started`. Kein laufender Zustand, reine Anzeige.
- Pause = Log-Eintrag, keine Timer-Logik.
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

## Schreibregeln (App vs. Editor)

- App schreibt: Session-Logs, Inbox, Status-/Frontmatter-Patches,
  Review-Aktionen (NPC-Stubs, Thread-Übernahme), Generator-Drafts.
- Editor (VS Code Remote o. ä.) schreibt: alle Inhalte.
- Konfliktschutz: App patcht nur bei unverändertem mtime seit dem Lesen,
  sonst „Datei extern geändert — neu laden".

## Generator

Siehe `generator/README.md`. Kurzfassung: Quelltext (EN) rein →
Szenen-Drafts (DE, dieses Format) raus, immer `status: draft`,
immer mit Review-Vorschau vor dem Speichern.
