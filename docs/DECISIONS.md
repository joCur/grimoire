# Grimoire — Entscheidungen (leichtgewichtige ADRs)

Festgehaltene Architektur-Entscheidungen mit Begründung. Neue Entscheidungen
unten anfügen, alte nicht löschen — bei Änderung Status auf `ersetzt durch #N`.

## 1. Source of Truth: Markdown + Frontmatter auf dem Dateisystem

> **Status: ersetzt durch #13.** Die Speicherung ist eine SQLite-Datenbank.
> Was von diesem Eintrag GILT: „Format degradiert statt zu validieren" ist
> unverändert Grundregel (im Renderer wie im Import), und das
> Markdown-Body-Vokabular aus README.md bleibt normativ. Was NICHT mehr gilt:
> Dateien als Speicher, externe Editierbarkeit als Datenpfad und
> Git-Versionierung der Inhalte.

Menschenlesbar, mit jedem Editor bearbeitbar, Git-versionierbar.
Die App ist ein Frontend über diesem Datenmodell, keine Datenbank-App.
Format degradiert statt zu validieren (unbekannte Callouts/Überschriften
= normaler Text). Details: README.md.

## 2. Kein Roll20-Sync — Verantwortungs-Trennung

Grimoire hält, was nur der DM sieht (Read-Alouds, Notizen, Geheimnisse,
Logs). Roll20 hält, was Spieler sehen/anfassen (Karten, Tokens,
Spieler-Handouts, Statblocks). Brücke: unidirektional und manuell
(Copy-Button, Handout-Verweise per Name). Bidirektionaler Sync bewusst
verworfen (Konfliktauflösung, HTML↔MD, keine offizielle REST-API).

## 3. Auth: vor der App, nicht in der App

Kein Account-System (Einzelnutzer). Zugriffsschutz ist
Deployment-Entscheidung: Tailscale (Standard), alternativ Basic Auth /
Forward Auth (Authelia, authentik) im Reverse Proxy. Die App selbst
bleibt auth-agnostisch; einzige App-seitige Konsequenz: alle
Schreibzugriffe laufen über den Server, kein persistenter Browser-State.

## 4. Schreib-Modell

- App schreibt: Session-Logs (append-only), Inbox, Frontmatter-Patches
  (Status etc.), Review-Aktionen, Generator-Drafts.
- Inhalte werden extern editiert (VS Code Remote o. ä.). Ein simples
  Textarea-Edit als Notlösung ist erlaubt; ein vollwertiger MD-Editor
  ist bewusst KEIN Ziel von v1.
- Konfliktschutz: Patch nur bei unverändertem mtime, sonst 409.

