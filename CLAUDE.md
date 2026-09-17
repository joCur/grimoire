# CLAUDE.md — Grimoire

Grimoire ist ein selbst gehostetes Einzelnutzer-Tool für einen D&D-Spielleiter:
Session-Vorbereitung und Live-Moderation über einer Kampagnen-Datenbank
(SQLite, ADR #13; Markdown ist das Inhaltsformat der Bodies).
Es ist KEIN VTT, KEIN Kampagnen-Wiki und hat KEINE Spieler-Ansicht.

## Pflichtlektüre vor jeder Aufgabe

1. `README.md` — Datenmodell und Konventionen: Einträge, ihre
   Eigenschaften und Adressen, das Text-Vokabular (Callouts,
   `If:`-Abschnitte, Hashtags) und die Schreibregeln. Alles davon ist
   normativ.
2. `docs/DECISIONS.md` — Architektur-Entscheidungen inkl. Tech-Stack. Entscheidungen dort sind bindend; Abweichungen nur mit neuem Eintrag.
3. `docs/UI-BRIEF.md` — Design-Richtung für alles Sichtbare

## Stack (Kurzfassung, Details in docs/DECISIONS.md #5)

- Frontend: Vite + React 19 + Tailwind v4 + shadcn/ui, TanStack Query,
  react-markdown + eigenes Remark-Plugin für Callouts und `## If:`
- Backend: Bun + Hono, SQLite über Drizzle (`server/src/db/`), Suche als
  FTS5-Index
- Speicher: **eine SQLite-Datei ist die Quelle der Wahrheit** (ADR #13),
  `GRIMOIRE_DATA/grimoire.db`
- Regel: Keine Bun-only-APIs ohne Eintrag in docs/DECISIONS.md
  (Node-Portabilität). Eingetragen ist genau eine: `bun:sqlite` als Fallback
  hinter `server/src/db/driver.ts`

## Projektstruktur

- `fixtures/` — die Beispielkampagne als JSON-Einträge
  (`fixtures/beispiel/*.json`), ein Eintrag je Datei in der Form der API
  (`properties` + `body`; Sessions, Ideen und Glossar strukturiert). Sie ist
  der **Seed** für Dev/Tests/E2E und die Referenz für Callouts. Bodies NIE
  umformatieren oder „aufräumen"; das Format ist Vertrag.
- `GRIMOIRE_DATA` (Default `./data`, gitignored) — hier liegt
  `grimoire.db` samt `-wal`/`-shm`: die eigentlichen Daten. Kein Code liest
  Kampagneninhalte von woanders.
- `shared/` — Entitäts-Typen (`@grimoire/shared`), von Server und App
  gemeinsam genutzt. Autorität über das Format sind
  `server/src/db/schema.ts` (Speicherform) und `server/src/store/paths.ts`
  (Adressen), beschrieben in README.md — die drei synchron halten;
  `shared/src/parse.ts` ist der Entwurfs-Parser des Generators.
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
- Gegen echte Daten entwickeln: keine erfundenen Mock-Objekte. Die Datenbank
  ist die Wahrheit (ADR #13), und der Server startet **leer**: einmal
  `bun run --filter @grimoire/server seed` (liest `fixtures/`) füllt
  `GRIMOIRE_DATA/grimoire.db`. Tests bekommen pro Fall eine frische
  In-Memory-DB, geseedet aus denselben Fixtures
  (`server/test/support/store.ts`). `campaigns/` existiert nur lokal beim
  Nutzer und darf in Code, Tests und Doku nie vorausgesetzt werden.
- Der Callout-Renderer (`[!readaloud]`, `[!check]`, `[!secret]`,
  `[!outcome]`, `[!loot]`, `[!note]`) ist die zentrale Komponente —
  Änderungen daran immer gegen die Referenzszenen
  `fixtures/beispiel/scene-lighthouse-arrival.json` und
  `scene-smuggler-captured.json` prüfen, sichtbar im Dev-Harness
  `/dev/markdown`.
- Format degradiert: unbekannte Callouts/Überschriften als normalen Text
  rendern, niemals Fehler werfen.
- Schreibzugriffe der App nur über die dokumentierte API; Patches tragen das
  Guard-Token des Lesevorgangs mit (`rev`, die Zeilenversion) — 409 bei
  Konflikt, nie stilles Überschreiben.
- Jeder Eintrag hat eine Adresse (`npcs/jorna`, `<kapitel>`,
  `<kapitel>/<szenen-id>`, `sessions/<id>`, `campaign`, `glossary`); das
  Schema steht in
  `server/src/store/paths.ts`. Auf der Leitung heißen die Felder eines
  Eintrags `properties`, sein Markdown `body`.
- Sprache der UI: Deutsch (Primärsprache), Englisch als zweite Sprache.
  Code, Kommentare, Commits: Englisch.
- Kommentare erklären den Code und stehen für sich: Englisch, ohne Verweise
  auf Issues, PRs oder Reviews. Verweise auf ADRs (`ADR #13`) sind erlaubt —
  sie zeigen auf ein Dokument im Repo, nicht auf ein Ticket.
- Pfadfinder-Prinzip: Wer eine Datei aus einem anderen Grund anfasst, räumt
  in dieser ganzen Datei mit auf, was gegen die Kommentar-Regeln verstößt —
  Issue-Verweise ebenso wie deutsche Begriffe in englischen Kommentaren —,
  nicht nur in den geänderten Zeilen. Dafür gibt es keinen eigenen
  Aufräum-PR.
- Schemata und Fixtures liegen in ihrem Zielformat vor (ein JSON-Schema als
  `.json`, eine Antwort-Fixture als das Objekt selbst), statt im Code
  zusammengebaut zu werden.
- Nutzersichtbare Texte NIE direkt in Komponenten, sondern in den Katalog
  `app/src/i18n/` (`de.ts` = Key-Satz, `en.ts` muss vollständig sein, sonst
  Typfehler). `t()` kommt aus `useT()`/`useI18n()`; reine Helfer in
  `app/src/lib/` bekommen den Translator als Argument. Details: ADR #15.
  `bun run lint` ist das Gate — scharf für migrierte Dateien, `warn` für den
  Rest (Scheibe 2 von #69 arbeitet die Warnungen ab).

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
`fixtures/` geseedeten DB, gebaute App, echter Browser; einzige Ausnahme:
das LLM ist ein lokaler Stub-HTTP-Server — der Provider-Pfad läuft real).
Die Pfade:

1. Auto-Einstieg `/` → Kapitel lädt die Kampagne
2. Szene lesen: Callouts, If-Sections, NPC-Karten der Referenzszenen
3. ⌘K-Suche findet und öffnet
4. Session-Zyklus: starten → Schnellnotiz → Log + scenes_played →
   Pause → beenden → Nachbereitung
5. Nachbereitung: Handlungsstrang übernehmen → Kapiteltext; Ideen abhaken
6. Generator-Zyklus (Stub-LLM): Job → Entwürfe prüfen → Übernehmen → Entwurf
   in den Kapiteln; plus 409-/Fehlerpfad. Dazu (Issue #53) Kampagnenwissen und
   Glossar auf `/settings` pflegen — anlegen, bearbeiten, löschen,
   umsortieren, 409 — und der Lauf danach: Wissen im mitgeschickten
   Kontext (Stub echot den Prompt-Block zurück), Namens-Hinweise in
   „Entwürfe prüfen", „Übernehmen" trotzdem möglich und Server-Neustart (fertiger Job übersteht
   ihn und bleibt übernehmbar, laufender wird als `failed` gemeldet)
7. Eigenschaften-Patch (`PATCH /properties`)/Status-Regler inkl. 409-Konflikt
8. Mobil-Startfläche + Ideen-Einwurf bei 390px
9. Eintrag bearbeiten: öffnen → Text ändern → speichern → gerendert
   sichtbar; 409 bei konkurrierendem Zweit-Write → neu laden statt still
   überschreiben (seit ADR #13 gibt es keine externe Dateiänderung mehr —
   der Guard ist die Zeilenversion `rev`)
10. Kaltstart: leere Instanz ohne Seed — seit ADR #13/#79 der Normalfall
    einer frischen Installation → Kampagne anlegen → Kapitel → Szene →
    Szene befüllen → Session starten → Szene in der Session-Ansicht
    nutzbar; dazu NPC/Ort anlegen aus ihren Listen und die
    Slug-Kollision (409 mit Vorschlag, schreibt nichts)

Regel für neue Features: Jedes ready-Ticket benennt die berührten
kritischen Pfade; wer einen berührt oder schafft, erweitert die
E2E-Suite im selben PR — sonst kein Merge.

## Qualitäts-Boden (nicht verhandelbar)

- Responsive bis Mobil (Mobile = Suche, Leseansicht, Ideen — siehe UI-BRIEF)
- Dark Mode ist der Primärmodus, Light Mode muss funktionieren
- Tastatur-Fokus sichtbar; `prefers-reduced-motion` respektieren
- Keine localStorage-Persistenz für Daten — der Server ist die Wahrheit
