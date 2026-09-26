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
   Ein ADR hält nur Zielentscheidungen fest: keine befristeten ADRs, keine
   Zwischenstände. Der Zwischenstand eines in Scheiben geschnittenen Umbaus
   steht allein im Ticket.
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

- `fixtures/` — die Beispielkampagne als JSON (`fixtures/beispiel/*.json`),
  ein Objekt je Datei in der Form der API: die Kampagne unter
  `fixtures/beispiel/campaigns/<id>.json`, ein Kapitel unter
  `fixtures/beispiel/chapters/<id>.json`, eine Szene unter
  `fixtures/beispiel/scenes/<id>.json`, ein NPC unter
  `fixtures/beispiel/npcs/<id>.json`, ein Ort unter
  `fixtures/beispiel/locations/<id>.json`, ein Faden unter
  `fixtures/beispiel/threads/<id>.json`, eine Idee unter
  `fixtures/beispiel/ideas/<id>.json`, ein Glossar-Begriff unter
  `fixtures/beispiel/glossary-terms/<id>.json`, Kampagnenwissen unter
  `fixtures/beispiel/knowledge-items/<id>.json`, eine Session samt Pausen,
  Log-Zeilen und gespielten Szenen unter
  `fixtures/beispiel/sessions/<id>.json`, jede als das Objekt, das ihre
  Ressource liefert, ohne `rev`. Sie ist
  der **Seed** für Dev/Tests/E2E und die Referenz für Callouts. Bodies NIE
  umformatieren oder „aufräumen"; das Format ist Vertrag.
- `GRIMOIRE_DATA` (Default `./data`, gitignored) — hier liegt
  `grimoire.db` samt `-wal`/`-shm`: die eigentlichen Daten. Kein Code liest
  Kampagneninhalte von woanders.