> **Teilweise überholt (#11, #13/#15):** Bearbeitet wird in der App; ein
> externer Editor ist kein Datenpfad mehr, weil die Datenbank die Wahrheit
> ist. Was GILT: das Append-only von Session-Log und Inbox (samt der einen
> Ausnahme, dem Abhaken erledigter Inbox-Zeilen) und die Konfliktregel —
> nur heißt der Guard jetzt `rev`, die Zeilenversion, statt der Dateizeit.

## 5. Tech-Stack

**Frontend:** Vite + React 19 + Tailwind v4 + shadcn/ui.
Server-State: TanStack Query (Caching, Refetch nach Mutation,
409-Handling). Lokaler UI-State: plain React — kein Zustand/Redux.
Markdown-Rendering: react-markdown + eigenes Remark-Plugin für
`[!callout]`-Blöcke und `## If:`-Überschriften.
Kein Electron/Tauri — Web-App hinter Tailscale reicht.

**Backend:** Bun + Hono. Bibliotheken ursprünglich: gray-matter
(Frontmatter), chokidar (Datei-Watcher für externe Edits), Fuse.js (Suche im
Speicher — kein SQLite nötig bei ein paar hundert Dateien).
**Seit #13:** Drizzle über SQLite (`server/src/db/`), Suche als FTS5-Index;
chokidar und Fuse.js sind entfernt, gray-matter lebt nur noch im
Import-/Parser-Pfad (`@grimoire/shared`).
Hono statt Express/Fastify: minimal, typsicher, läuft auf Bun UND Node
(Runtime-Wechsel bleibt möglich, siehe #7).

**Icons:** Lucide für UI-Chrome (konsistent mit shadcn);
game-icons.net (CC BY) für thematische Marker (Entitäts- und
Callout-Typen). Benötigte SVGs als eigene Komponenten einchecken.

**Deployment:** ein Docker-Container (Bun-Image), Volume auf
`GRIMOIRE_DATA` (seit #13; vorher `campaigns/`), erreichbar nur über
Tailscale. Details: docs/DEPLOYMENT.md.

## 6. LLM-Generator

Pipeline mit Review-Vorschau, nie Direkt-Schreiben; Drafts immer
`status: draft`. Provider hinter Interface (`server/src/llm-provider.ts`):
Start Claude API, Umschalten auf LM Studio per Env-Var. Mechanische
Validierung nach Generierung, Fehler als Korrektur-Turn ans LLM
(konfigurierbar über LLM_CORRECTION_TURNS, 0–2; Default seit #10-Ära 1 —
nicht heilbare Fehlerklassen wurden eliminiert, verbleibende Formfehler
repariert ein Turn). Details: generator/README.md.

## 7. Wachstums-Pfad (damit #5 keine Sackgasse ist)

Bun/Hono ist keine „nur für klein"-Entscheidung, aber die Grenzen sind
benannt:

- **App-Level-Auth später nötig?** Erst prüfen, ob Forward Auth im Proxy
  (Authelia/authentik) reicht — das deckt auch „Zugriff von fremden
  Geräten" ab, ohne App-Code (#3 bleibt gültig). Falls doch in-App:
  Hono bringt Middleware für Basic Auth, JWT und Sessions mit; das ist
  ein Middleware-Layer, kein Rewrite.
- **Mehr Daten / komplexere Queries?** *Eingetreten und entschieden in
  #13* — allerdings anders als hier vermutet: SQLite ist nicht Index/Cache
  geworden, sondern die Quelle der Wahrheit; das Dateisystem ist nur noch
  Import-Quelle.
- **Bun-spezifisches Risiko?** Hono läuft unverändert auf Node; die einzige
  registrierte Bun-Kopplung ist `bun:sqlite` als Fallback hinter
  `server/src/db/driver.ts` — primär läuft `node:sqlite`; `better-sqlite3`
  wäre der Ersatz, wenn beide ausfallen, ist aber nicht implementiert (#13).
  Runtime-Wechsel = Deployment-Änderung, kein Code-Umbau, solange keine
  weiteren Bun-only-APIs benutzt werden. Diese Regel gilt: **Bun-only-APIs
  nur mit Eintrag hier.**
- **Echte Mehrnutzer-/Rechte-Anforderungen?** Dann ist nicht die Runtime
  das Problem, sondern Datenmodell (#1) und Auth-Modell (#3) — an dem
  Punkt bewusst neu entscheiden statt anbauen.

## 8. Monorepo mit Bun-Workspaces und shared/-Paket

Repo als Bun-Workspace-Monorepo: `shared/` (Entitäts-Typen +
Frontmatter-Parser), `server/`, `app/`. Das Datenformat aus README.md ist
damit genau einmal in Code beschrieben; Server und Frontend importieren
dieselben Typen (`@grimoire/shared`). shared/ wird ohne Build-Schritt als
TypeScript-Quelle konsumiert (Bun und Vite können das nativ; Node-Fallback
über tsx, siehe #7). Test-Runner ist `bun test` — Dev-Werkzeug, kein
Runtime-Code; die Bun-only-Regel aus #5 betrifft weiterhin nur
Laufzeit-APIs.

## 9. Client-Aktualisierung: Polling statt SSE

Änderungen sollen in der App sichtbar werden, ohne manuell neu zu laden.
Mechanismus ursprünglich: chokidar beobachtet CAMPAIGN_ROOT und invalidiert
pro Kampagne den In-Memory-Suchindex und einen Versionszähler.
**Seit #13 ohne Watcher:** es gibt keinen externen Schreiber mehr, also wird
`campaigns.version` von jedem Write in DERSELBEN Transaktion hochgezählt —
ein Poll kann keine erhöhte Version ohne die zugehörige Änderung sehen.
Unverändert: die App pollt `GET /api/:campaign/version` und
invalidiert ihre Queries, wenn sich der Wert ändert. Das Poll-Intervall
ist rein clientseitig. SSE/WebSockets erwogen und zurückgestellt: für
einen Einzelnutzer (#3) reicht Polling, und SSE ist später ohne
API-Bruch nachrüstbar — der Versionszähler bleibt dann als Fallback
gültig.

## 10. Long-running Operationen laufen serverseitig als Job

Jede Operation, die länger als ein paar Sekunden dauern kann (Generator,
künftige LLM-Pipelines, Massen-Operationen), läuft als serverseitiger
Job: Start-Endpoint antwortet sofort mit einer Job-Referenz, Status und
Ergebnis werden gepollt, die UI stellt den Zustand nach Navigation,
Reload oder Tab-Schließen vollständig wieder her. Nie an einen offenen
Browser-Tab oder eine offene HTTP-Verbindung gebunden — ein
Space-Wechsel auf macOS hat einmal ein bezahltes Generierungs-Ergebnis
vernichtet (PO-Vorfall zu #19); das darf konstruktionsbedingt nicht
möglich sein. Job-Store in-memory (Kampagnendateien bleiben die einzige
Platten-Wahrheit, #1); Verlust bei Server-Neustart ist der akzeptierte
Trade-off und wird der UI sauber gemeldet.

**Nachtrag (#23, erledigt in #62):** Der letzte Satz gilt nicht mehr. Jobs
sind Zeilen in `generate_jobs` (#13), denn mit der Datenbank als Wahrheit gibt
es einen naheliegenden Ort dafür — und der Verlust, den das Job-Modell
verhindern sollte, trat genau hier noch auf: ein Deploy in der Minute zwischen
„fertig" und „Übernehmen" warf ein fertiges Ergebnis weg. Seither überlebt ein
**fertiger** Job (`done`/`failed`) einen Neustart vollständig — Ergebnis,
Fehlerbody und die Review-Edits — und bleibt übernehmbar. Ein **laufender**
Job kann es nicht, weil sein Provider-Call mit dem Prozess starb: der Boot
schreibt jede übrig gebliebene `running`-Zeile auf `failed` mit der Meldung
„Server wurde während des Laufs neu gestartet — Job neu starten"
(`server/src/db/job-boot.ts`), statt die App ins endlose Pollen zu schicken.

## 11. App-first: Bearbeitung in der App ist das Ziel, der Editor Ausweichlösung

> **Status: ersetzt durch #13.** Die Speicherformat-Konsequenz unten („Markdown
> bleibt vorerst Source of Truth") ist eingelöst und aufgehoben: die benannten
> Trigger sind eingetreten, die Migration ist durch. Die Haltung „alles aus der
> App heraus" bleibt Produktziel — sie ist der Grund für #13.

Revidiert die Gewichtung aus #4: Externes Editieren (VS Code o. ä.) ist
Übergangs-Ventil, nicht Produktziel. Zielbild des PO: alle Pflege-
Operationen aus der App heraus (#15). Priorisierung richtet sich danach.

Speicherformat-Konsequenz (Diskussion zu #29): Markdown-Dateien bleiben
vorerst Source of Truth — nicht aus Prinzip, sondern aus Reihenfolge:
Die Editing-UI (#15) ist speicheragnostisch (die API ist die Naht),
eine Migration vor fertiger Editing-UI würde eine Bearbeitungs-Lücke
reißen, und der akute Schmerz (id-Umbenennung) ist auf Dateien billig
lösbar (Rename-Kaskade). Erwartete Evolution, vom PO benannt und hier
festgehalten: Job-Persistenz (#23), parallele Jobs und eventuelles
Usermanagement sind die Trigger, bei denen der SQLite-Umzug hinter der
API-Naht als eigenes ADR-Verfahren ansteht — dann mit Editing-UI als
Sicherheitsnetz und Export/Import als Teil des Umzugs.
Wiedervorlage: nach #15 v1.

## 12. Release-Prozess: release-please, Versions-Tags, `:latest` nur bei Releases

Deploys sollen bewusste Ereignisse mit Changelog sein, nicht ein Tag, das
bei jedem Merge unter dem laufenden Betrieb mutiert (PO-Anforderung zu #47:
gezielt einen bekannten guten Stand vor einer Session deployen, im Problemfall
trivial zurückrollen).

Mechanismus, gleichgezogen mit joCur/quorum (dort erprobt), abgespeckt auf
ein Image und ein Compose-File:

- **release-please** (`googleapis/release-please-action@v4`) läuft bei jedem
  Push auf `main` und hält aus den Conventional Commits einen Release-PR.
  Konfiguration liegt im Root (`release-please-config.json`,
  `.release-please-manifest.json`, Startversion 0.1.0): ein Package `"."`,
  `release-type: node`, `include-component-in-tag: false` und — die Falle aus
  Quorum — ein **leerer `package-name`**, nicht ein leeres `component`;
  sonst fällt die Komponente still auf den Paketnamen zurück und der
  gemergte Release-PR wird nicht getaggt, was jeden folgenden Release
  blockiert. Die Version wird in die Root-`package.json` geschrieben und in
  die Workspace-Manifeste kopiert.
- **Merge des Release-PRs** (mit PO-Approval wie jeder PR, siehe CLAUDE.md)
  ist das einzige Release-Ereignis: Tag `vX.Y.Z`, GitHub-Release,
  `CHANGELOG.md`.
- **CI-Gate:** `require-green-ci` löst den Tag zum Commit auf, sucht dessen
  `ci`-Push-Run und wartet mit `gh run watch --exit-status`. Ein fehlender
  Lauf ist kein bestandener Lauf — dann wird nichts veröffentlicht.
  release-please selbst bleibt ungegated: der Release-PR muss auch bei rotem
  `main` gepflegt werden können, denn er ist das Werkzeug, mit dem der
  Zustand gelesen und repariert wird.
- **Geänderte `:latest`-Semantik:** `:latest` und die Versions-Tags entstehen
  nur im Release-Workflow, mit Checkout **am Tag** (nicht am Branch-Head).
  `:latest` heißt damit „letzter Release", nicht „letzter Merge". Das
  Compose-File referenziert `${GRIMOIRE_VERSION:-latest}`; empfohlen ist eine
  festgenagelte Version.
- Die Build-Id für den Reload-Banner (#24, `GRIMOIRE_BUILD`) bleibt
  erhalten: das Release-Image brennt den Tag ein — derselbe Wert in Bundle
  und Server, sonst zeigte jeder Deploy sein eigenes Banner.

Bewusst nicht dabei: Multi-Arch (amd64 genügt), Auto-Deploy (der PO pullt
weiterhin selbst) und rückwirkende Changelog-Generierung für die Commits vor
diesem Eintrag.

### Nachtrag 2026-09-06 (#66): CI baut zur Prüfung, publiziert nie

Ursprünglich baute `ci.yml` bei jedem main-Merge ein Image unter dem
Commit-SHA und **pushte** es. Das Pushen ist entfallen — **der
Release-Workflow ist der einzige Schreiber der GHCR-Registry.**

- Ein SHA-Push bei jedem Merge hielt das Paket dauerhaft „gerade
  aktualisiert" und verwässerte damit genau die Release-Semantik, für die
  dieser Eintrag existiert: Publikation ist ein bewusstes, mit Changelog
  belegtes Ereignis.
- Rollback läuft über die **Versions-Tags** — zu ihnen gehört ein Changelog,
  zu einem SHA nicht. Die SHA-Images waren als „Vorschau/Debug" gedacht und
  wurden nie so genutzt.
- Das CI-Gate bleibt unverändert wirksam: `require-green-ci` verlangt den
  grünen `ci`-Push-Run des getaggten Commits, bevor `publish-image` läuft.
  CI prüft, Release publiziert.
- **Gebaut wird trotzdem:** `ci.yml` hat einen Job `image-build`
  (`docker/build-push-action` mit `push: false`, ohne Registry-Login und
  ohne `packages: write` — er *kann* nicht publizieren). Er läuft auf PRs
  und main-Pushes, hängt nur an `test` und nutzt denselben GHA-Cache wie der
  Release-Build. Damit fällt ein Fehler **im Dockerfile selbst** im Review
  auf und nicht erst im Release-Lauf, wo der Tag schon existiert; der
  Release-Build findet den Cache zusätzlich warm vor. Preis: ein paar
  Runner-Minuten pro PR — deutlich billiger als ein Patch-Release, das nur
  ein kaputtes Image reparieren soll. `GRIMOIRE_BUILD` bekommt hier den
  Commit-SHA als Wegwerf-Wert; die echte Build-Id brennt nur der
  Release-Build ein.

## 13. SQLite ist die Quelle der Wahrheit

> **Status: final** (#62). Als Entwurf mit Scheibe 1 (#54) eingecheckt, damit
> Schema und Werkzeug nicht ohne festgehaltene Begründung im Repo liegen;
> wirksam seit dem Cutover in Scheibe 2 (#57); mit Scheibe 4 (#62) ist die
> Migration abgeschlossen und dieser Eintrag maßgeblich.
>
> Was die vier Scheiben eingelöst haben:
>
> - **#54** — Drizzle-Schema als eine Typquelle, committete Migrationen,
>   FTS5-Custom-Migration, die Einmal-Migration Dateibaum → DB (voller Import,
>   Degradation statt Fehler), `grimoire seed`, Bun+Node-Treiber-Smoke.
> - **#57 (Cutover)** — alle Read-/Write-Endpoints als Queries
>   (`server/src/store/`), `rev` als 409-Guard (löst #37), FTS5 statt Fuse.js,
>   `GET/PUT /:campaign/glossary` auf der Glossar-Tabelle,
>   `GET /:campaign/migration-report` samt leisem UI-Hinweis, Boot =
>   Schema-Migrator + Erstmigration, chokidar-Watcher entfernt (die
>   Versions-Zählung kommt aus `campaigns.version`).
> - **#60** — `GET /usage` als Referenzzählung, Rename-Vorschau auf diesen
>   Zahlen.
> - **#62** — Generator-Jobs persistent (Nachtrag zu #10), die letzten
>   Dateileser entfernt (`CAMPAIGN_ROOT` liest nur noch
>   `db/migrate-campaigns.ts`), `POST /campaign-meta` entfernt (der Totpfad
>   nach dem Cutover: die Kampagnen-Zeile existiert immer, also gibt es keinen
>   Anlege-Fall mehr — Name und Beschreibung laufen über PATCH /frontmatter),
>   `name` in Kampagnenliste und Kampagnen-Dokument vereinheitlicht, Doku
>   nachgezogen.
>
> Zwei Abweichungen von der Planung, hier festgehalten, weil sie Verhalten
> ändern: (a) **eine Szene wird über ihre `id` adressiert**, nicht mehr über
> ihren früheren Dateinamen (`scenes.file_slug` entfällt laut Planung, also
> existiert der Dateiname nirgends mehr — der Pfad lautet
> `<kapitel>/<ort>/<id>.md`); (b) **`POST /rename` ist mit dem Cutover auf die
> Datenbank umgestellt** statt erst in Scheibe 3 — der Datei-Kaskade hätte
> sonst niemand mehr zugesehen.

**Löst ADR #11 ab** (und damit die dort formulierte Reihenfolge „Markdown
bleibt vorerst Source of Truth"). Die dort benannten Trigger sind eingetreten:
Job-Persistenz (#23), Rename als Datenoperation (#29/#30) und die
Editing-UI (#15/#42/#43) als Sicherheitsnetz stehen. Planung und
PO-Entscheidungen: #52 (Fassung 3, final).

**Entscheidung:** Eine SQLite-Datenbank ist die **alleinige** Quelle der
Wahrheit für Kampagneninhalte. Kein Spiegel auf das Dateisystem, kein
Auto-Export, kein Zwei-Wege-Abgleich — die Klasse von Konfliktproblemen, die
ein Spiegel erzeugt, wird nicht gebaut.

- **Markdown bleibt an genau zwei Stellen:** (a) als Quelle der EINMALIGEN
  Migration aus dem Dateibaum, (b) als Inhaltsformat der `body`-Spalten. Das
  Body-Vokabular aus README.md (Callouts, `## If:`, Hashtags) bleibt
  normativ; das Datenformat-Kapitel wird zum „Import-Format (historisch)".
- **Ein Body = ein Markdown-Feld,** in der UI als Markdown editierbar
  (PO-Entscheidung). „Blöcke als Zeilen" ist eine bewusst offen gelassene
  Später-Option; das Schema verbaut sie nicht.
- **Das Glossar ist eine strukturierte Tabelle** (Begriff → Erklärung), kein
  Markdown-Blob. Der Ausbau zur Generator-Wissensbasis ist Folge-Feature #53.
- **Altdateien werden nie gelöscht, verschoben oder markiert.** Nach der
  Migration fasst der Server `CAMPAIGN_ROOT` nicht mehr an. Der komplette,
  menschenlesbare Vor-Migrations-Stand bleibt damit liegen — das ist die
  Abfederung der Einbahnstraße, zusammen mit „manueller Export" als bekanntem
  Später-Pfad.
- **Die Migration verliert nie still Inhalt.** Was nicht zu Zeilen wird,
  liegt wörtlich in `unknown_files` — Textdateien in `content`, Nicht-Text
  (Karten-PNG, PDF-Handout) als Bytes in `content_blob`, denn eine als UTF-8
  verstümmelte Kopie unter der Überschrift „unverändert übernommen" wäre
  schlimmer als eine ehrliche Absage. Jede Degradierung steht mit Grund und
  Lauf-Id (`migration_report.run_id`) daneben.
- **Die Migration ist wiederaufnehmbar.** Neben `meta['migrated_at']` (Lauf
  fertig) markiert `meta['migrated_campaign:<id>']` jede einzelne, in ihrer
  eigenen Transaktion committete Kampagne. Ein Abbruch zwischen zwei
  Kampagnen führt damit zum Wiederaufsetzen statt in die Sackgasse
  „Inhalt ohne Marker — wird nie wieder angefasst".
- **Sicherung der DB-Datei ist Sache des Stack-Owners** (Volume-Backup,
  Hinweis in DEPLOYMENT.md); ein eigenes Backup-System ist bewusst kein
  Feature.
- **ORM: Drizzle** (`drizzle-orm`, `drizzle-kit` als Dev-Dependency).
  `server/src/db/schema.ts` ist die eine Typquelle; Migrationen sind
  generierte, **committete** SQL-Dateien und werden beim Boot in einer
  Transaktion angewandt. Downgrade wird nicht unterstützt; Rückweg ist
  Volume-Sicherung plus Image-Rollback auf einen älteren Versions-Tag (#12).
- **FTS5 statt Fuse.js** für die Suche, als handgeschriebene
  Custom-Migration (Tokenizer `unicode61 remove_diacritics 2`, Ranking
  `bm25(search_fts, 10, 6, 4, 1)`), explizit aus der Store-Schicht gepflegt.
- **`rev` ersetzt `mtimeMs`** als 409-Guard (Zeilenversion statt Dateizeit —
  löst #37). **PRAGMAs:** `journal_mode=WAL`, `foreign_keys=ON`,
  `busy_timeout=5000`. **`GRIMOIRE_DATA`** (Default `./data`) hält
  `grimoire.db` samt `-wal`/`-shm`; `CAMPAIGN_ROOT` ist nur noch Quelle der
  Einmal-Migration bzw. des Dev-Seeds.

**Treiber — Abweichung von der Planung, hier als Bun-Kopplung registriert
(Pflicht aus #7):** Die Planung ging davon aus, dass `node:sqlite` auf beiden
Laufzeiten verfügbar ist und dass Drizzle einen `drizzle-orm/node-sqlite`
-Treiber mitbringt. Beides trifft nicht zu: **Bun implementiert `node:sqlite`
nicht** (geprüft mit 1.3.14, der in CI gepinnten Version — Bun verweist auf
`bun:sqlite`), und **drizzle-orm 0.45.2 hat keinen `node-sqlite`-Treiber**.
Konsequenz, gekapselt in `server/src/db/driver.ts`:

- **`node:sqlite` ist der primäre Treiber** (Node ≥ 22.16 — ab 22.13 ohne
  Flag, ab 22.16 mit `setReturnArrays`). Der Server läuft damit auf reinem
  Node **ohne native Abhängigkeit**; die Node-Portabilität aus #7 ist real und
  nicht nur behauptet.
- **`bun:sqlite` ist der Fallback,** genutzt genau dann, wenn `node:sqlite`
  fehlt. Das ist die eine dokumentierte Bun-only-API des Projekts.
- Beide hängen hinter EINER Schnittstelle mit identischer Parameter- und
  Zeilenbehandlung. **`test/db-smoke.test.ts` beweist FTS5, Transaktionen und
  UPSERT auf beiden Laufzeiten**; der CI-Job `db-smoke-node` fährt dieselbe
  Datei auf Node. Driftet ein Treiber, ist das das Frühwarnsignal.
- Fällt einer der beiden eingebauten Treiber aus, wäre `better-sqlite3` der
  Ersatz — hinter derselben Schnittstelle, aber **nicht implementiert**: im
  Code existiert er nicht, es ist eine Option für diesen Fall, kein
  vorhandener Notausgang.

**Nachtrag zu ADR #10 (eingelöst in #62):** Generator-Jobs sind persistent
(`generate_jobs`); der dort akzeptierte Verlust bei Neustart entfällt für
fertige Jobs, laufende werden beim Boot auf `failed` mit einer klaren deutschen
Meldung gesetzt. Wortlaut und Begründung stehen im Nachtrag unter #10.

**Bewusst nicht Teil der Entscheidung:** Export/Import jenseits der
Erstmigration, Trigram-Tokenizer für tippfehlertolerante Suche, Auto-Backups,
Mehrnutzer-Betrieb (dafür gelten weiter #3 und die Neubewertung aus #7).

## 14. Referenzieren legt an — ein referenzierter Eintrag fehlt nie

> **Status: final** (#70, PO-Entscheidung im Ticket vorab). Folgt aus #13/#52
> („ein NPC ohne Infos ist eine Zeile mit id und Name") und präzisiert Regel 3
> in `server/src/db/schema.ts`.

**Entscheidung:** Wer über einen Schreibweg der App oder über
`POST /generate/apply` eine unbekannte id referenziert, erzeugt sie. In
derselben Transaktion entsteht eine LEERE Zeile (id, `name` leer → die id ist
der Anzeigename, Status = Spaltendefault). Betroffen: `npcs:` einer Szene,
`location:` einer Szene, sofern der Wert ein Slug ist, und die Gegenseite
einer `## Beziehungen`-Zeile.

- **„Fehlt"-Platzhalter entfallen.** `MissingNpcCard` („NPC-Eintrag fehlt" +
  „Stub anlegen") und `MissingLocationCard` („Ortseintrag fehlt") sind
  gelöscht. Ein leerer Eintrag rendert als normale, dünn befüllte Karte bzw.
  Seite und ist normal editierbar — das ist die Abwesenheit von Information,
  keine Störung.
- **`POST /review/npc-stub` ist idempotent** („anlegen oder verlinken"): kein
  Eintrag → anlegen; LEERER Eintrag → befüllen; befüllter Eintrag → unverändert
  zurückgeben. Das alte `409` ließ den DM eine id korrigieren, die richtig war.
  Der Status ist der Default `unknown` (die Zeile schrieb vorher `alive`,
  gegen ihre eigene Doku).
- **Die Grenze, bewusst gezogen:** `location:` darf laut README freier Text
  sein. Ein Wert, der KEIN Kebab-Slug ist (Leerzeichen, Großschreibung),
  bleibt reiner Text und bekommt keinen Eintrag. Ein slug-FÖRMIGER freier Text
  (`location: hafen`) ist von einer Referenz nicht unterscheidbar und wird als
  Referenz behandelt — das ist der Preis des einen mehrdeutigen Feldes, und der
  Grund für den nächsten Punkt.
- **Bestandsdaten: Boot-Pass nur für NPCs.** Beim Boot legt ein idempotenter
  Pass leere Zeilen für alle noch hängenden `scene_npcs.npc_id` und
  `npc_relations.other_npc_id` an (`store/ref-backfill.ts`) und meldet sie im
  Boot-Log. `scenes.location` bleibt bewusst AUSSEN: ein pauschaler Lauf würde
  aus slug-förmigem Freitext Orte erfinden, die der DM nie geschrieben hat, in
  eine Liste, die er ansehen muss, ohne Rückweg im Werkzeug. Dort greift die
  Lazy-Regel — der nächste Schreibvorgang, der das Feld anfasst, legt an, denn
  dann hat ein Mensch den Wert gerade getippt.
- **Keine Foreign Keys** auf diesen Spalten. Sie halten Freitext und
  Importbestand legal; die Konsistenz kommt aus den Schreibwegen, nicht aus
  einem Constraint, der einen legalen Import scheitern lassen würde.
- **Leer ist nicht fehlt, auch beim Lesen:** eine leere Inbox antwortet 200 mit
  einem leeren Dokument (wie das Glossar seit #57), nicht 404.

**Bewusst NICHT Teil der Entscheidung** (PO-Liste, siehe Ticket #70): die
Gegenseite einer Beziehung automatisch anlegen (das wäre erfundener Inhalt),
die Validierung des Generators lockern (sie schützt vor halluzinierten ids),
`[[slug]]`-Referenzen in Prosa anlegen (die Kind-Zuordnung ist mehrdeutig) und
Kapitel-ids anlegen (eine Szene unter einem unbekannten Kapitel fällt aus dem
Baum, deshalb bleibt es 400).
