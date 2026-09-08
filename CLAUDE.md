# CLAUDE.md — Grimoire

Grimoire ist ein selbst gehostetes Einzelnutzer-Tool für einen D&D-Spielleiter:
Session-Vorbereitung und Live-Moderation über einer Kampagnen-Datenbank
(SQLite, ADR #13; Markdown ist das Inhaltsformat der Bodies).
Es ist KEIN VTT, KEIN Kampagnen-Wiki und hat KEINE Spieler-Ansicht.

## Pflichtlektüre vor jeder Aufgabe

1. `README.md` — Datenformat und Konventionen. Achtung auf die Zweiteilung
   (ADR #13): Ordnerstruktur/Dateinamen sind das **Import-Format
   (historisch)**, das Body-Vokabular (Callouts, `If:`-Abschnitte, Hashtags)
   und die Frontmatter-Keys sind **normativ**
2. `docs/DECISIONS.md` — Architektur-Entscheidungen inkl. Tech-Stack. Entscheidungen dort sind bindend; Abweichungen nur mit neuem Eintrag.
3. `docs/UI-BRIEF.md` — Design-Richtung für alles Sichtbare

## Stack (Kurzfassung, Details in docs/DECISIONS.md #5)

- Frontend: Vite + React 19 + Tailwind v4 + shadcn/ui, TanStack Query,
  react-markdown + eigenes Remark-Plugin für Callouts und `## If:`
- Backend: Bun + Hono, SQLite über Drizzle (`server/src/db/`), Suche als
  FTS5-Index, gray-matter nur noch im Import-/Parser-Pfad
- Speicher: **eine SQLite-Datei ist die Quelle der Wahrheit** (ADR #13),
  `GRIMOIRE_DATA/grimoire.db`
- Regel: Keine Bun-only-APIs ohne Eintrag in docs/DECISIONS.md
  (Node-Portabilität). Eingetragen ist genau eine: `bun:sqlite` als Fallback
  hinter `server/src/db/driver.ts`

## Projektstruktur

- `examples/` — generische Beispielkampagne (committet). Sie ist der **Seed**
  für Dev/Tests/E2E (der echte Import liest sie, es gibt keine zweiten
  Fixtures) und die Referenz des Import-Formats. NIE umformatieren oder
  „aufräumen"; das Format ist Vertrag.
- `campaigns/` — echte Kampagnendaten als Markdown-Baum, in `.gitignore`
  (Nutzungsdaten, ggf. urheberrechtlich geschütztes Quellmaterial). Seit
  Issue #79 liest der Server **keinen** Kampagnen-Dateibaum mehr — nur
  `grimoire seed <dir>` tut es, wenn man es ihm ausdrücklich sagt. Im Code
  nie fest verdrahten.
- `GRIMOIRE_DATA` (Default `./data`, gitignored) — hier liegt
  `grimoire.db` samt `-wal`/`-shm`: die eigentlichen Daten. Kein Code liest
  Kampagneninhalte von woanders.
- `shared/` — Entitäts-Typen und Markdown-Parser (`@grimoire/shared`),
  von Server und App gemeinsam genutzt. Das Datenformat ist hier genau
  einmal in Code beschrieben (Spiegel von README.md — beides synchron halten);
  die Speicherform steht genau einmal in `server/src/db/schema.ts`.
- `server/` — Hono-API. Geplante Endpoints sind in `server/src/server.ts`
  dokumentiert und dort abzuhaken, wenn implementiert. Datenzugriff
  ausschließlich über `server/src/store/` (Queries), nie direkt SQL aus einer
  Route.
- `app/` — das Frontend (bei erster UI-Aufgabe anlegen: Vite-Scaffold).
- `generator/` — LLM-Pipeline (Prompt, Few-Shot, Ablauf-README).
- `design/` — verbindliche Design-Referenz (Claude-Design-Export des PO,
  siehe design/README.md). Bei Widerspruch zu docs/UI-BRIEF.md gewinnt design/.
- `docs/` — die längeren Dokumente: `DECISIONS.md` (bindende ADRs),
  `UI-BRIEF.md` (Design-Intention), `DEPLOYMENT.md` (Betrieb).
  `README.md` und `CLAUDE.md` bleiben im Root (Tooling-Konvention).

## Arbeitsweise

- Vertikale Scheiben, eine pro Auftrag. Nicht mehrere Views gleichzeitig.
- Gegen echte Daten entwickeln: keine erfundenen Mock-Objekte. Seit dem
  SQLite-Cutover (ADR #13) ist die Datenbank die Wahrheit, und seit Issue #79
  startet der Server **leer**: einmal
  `bun run --filter @grimoire/server seed` (liest `examples/`) füllt
  `GRIMOIRE_DATA/grimoire.db`. Tests bekommen pro Fall eine
  frische In-Memory-DB, geseedet über denselben Importer
  (`server/test/support/store.ts`). `campaigns/` existiert nur lokal beim
  Nutzer und darf in Code, Tests und Doku nie vorausgesetzt werden.
- Der Callout-Renderer (`[!readaloud]`, `[!check]`, `[!secret]`,
  `[!outcome]`, `[!loot]`, `[!note]`) ist die zentrale Komponente —
  Änderungen daran immer gegen
  `examples/beispiel/01-salzhafen/hafen/von-schmugglern-erwischt.md`
  und `.../ankunft-leuchtturm.md` prüfen.
- Format degradiert: unbekannte Callouts/Überschriften als normalen Text
  rendern, niemals Fehler werfen.
- Schreibzugriffe der App nur über die dokumentierte API; Patches tragen das
  Guard-Token des Lesevorgangs mit (`rev`, die Zeilenversion) — 409 bei
  Konflikt, nie stilles Überschreiben.
- Adressen tragen keine Dateiendung (`npcs/jorna`, `<kapitel>/<szenen-id>`,
  `sessions/<id>`, `_campaign`, `glossary`); das Schema steht in
  `server/src/store/paths.ts`. Auf der Leitung heißen die Felder eines
  Dokuments `properties` — `frontmatter`/`mtime` gibt es nur noch im
  Markdown-Importer unter `server/src/db/` (Issue #79).
- Sprache der UI: Deutsch. Code, Kommentare, Commits: Englisch.

## Backlog-Prozess

- Der PO kippt Ideen als Issues mit Label `idee` ein (Template „Idee") —
  formlos, Freitext genügt.
- Refinement findet IM Issue statt: Rückfragen als Kommentare stellen;
  danach den Issue-Body zum Ticket ausbauen — User Story („Als DM will
  ich … damit …"), Akzeptanzkriterien (nachprüfbar), Scope/Nicht-Ziele,
  Abhängigkeiten. Erst nach PO-Ok im Thread: Label `idee` → `ready`.
- Das Team nimmt nur `ready`-Tickets. Übernahme = Label „in Arbeit" +
  Kommentar mit Zuschnitt; fertig = Schließen mit Commit-Verweis.
- Zu Beginn jeder Arbeitssitzung: offene `idee`-Issues sichten, bevor
  neue Arbeit startet.
- Vor dem Merge einer Scheibe mit UI-Anteil läuft der Lead den echten
  Klickpfad selbst (Server + gebaute App, Produktions-Topologie) —
  Agent-Smoke-Berichte ersetzen das nicht.

## Branch- & PR-Prozess (main ist produktiv)

- KEINE Direkt-Pushes auf main. (Serverseitige Branch-Protection ist im
  Free-Plan für private Repos nicht verfügbar — die Regel ist prozessual
  bindend; bei Wechsel auf Pro/public wird sie technisch erzwungen.)
- Jedes Ticket: eigener Worktree + Feature-Branch (`<nr>-<slug>`),
  Ergebnis als PR. Merge-Voraussetzungen: CI grün (Tests, Typecheck,
  Build, E2E), Lead-Klickpfad, UND PO-Approval auf dem PR.
- main ist per Definition deploybar, veröffentlicht aber nichts: Images
  entstehen nur beim Release (DECISIONS #12). Der PO pullt bewusst einen
  Versions-Tag (nie direkt vor einer Session); Rollback = älterer
  Versions-Tag.

## Commit- & Release-Konventionen (DECISIONS #12)

- **Conventional Commits sind Pflicht**, sie erzeugen den Changelog:
  `feat: …` (Minor), `fix: …` (Patch), `docs:`/`chore:`/`refactor:`/`test:`/
  `ci:` (kein Release-Bump). Breaking Change = `feat!: …` oder ein
  `BREAKING CHANGE:`-Footer im Body. Scope optional, aber üblich:
  `feat(app): …`, `fix(server): …`. Die Ticketnummer gehört in den
  Betreff-Suffix: `feat(app): Szenen-Editor (#43)`.
- Das gilt auch für den **PR-Titel**: Squash-Merges übernehmen ihn als
  Commit-Betreff auf `main`, ein unkonventioneller Titel fällt aus dem
  Changelog.
- **release-please** hält aus diesen Commits einen Release-PR
  („chore(main): release X.Y.Z"). Erst dessen Merge — mit PO-Approval wie
  jeder PR — erzeugt Tag `vX.Y.Z`, GitHub-Release, `CHANGELOG.md` und das
  GHCR-Image mit Versions-Tag und `:latest`. Manuell wird nie getaggt und
  `CHANGELOG.md`/`.release-please-manifest.json` nie von Hand editiert.
- **`:latest` heißt „letzter Release", nicht „letzter Merge".** Der
  Release-Workflow ist der einzige Schreiber der GHCR-Registry; `ci.yml`
  baut das Image zur Prüfung (`push: false`), pusht es aber nie (#66).

## Kritische Pfade (E2E-Pflicht, echte Suite ohne Mocks)

Playwright gegen den echten Stack (realer Server auf einer eigenen, aus
`examples/` importierten DB, gebaute App, echter Browser; einzige Ausnahme:
das LLM ist ein lokaler Stub-HTTP-Server — der Provider-Pfad läuft real).
Die Pfade:

1. Auto-Einstieg `/` → Pool lädt die Kampagne
2. Szene lesen: Callouts, If-Sections, NPC-Karten der Referenzszenen
3. ⌘K-Suche findet und öffnet
4. Session-Zyklus: starten → Schnellnotiz → Log + scenes_played →
   Pause → beenden → Review
5. Ernte: Thread übernehmen → _chapter.md; Inbox abhaken
6. Generator-Zyklus (Stub-LLM): Job → Review → Übernehmen → draft im
   Pool; plus 409-/Fehlerpfad und Server-Neustart (fertiger Job übersteht
   ihn und bleibt übernehmbar, laufender wird als `failed` gemeldet)
7. Eigenschaften-Patch (`PATCH /properties`)/Status-Regler inkl. 409-Konflikt
8. Mobil-Startfläche + Inbox-Einwurf bei 390px
9. Datei bearbeiten: öffnen → Body ändern → speichern → gerendert
   sichtbar; 409 bei konkurrierendem Zweit-Write → neu laden statt still
   überschreiben (seit ADR #13 gibt es keine externe Dateiänderung mehr —
   der Guard ist die Zeilenversion `rev`)
10. Kaltstart: leere Instanz ohne Seed — seit ADR #13/#79 der Normalfall
    einer frischen Installation → Kampagne anlegen → Kapitel → Szene →
    Szene befüllen → Session starten → Szene in der Live-Ansicht
    nutzbar; dazu NPC/Ort anlegen aus ihren Listen und die
    Slug-Kollision (409 mit Vorschlag, schreibt nichts)

Regel für neue Features: Jedes ready-Ticket benennt die berührten
kritischen Pfade; wer einen berührt oder schafft, erweitert die
E2E-Suite im selben PR — sonst kein Merge.

## Qualitäts-Boden (nicht verhandelbar)

- Responsive bis Mobil (Mobile = Suche, Leseansicht, Inbox — siehe UI-BRIEF)
- Dark Mode ist der Primärmodus, Light Mode muss funktionieren
- Tastatur-Fokus sichtbar; `prefers-reduced-motion` respektieren
- Keine localStorage-Persistenz für Daten — der Server ist die Wahrheit