- `shared/` — Entitäts-Typen (`@grimoire/shared`), von Server und App
  gemeinsam genutzt. Autorität über das Format ist
  `server/src/db/schema.ts` (Speicherform), beschrieben in README.md — beide
  synchron halten. Eine Entität mit eigener Ressource hat ihr zod-Schema in
  `shared/src/<entität>.ts` (ADR #31).
- `server/` — Hono-API. Die Endpoints sind dort dokumentiert, wo sie stehen:
  ein Routen-Modul je Ressource, `server/src/routes/<ressource>.ts`, ein
  Kommentar je Route — keine Liste zum Abhaken. `server/src/routes/api.ts`
  setzt die Module zusammen und beschreibt, was für alle Routen gilt
  (Fehlerkörper samt `code`); gemeinsame HTTP-Helfer liegen in
  `server/src/routes/http.ts`. `server/src/server.ts` setzt nur die App
  zusammen. Datenzugriff ausschließlich über `server/src/store/<domäne>.ts`
  (Queries), nie direkt SQL aus einer Route. **Der Store ist nach Domänen geschnitten:** ein Modul je Art
  — `campaigns`, `chapters` (mit der Szenenreihenfolge), `scenes`, `npcs`,
  `locations`, `threads`, `ideas`, `sessions` (mit `session-rows`, der
  Session-Zeile, die ihre Kinder nachschlagen), `pauses`, `log-entries`,
  `played-scenes`, `glossary-terms`,
  `knowledge-items` (mit ihrer Reihenfolge),
  `generated` (das Übernehmen eines Generator-Laufs) — und
  jedes trägt die
  **Lese- UND Schreibzugriffe** seiner Art. Kein Sammelmodul und kein Barrel: jeder Aufrufer importiert aus
  der Domäne, die er braucht.
- `app/` — das Frontend. Jede Entität mit eigener Ressource hat ihren
  Slice `app/src/<entität>/` (`campaign/`, `chapter/`, `scene/`, `npc/`,
  `location/`, `thread/`, `idea/`, `glossary-term/`, `knowledge-item/`,
  `session/`) mit allem, was die App über sie weiß
  (ADR #31); **Slices importieren einander nicht.** Pause, Log-Zeile und
  gespielte Szene gehören zum Slice `session/`: die App liest sie nur
  eingebettet in ihrer Session, und jeder ihrer Schreibzugriffe landet im
  Cache der Session; ihre Ressourcen haben dort je ein eigenes Modul
  (`pause-api.ts`, `log-entry-api.ts`, `played-scene-api.ts`). Gemeinsam sind nur
  UI-Bausteine ohne Wissen über Entitäten (`app/src/components/`, etwa
  `components/fields/`); gemischte Stellen (Suche, `[[id]]`-Auflösung,
  Kampagnenbaum) sind reine Verteiler. Eine Seite, die mehrere Entitäten
  zeigt, setzt sich wie `App.tsx` aus den Slices zusammen und reicht fremde
  Teile als Slot hinein (die Kapitelübersicht reicht dem Kapitel seine Fäden
  und seine Szenenliste, die Szene bekommt ihre NPC-Karten, die Leseseite
  einer Session den Link einer Szene). Was zwei Slices verbindet, liegt bei
  der Seite, die sie zusammensetzt (die Erinnerungen der Live-Ansicht aus
  Log-Zeilen und Ideen in `routes/PcReminders.tsx`). Kein Barrel:
  Aufrufer importieren die konkrete Datei.
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
  `fixtures/beispiel/scenes/lighthouse-arrival.json` und
  `scenes/smuggler-captured.json` prüfen, sichtbar im Dev-Harness
  `/dev/markdown`.
- Format degradiert: unbekannte Callouts/Überschriften als normalen Text
  rendern, niemals Fehler werfen.
- Schreibzugriffe der App nur über die dokumentierte API; Patches tragen das
  Guard-Token des Lesevorgangs mit (`rev`, die Zeilenversion) — 409 bei
  Konflikt, nie stilles Überschreiben.
- Kampagne, Kapitel, Szene, NPC, Ort, Faden, Idee, Glossar-Begriff,
  Kampagnenwissen und Session samt Pause, Log-Zeile und gespielter Szene sind
  jeweils ihre eigene Ressource (ADR #31):
  `/campaigns/<id>` antwortet mit `Campaign`, `…/chapters/<id>` mit
  `Chapter`, `…/scenes/<id>` mit `Scene`, `…/npcs/<id>` mit `Npc`,
  `…/locations/<id>` mit `Location`, `…/threads/<id>` mit `Thread`,
  `…/ideas/<id>` mit `Idea`, `…/glossary-terms/<id>` mit `GlossaryTerm`,
  `…/knowledge-items/<id>` mit `KnowledgeItem`, `…/sessions/<id>` mit
  `Session` (Pausen, Log-Zeilen und gespielte Szenen eingebettet), alle
  Felder nebeneinander,
  `body` eingeschlossen, wo die Entität einen hat, ohne `kind` und `path`;
  jede Zeile trägt ihr eigenes `rev`. Die App-Routen sind
  `/campaigns/:id` (Kapitelübersicht), `/campaigns/:id/chapters/<id>`,
  `/campaigns/:id/scenes/<id>`, `/campaigns/:id/npcs/<id>` und
  `/campaigns/:id/locations/<id>`; Fäden pflegt die Kapitelübersicht, Ideen
  die Nachbereitung und die Mobil-Startfläche, Glossar-Begriffe die Seite
  `/campaigns/:id/glossary` und Kampagnenwissen `/campaigns/:id/knowledge`.
  Eine Szene und ein Faden liegen flach unter ihrer Kampagne, ihr Kapitel ist
  ein Feld. Welches
  Kapitel aktiv ist, sagt sein `status`: höchstens eines je Kampagne, und wer
  eines aktiviert, setzt das bisher aktive im selben Vorgang auf `planned`.
- Die Kinder einer Session hängen unter ihr und werden nur dort geschrieben:
  `POST …/sessions/<id>/pauses` beginnt eine Pause, `PATCH
  …/pauses/<pause-id> { rev, toMs }` beendet sie; `POST …/sessions/<id>/log`
  legt eine Log-Zeile an, `PATCH …/log/<log-id> { rev, reviewed }` sichtet
  sie; `POST …/sessions/<id>/played-scenes { sceneId }` legt eine gespielte
  Szene an.
  Die laufende Session liefert `GET …/sessions?running=true` (eine oder
  keine), die Liste steht neueste zuerst. `POST …/sessions` startet,
  `PATCH …/sessions/<id> { rev, endedMs }` beendet, `DELETE` verwirft eine
  leere. Einen Zeitpunkt schreibt der Client als Epochen-Wert (`…Ms`); die
  zonenlose Lokalzeit daraus bildet der Server.
- Der Generator-Job ist seine eigene Ressource, höchstens einer je Kampagne:
  `POST …/generator-jobs { kind, … }` startet einen Szenen- oder NPC-Lauf
  (ein Ergänzen-Lauf startet auf seiner Entität), `GET …/generator-jobs`
  liefert ihn (einen oder keinen). `PATCH …/generator-jobs/<id> { rev, … }`
  prüft und übernimmt: Übernehmen heißt, Vorschläge in
  `review.writtenScenes`/`writtenNpcs`/`writtenLocations` zu nennen; ist
  nichts mehr offen, ist der Job erledigt und die Antwort sein letzter Stand.
  `PATCH …/parts/<key> { status: "running" }` wiederholt einen Teil,
  `DELETE { rev }` verwirft den Job.
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
- Migrationsdateien werden nicht getestet — getestet wird das Verhalten, das
  sie ermöglichen (Constraint-Fehler am Schreibpfad), nicht ihr SQL.
- Datenänderungen sind Teil der Migration selbst (SQL, dieselbe Transaktion):
  kein Preflight, kein Datenschritt, kein Boot-Durchgang daneben.
  Übergangscode gibt es nicht: Ein Umbau wird so geschnitten, dass weder
  Adapter noch Doppelwege entstehen.
- Eine Ressource je Entität (ADR #31): Jede Entität der Datenbank hat ihren
  eigenen Endpunkt, ihren eigenen Typ, ihr eigenes zod-Modul als einzige
  Quelle und ihre eigene App-Route; einen allgemeinen Endpunkt über mehrere
  Entitäten gibt es nicht. Jedes Feld ist ein Feld der Entität, `body`
  eingeschlossen — keine Sammelbegriffe wie „Eigenschaften“ gegenüber „Text“,
  kein „Eintrag“ oder „Entwurf“ als gemeinsame Form. Wo wirklich gemischt
  wird (Suche), nennt der Treffer seine Entität ausdrücklich (`kind`).
- Daten sind Zeilen ihrer Tabelle in der Datenbank, keine Dateien und keine
  Dokumente — in Prompts, Schema-Namen und -Beschreibungen, Bezeichnern,
  Kommentaren, Doku und Katalog. Prompts sagen nur, was das Modell tun soll:
  keine Verbote, keine „nicht mehr“-Hinweise, keine Geschichte.
- Fixes beschränken sich auf die Ursache: kein zusätzlicher Schutz, keine
  Tests und keine Betriebsdoku über den Auftrag hinaus. Kommentare
  beschreiben den Zustand, nie die Geschichte eines Fehlers oder das Setup
  des PO.
- Abhängigkeiten statt Eigenbau (ADR #30): Für allgemeine Aufgaben
  (Validierung, Schemata, Datum und Zeit, …) wird ein etabliertes Paket
  eingebunden, nicht selbst gebaut. Eintragspflichtig in docs/DECISIONS.md
  bleiben allein Bun-only-APIs (Node-Portabilität).
- Ein Schema hat genau eine Quelle; eine abgeleitete Form wird nie von Hand
  nachgebaut. Das Schema einer Entität ist ihr zod-Schema, und Typ,
  Patch-, Seed- und Generator-Form werden daraus abgeleitet (ADR #31).
  Fixtures liegen weiter als das Objekt selbst vor (eine Antwort-Fixture als
  das Objekt selbst, eine Entität als das Objekt, das ihre Ressource
  liefert).
- Nutzersichtbare Texte NIE direkt in Komponenten, sondern in den Katalog
  `app/src/i18n/` (`de.ts` = Key-Satz, `en.ts` muss vollständig sein, sonst
  Typfehler). `t()` kommt aus `useT()`/`useI18n()`; reine Helfer in
  `app/src/lib/` bekommen den Translator als Argument. Details: ADR #15.
  `bun run lint` ist das Gate — scharf für migrierte Dateien, `warn` für den
  Rest (Scheibe 2 von #69 arbeitet die Warnungen ab).
- UI-Texte sind ganze Sätze, die der DM versteht: Ändert sich das Verhalten
  hinter einem Text, wird der de/en-Satz neu formuliert, nie ein Satzteil
  ausgetauscht. Keine rohen Leitungswerte (`status: unknown`) im Satz,
  sondern das UI-Label. Der Lead prüft die Formulierung auf Logik, bevor der
  PR zum PO geht.

## Backlog-Prozess

- Der PO kippt Ideen als Issues mit Label `idee` ein (Template „Idee") —
  formlos, Freitext genügt.
- Refinement findet IM Issue statt: Rückfragen als Kommentare stellen;
  danach den Issue-Body zum Ticket ausbauen — User Story („Als DM will
  ich … damit …"), Akzeptanzkriterien (nachprüfbar), Scope/Nicht-Ziele,
  Abhängigkeiten. Erst nach PO-Ok im Thread: Label `idee` → `ready`. Ein
  Ok des PO im Gespräch mit dem Lead gilt genauso; der Lead hält es im
  Thread fest, bevor er `ready` setzt.
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
- Der Lead implementiert nicht, auch keine Kleinigkeiten. Umgesetzt wird von
  Engineer-Agents auf Opus (`model: "opus"`, eigener Worktree); Fable nur für
  den Lead und, auf ausdrücklichen Wunsch des PO, für einen Designer.
- Der Lead-Klickpfad läuft auf dem FINALEN PR-Stand nach dem letzten Commit,
  auch nach Review-Fix-Runden. Ungetestet geht kein PR zum PO.
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

1. Auto-Einstieg `/` → Kapitel lädt die Kampagne: eine durchgehende
   Szenenliste in der Reihenfolge des DM (keine Ortsgruppen, der Ort steht
   in der Metazeile), umsortiert über Hoch/Runter — der Schreibweg trägt den
   eigenen Wächter der Reihenfolge (`scene_order_rev`), ein alter Stand ist
   409, und weder Szenen- noch Kapitel-`rev` bewegen sich dabei. Unter dem
   Kapiteltext stehen die Fäden des Kapitels (`GET …/threads?chapter=<id>`,
   in der Reihenfolge des Anlegens) und werden dort gepflegt: anlegen,
   abhaken, umformulieren, löschen — jeder Faden mit seinem eigenen `rev`
   (`PATCH`/`DELETE …/threads/<id>`, ein alter Stand ist 409 mit dem
   aktuellen Faden), Kapiteltext und Kapitel-`rev` bleiben unberührt
2. Szene lesen: aus dieser Liste geöffnet (`/campaigns/:id/scenes/<id>`,
   gelesen über `GET …/scenes/<id>`) — Callouts, If-Sections, NPC-Karten der
   Referenzszenen
3. ⌘K-Suche findet und öffnet: indexiert sind Kampagne, Kapitel, Szenen,
   NPCs, Orte und die Glossar-Begriffe. Jeder Treffer nennt sich mit
   `kind` + `id` ohne Adresse: ein Kampagnen-Treffer öffnet
   `/campaigns/:id`, ein Kapitel-Treffer `/campaigns/:id/chapters/<id>`, ein
   Szenen-Treffer `/campaigns/:id/scenes/<id>`, ein
   NPC-Treffer `/campaigns/:id/npcs/<id>`, ein Orts-Treffer
   `/campaigns/:id/locations/<id>` und ein Glossar-Treffer
   (`kind: "glossary-term"`, die `id` des Begriffs) `/campaigns/:id/glossary`;
   Sessions und Ideen sind nicht indexiert
4. Session-Zyklus: starten (offen ist die erste Szene der Reihenfolge, die
   weder `played` noch `dropped` ist, sonst die erste; die laufende Session
   liefert `GET …/sessions?running=true`) → Schnellnotiz → Log-**Zeile** mit
   `sceneId` (`POST …/sessions/<id>/log`), die Notiz legt **keine**
   gespielte Szene an → „Nächste Szene" führt zur folgenden der Reihenfolge;
   hat die Session eine Log-Zeile mit der `sceneId` der verlassenen Szene,
   legt es für **die verlassene Szene** eine gespielte Szene an (`POST
   …/sessions/<id>/played-scenes`, einmal je Session), ohne Notiz legt es
   nichts an → Pause (`POST …/pauses`, ein Intervall, keine Log-Zeile;
   beendet mit `PATCH …/pauses/<id> { rev, toMs }`) → beenden (`PATCH
   …/sessions/<id> { rev, endedMs }`; die gerade offene Szene wird dabei
   **nicht** als gespielt angelegt) → Nachbereitung. Jedes Kind trägt sein
   eigenes `rev`, keines bewegt das der Session; an einer beendeten Session
   ist jedes neue Kind 409 `session_ended`, und die Live-Ansicht sagt das in
   einem ganzen Satz. Die alten Adressen `…/session`, `…/session/start` und
   `…/log` antworten 404. Dazu die Leseseite einer vergangenen Session
   (`/campaigns/:id/sessions/<session-id>`)
5. Nachbereitung: Handlungsstrang übernehmen → ein Faden des aktiven
   Kapitels (`POST …/threads { chapter, text }`, ohne `rev`; Kapiteltext und
   Kapitel-`rev` bleiben unberührt); Idee abhaken → `PATCH …/ideas/<id>
   { rev, done }`, ein alter `rev` ist 409 mit der aktuellen Idee. Die
   Nachbereitung nimmt die erste Session der Liste (die zuletzt gestartete,
   auch über Mitternacht) und sichtet eine Log-Zeile mit `PATCH
   …/sessions/<id>/log/<log-id> { rev, reviewed }` — eine unbekannte id ist
   404, ein alter `rev` 409 mit der aktuellen Zeile, und die Karte sagt, dass
   die Notiz anderswo geändert wurde; `review/seen` antwortet 404
6. Generator-Zyklus (Stub-LLM): Job → Entwürfe prüfen → Übernehmen →
   Szene in den Kapiteln; plus 409-/Fehlerpfad. Eine vorgeschlagene Szene ist
   die Szene ohne `rev` (`result.scenes`, ADR #31): „Bearbeiten" öffnet ihre
   Felder und ihren Text, gespeichert werden die geänderten Felder je Szene
   (`sceneEdits`), und „Übernehmen" schreibt sie über dem Vorschlag des
   Modells; geprüft, verworfen und übernommen wird je `id`, alles über
   `PATCH …/generator-jobs/<id>` (ein alter `rev` ist 409 mit dem aktuellen
   Job), und die alten Adressen `…/generate/apply` und `…/generate/job`
   antworten 404. Dazu
   Kampagnenwissen und Glossar auf ihren eigenen Seiten
   (`/campaigns/:id/knowledge`, `/campaigns/:id/glossary`) pflegen — anlegen,
   bearbeiten, löschen, jede Zeile mit ihrem eigenen `rev`
   (`…/knowledge-items/<id>`, `…/glossary-terms/<id>`, ein alter Stand ist 409
   mit der aktuellen Zeile), das Kampagnenwissen umsortieren über seinen
   eigenen Wächter (`PUT …/knowledge-item-order`, ein alter Stand ist 409 mit
   der aktuellen Reihenfolge, kein `rev` einer Zeile bewegt sich); die alten
   Listen-Adressen `…/glossary` und `…/knowledge` antworten 404 — und der
   Lauf danach:
   Wissen im mitgeschickten Kontext (Stub echot den Prompt-Block zurück),
   Namens-Hinweise in „Entwürfe prüfen", „Übernehmen" trotzdem möglich und
   Server-Neustart (fertiger Job übersteht ihn und bleibt übernehmbar,
   laufender wird als `failed` gemeldet). Die Szenen eines Laufs stehen im
   Kapitel in Gliederungsreihenfolge, auch wenn sie einzeln und in
   umgekehrter Reihenfolge übernommen werden — Startwert bei der ersten
   Übernahme plus Nummer in der Gliederung (ADR #27)
7. Eigenschaften-Dialog/Status-Regler inkl. 409-Konflikt: der Dialog zeigt
   die Konfliktzeile mit ihren zwei Aktionen — „Neu laden" holt die aktuellen
   Werte, „Trotzdem speichern" schreibt nur die Felder des Dialogs (eine
   gleichzeitige Textänderung übersteht das). Der Status-Regler selbst hat
   keine Konflikt-Aktionen: er meldet den veralteten Stand, der DM lädt neu.
   Ein Kapitel aktiviert der Regler mit `PATCH …/chapters/<id> { rev,
   status: "active" }`; das bisher aktive steht danach auf `planned`, und
   genau ein Kapitel ist aktiv.
8. Mobil-Startfläche + Ideen-Einwurf bei 390px: die Idee wird eine Idee
   (`POST …/ideas`, antwortet mit `Idea`), am Ende, nichts abgehakt; läuft
   eine Session (`GET …/sessions?running=true`), zeigt die Startfläche ihren
   Chip als Weg zurück
9. Eintrag bearbeiten: öffnen → Text ändern → speichern → gerendert
   sichtbar; 409 bei konkurrierendem Zweit-Write → dieselbe Konfliktzeile
   statt still überschreiben. „Neu laden" verwirft den Entwurf und übernimmt
   den gespeicherten Stand, „Trotzdem speichern" schreibt nur den Text, sodass
   eine fremd geänderte Eigenschaft bleibt. Weil alle Felder einer Szene,
   `body` eingeschlossen, EINE Zeile und EINEN Wächter teilen (ADR #23), ist
   auch ein reiner Status-Write eines Zweitschreibers ein Konflikt — der
   Status neben dem offenen Editor wird nicht stillschweigend übernommen. Seit ADR #13 gibt
   es keine externe Dateiänderung mehr; der Guard ist die Zeilenversion `rev`.
   Der Text eines Kapitels ist auf seiner Leseansicht
   (`/campaigns/:id/chapters/<id>`) bearbeitbar wie der einer Szene. Die
   Kampagne wird wie jede Entität über ihre Ressource geschrieben
   (`PATCH /campaigns/:id`); ihre Route ist die Kapitelübersicht. Der Kopf der
   Kapitelübersicht bleibt unberührt: sein eines `Bearbeiten` öffnet den
   Dialog „Kampagne bearbeiten" über Name, Beschreibung und `body` — den Text
   als Markdown wie im Textdialog eines Kapitels —, mit derselben
   Konfliktzeile, deren „Trotzdem speichern" nur die geänderten Felder
   schreibt.
10. Kaltstart: leere Instanz ohne Seed — seit ADR #13 der Normalfall
    einer frischen Installation → Kampagne anlegen → Kapitel → Szene →
    Szene befüllen → Session starten → Szene in der Session-Ansicht
    nutzbar; jede neue Szene hängt sich ans Ende ihres Kapitels, ein
    Kapitelwechsel ans Ende des Zielkapitels; dazu NPC/Ort anlegen aus ihren
    Listen, die selbst gesetzte Kennung im Anlege-Dialog (Stift, ungültige
    Kennung blockiert „Anlegen", leeres Feld leitet wieder aus dem Namen ab)
    und die Slug-Kollision (409 mit Vorschlag, schreibt nichts)

Regel für neue Features: Jedes ready-Ticket benennt die berührten
kritischen Pfade; wer einen berührt oder schafft, erweitert die
E2E-Suite im selben PR — sonst kein Merge.

## Qualitäts-Boden (nicht verhandelbar)

- Responsive bis Mobil (Mobile = Suche, Leseansicht, Ideen — siehe UI-BRIEF)
- Dark Mode ist der Primärmodus, Light Mode muss funktionieren
- Tastatur-Fokus sichtbar; `prefers-reduced-motion` respektieren
- Keine localStorage-Persistenz für Daten — der Server ist die Wahrheit
