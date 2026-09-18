# Grimoire — Entscheidungen (leichtgewichtige ADRs)

Festgehaltene Architektur-Entscheidungen mit Begründung. Neue Entscheidungen
unten anfügen, alte nicht löschen — bei Änderung Status auf `ersetzt durch ADR #N`.

## 1. Source of Truth: Markdown + Frontmatter auf dem Dateisystem

> **Status: ersetzt durch ADR #13.** Die Speicherung ist eine SQLite-Datenbank.
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
- Konfliktschutz: Patch nur bei unveränderter Zeilenversion `rev`, sonst 409.

> **Teilweise überholt (ADR #11 und ADR #13):** Bearbeitet wird in der App; ein
> externer Editor ist kein Datenpfad mehr, weil die Datenbank die Wahrheit
> ist. Was GILT: das Append-only von Session-Log und Inbox (samt der einen
> Ausnahme, dem Abhaken erledigter Inbox-Zeilen) und die Konfliktregel auf
> `rev`.

## 5. Tech-Stack

**Frontend:** Vite + React 19 + Tailwind v4 + shadcn/ui.
Server-State: TanStack Query (Caching, Refetch nach Mutation,
409-Handling). Lokaler UI-State: plain React — kein Zustand/Redux.
Markdown-Rendering: react-markdown + eigenes Remark-Plugin für
`[!callout]`-Blöcke und `## If:`-Überschriften.
GFM nur für Tabellen: `micromark-extension-gfm-table` +
`mdast-util-gfm-table` statt `remark-gfm` — die Sammel-Plugin-Variante
ließe sich nicht auf Tabellen beschränken (Aufgabenlisten würden die
Inbox-Syntax `- [x]` vereinnahmen).
Kein Electron/Tauri — Web-App hinter Tailscale reicht.

**Backend:** Bun + Hono, Drizzle über SQLite (`server/src/db/`), Suche als
FTS5-Index. gray-matter gehört zum Importer/Parser (`@grimoire/shared`), nicht
zum Laufzeit-Stack. `jsonrepair` (exakt gepinnt) im Generator: **jede**
Modell-Antwort ist ein per Schema erzwungenes JSON-Objekt — die Gliederung ihr
eigenes, ein Eintrags-Aufruf das Objekt, das den gespeicherten Eintrag
spiegelt (`properties` je Art, `body`, `warnings`; die Schemata liegen als
lesbares JSON in `shared/schema/`). Ein Endpoint, der `response_format`
annimmt und ignoriert, liefert trotzdem Handgeschriebenes, und dort sind die
Fehler mechanisch (Komma am Ende, einfache Anführungszeichen): eine
deterministische Reparatur vor der Validierung ist deutlich billiger als eine
Korrekturrunde, die den ganzen Prompt erneut sendet. Die Regeln selbst bleiben
unangetastet, und ein reparierter Lauf trägt eine Warnung. Weitere
Abhängigkeiten braucht es nicht — die Antwort trägt die Eigenschaften und den
Text getrennt, genau so, wie der Store sie hält (ADR #24).
Hono statt Express/Fastify: minimal, typsicher, läuft auf Bun UND Node
(Runtime-Wechsel bleibt möglich, siehe ADR #7).

**Icons:** Lucide für UI-Chrome (konsistent mit shadcn);
game-icons.net (CC BY) für thematische Marker (Entitäts- und
Callout-Typen). Benötigte SVGs als eigene Komponenten einchecken.

**Deployment:** ein Docker-Container (Bun-Image), Volume auf
`GRIMOIRE_DATA`, erreichbar nur über
Tailscale. Details: docs/DEPLOYMENT.md.

## 6. LLM-Generator

Pipeline mit Review-Vorschau, nie Direkt-Schreiben; Drafts immer
`status: draft`. Provider hinter Interface (`server/src/llm-provider.ts`):
Start Claude API, Umschalten auf LM Studio per Env-Var. Mechanische
Validierung nach Generierung, Fehler als Korrektur-Turn ans LLM
(konfigurierbar über LLM_CORRECTION_TURNS, 0–2; Default 1 —
nicht heilbare Fehlerklassen wurden eliminiert, verbleibende Formfehler
repariert ein Turn). Details: generator/README.md.

## 7. Wachstums-Pfad (damit ADR #5 keine Sackgasse ist)

Bun/Hono ist keine „nur für klein"-Entscheidung, aber die Grenzen sind
benannt:

- **App-Level-Auth später nötig?** Erst prüfen, ob Forward Auth im Proxy
  (Authelia/authentik) reicht — das deckt auch „Zugriff von fremden
  Geräten" ab, ohne App-Code (ADR #3 bleibt gültig). Falls doch in-App:
  Hono bringt Middleware für Basic Auth, JWT und Sessions mit; das ist
  ein Middleware-Layer, kein Rewrite.
- **Mehr Daten / komplexere Queries?** *Eingetreten und entschieden in
  ADR #13* — allerdings anders als hier vermutet: SQLite ist nicht Index/Cache
  geworden, sondern die Quelle der Wahrheit; das Dateisystem ist nur noch
  Import-Quelle.
- **Bun-spezifisches Risiko?** Hono läuft unverändert auf Node; die einzige
  registrierte Bun-Kopplung ist `bun:sqlite` als Fallback hinter
  `server/src/db/driver.ts` — primär läuft `node:sqlite`; `better-sqlite3`
  wäre der Ersatz, wenn beide ausfallen, ist aber nicht implementiert (ADR #13).
  Runtime-Wechsel = Deployment-Änderung, kein Code-Umbau, solange keine
  weiteren Bun-only-APIs benutzt werden. Diese Regel gilt: **Bun-only-APIs
  nur mit Eintrag hier.**
- **Echte Mehrnutzer-/Rechte-Anforderungen?** Dann ist nicht die Runtime
  das Problem, sondern Datenmodell (ADR #1) und Auth-Modell (ADR #3) — an dem
  Punkt bewusst neu entscheiden statt anbauen.

## 8. Monorepo mit Bun-Workspaces und shared/-Paket

Repo als Bun-Workspace-Monorepo: `shared/` (Entitäts-Typen +
Frontmatter-Parser), `server/`, `app/`. Das Datenformat aus README.md ist
damit genau einmal in Code beschrieben; Server und Frontend importieren
dieselben Typen (`@grimoire/shared`). shared/ wird ohne Build-Schritt als
TypeScript-Quelle konsumiert (Bun und Vite können das nativ; Node-Fallback
über tsx, siehe ADR #7). Test-Runner ist `bun test` — Dev-Werkzeug, kein
Runtime-Code; die Bun-only-Regel aus ADR #5 betrifft weiterhin nur
Laufzeit-APIs.

## 9. Client-Aktualisierung: Polling statt SSE

Änderungen sollen in der App sichtbar werden, ohne manuell neu zu laden.
Mechanismus ursprünglich: chokidar beobachtet den Kampagnen-Dateibaum
(`CAMPAIGN_ROOT`, inzwischen auch als Einstellung weg) und invalidiert
pro Kampagne den In-Memory-Suchindex und einen Versionszähler.
**Seit ADR #13 ohne Watcher:** es gibt keinen externen Schreiber mehr, also wird
`campaigns.version` von jedem Write in DERSELBEN Transaktion hochgezählt —
ein Poll kann keine erhöhte Version ohne die zugehörige Änderung sehen.
Unverändert: die App pollt `GET /api/:campaign/version` und
invalidiert ihre Queries, wenn sich der Wert ändert. Das Poll-Intervall
ist rein clientseitig. SSE/WebSockets erwogen und zurückgestellt: für
einen Einzelnutzer (ADR #3) reicht Polling, und SSE ist später ohne
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
vernichtet (ein Vorfall beim PO); das darf konstruktionsbedingt nicht
möglich sein. Job-Store in-memory (Kampagnendateien bleiben die einzige
Platten-Wahrheit, ADR #1); Verlust bei Server-Neustart ist der akzeptierte
Trade-off und wird der UI sauber gemeldet.

**Nachtrag:** Der letzte Satz gilt nicht mehr. Jobs
sind Zeilen in `generate_jobs` (ADR #13), denn mit der Datenbank als Wahrheit gibt
es einen naheliegenden Ort dafür — und der Verlust, den das Job-Modell
verhindern sollte, trat genau hier noch auf: ein Deploy in der Minute zwischen
„fertig" und „Übernehmen" warf ein fertiges Ergebnis weg. Seither überlebt ein
**fertiger** Job (`done`/`failed`) einen Neustart vollständig — Ergebnis,
Fehlerbody und die Review-Edits — und bleibt übernehmbar. Ein **laufender**
Job kann es nicht, weil sein Provider-Call mit dem Prozess starb: der Boot
schreibt jede übrig gebliebene `running`-Zeile auf `failed` mit der Meldung
„Server wurde während des Laufs neu gestartet — Job neu starten"
(`server/src/db/job-boot.ts`), statt die App ins endlose Pollen zu schicken.

**Nachtrag:** Ein Szenen-Lauf ist kein einzelner Provider-Call mehr,
sondern eine **Pipeline** — und damit besteht ein Job aus **Teilen**. Ein
Gliederungs-Aufruf legt fest, welche Szenen es gibt (rein systeminterner
Schritt zur Fehlerreduktion, dem Nutzer wird die Gliederung nie zum Bearbeiten
angeboten — PO, 15.09.); danach ist jede Szene und jeder neue Eintrag ein
eigener Aufruf, drei gleichzeitig.

Konsequenzen für das Job-Modell:

- Die Zeile trägt die Gliederung, die Teile mit Status je Teil
  (`pending | running | done | failed`), Fehlertext und Token-Verbrauch je
  Teil sowie Token- und Aufruf-Summe des Laufs (`pipeline`-Spalte, Migration
  `0010_pipeline_parts`). Der Quelltext des Laufs steht mit in der Zeile, weil
  ein Teil-Neustart denselben Ausschnitt erneut schicken muss.
- Ein **fertiger Teil ist sofort prüfbar und übernehmbar**, während andere noch
  laufen: der Job bleibt `running`, das Ergebnis füllt sich, und die Prüfseite
  zeigt Teile in Gliederungsreihenfolge. Der Job wird `done`, sobald ein Teil
  etwas produziert hat, und `failed` nur, wenn kein einziger Teil durchkam.
  „Übernehmen" verlangt deshalb **kein fertiges Job**, sondern ein Ergebnis:
  409 bleibt für einen gescheiterten Lauf und für einen, der noch keinen Teil
  fertig hat (das ist auch, was einen laufenden Ein-Aufruf-Lauf weiterhin
  unübernehmbar macht — er hat gar keine Teile).
- **Neustart:** laufende (und noch wartende) Teile werden `failed` mit der
  Neustart-Meldung, **fertige bleiben stehen** und übernehmbar. Ein Job ohne
  Teile — der Ergänzen- und der NPC-Lauf bleiben Ein-Aufruf-Läufe — verhält
  sich unverändert.
- **„Erneut versuchen" je Teil:** `POST …/generate/job/:id/parts/:key/retry`
  startet genau diesen Teil neu, aus der gespeicherten Gliederung — in **einer
  Transaktion** über der neu gelesenen Zeile, die nur diesen Teil anfasst:
  während der Kontext-Lesung kann ein Geschwister-Teil fertig werden, und ein
  Rückschreiben der ganzen `pipeline`-Spalte hat dessen Ergebnis überschrieben.
  Ein noch `pending` Teil wird abgelehnt (409) — er gehört dem Pool des Laufs
  und würde sonst zweimal laufen. Abbruch
  („Verwerfen") stoppt die offenen Teile; was schon übernommen wurde, ist ein
  Eintrag und kein Job mehr.
- Ein Lauf pro Kampagne wie bisher, und die Review-Zustände aus ADR #16
  (`written`/`dropped`/`entries`) behalten ihre Schlüssel.

## 11. App-first: Bearbeitung in der App ist das Ziel, der Editor Ausweichlösung

> **Status: ersetzt durch ADR #13.** Die Speicherformat-Konsequenz unten („Markdown
> bleibt vorerst Source of Truth") ist eingelöst und aufgehoben: die benannten
> Trigger sind eingetreten, die Migration ist durch. Die Haltung „alles aus der
> App heraus" bleibt Produktziel — sie ist der Grund für ADR #13.

Revidiert die Gewichtung aus ADR #4: Externes Editieren (VS Code o. ä.) ist
Übergangs-Ventil, nicht Produktziel. Zielbild des PO: alle Pflege-
Operationen aus der App heraus. Priorisierung richtet sich danach.

Speicherformat-Konsequenz: Markdown-Dateien bleiben
vorerst Source of Truth — nicht aus Prinzip, sondern aus Reihenfolge:
Die Editing-UI ist speicheragnostisch (die API ist die Naht),
eine Migration vor fertiger Editing-UI würde eine Bearbeitungs-Lücke
reißen, und der akute Schmerz (id-Umbenennung) ist auf Dateien billig
lösbar (Rename-Kaskade). Erwartete Evolution, vom PO benannt und hier
festgehalten: Job-Persistenz, parallele Jobs und eventuelles
Usermanagement sind die Trigger, bei denen der SQLite-Umzug hinter der
API-Naht als eigenes ADR-Verfahren ansteht — dann mit Editing-UI als
Sicherheitsnetz und Export/Import als Teil des Umzugs.
Wiedervorlage: nach der ersten Editing-UI.

## 12. Release-Prozess: release-please, Versions-Tags, `:latest` nur bei Releases

Deploys sollen bewusste Ereignisse mit Changelog sein, nicht ein Tag, das
bei jedem Merge unter dem laufenden Betrieb mutiert (PO-Anforderung:
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
- Die Build-Id für den Reload-Banner (`GRIMOIRE_BUILD`) bleibt
  erhalten: das Release-Image brennt den Tag ein — derselbe Wert in Bundle
  und Server, sonst zeigte jeder Deploy sein eigenes Banner.

Bewusst nicht dabei: Multi-Arch (amd64 genügt), Auto-Deploy (der PO pullt
weiterhin selbst) und rückwirkende Changelog-Generierung für die Commits vor
diesem Eintrag.

### Nachtrag 2026-09-06: CI baut zur Prüfung, publiziert nie

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

> **Status: final.** Als Entwurf mit Scheibe 1 eingecheckt, damit
> Schema und Werkzeug nicht ohne festgehaltene Begründung im Repo liegen;
> wirksam seit dem Cutover in Scheibe 2; mit Scheibe 4 ist die
> Migration abgeschlossen und dieser Eintrag maßgeblich.
>
> Was die vier Scheiben eingelöst haben:
>
> - **Scheibe 1** — Drizzle-Schema als eine Typquelle, committete Migrationen,
>   FTS5-Custom-Migration, die Einmal-Migration Dateibaum → DB (voller Import,
>   Degradation statt Fehler), `grimoire seed`, Bun+Node-Treiber-Smoke.
> - **Scheibe 2 (Cutover)** — alle Read-/Write-Endpoints als Queries
>   (`server/src/store/`), `rev` als 409-Guard, FTS5 statt Fuse.js,
>   `GET/PUT /:campaign/glossary` auf der Glossar-Tabelle,
>   `GET /:campaign/migration-report` samt leisem UI-Hinweis, Boot =
>   Schema-Migrator + Erstmigration, chokidar-Watcher entfernt (die
>   Versions-Zählung kommt aus `campaigns.version`).
> - **Scheibe 3** — `GET /usage` als Referenzzählung, Rename-Vorschau auf diesen
>   Zahlen.
> - **Scheibe 4** — Generator-Jobs persistent (Nachtrag zu ADR #10), die letzten
>   Dateileser entfernt (`CAMPAIGN_ROOT` liest nur noch
>   `db/migrate-campaigns.ts`), `POST /campaign-meta` entfernt (der Totpfad
>   nach dem Cutover: die Kampagnen-Zeile existiert immer, also gibt es keinen
>   Anlege-Fall mehr — Name und Beschreibung laufen über PATCH /frontmatter,
>   heute `PATCH /properties`, siehe den Nachtrag unten),
>   `name` in Kampagnenliste und Kampagnen-Dokument vereinheitlicht, Doku
>   nachgezogen.
>
> Zwei Abweichungen von der Planung, hier festgehalten, weil sie Verhalten
> ändern: (a) **eine Szene wird über ihre `id` adressiert**, nicht mehr über
> ihren früheren Dateinamen (`scenes.file_slug` entfällt laut Planung, also
> existiert der Dateiname nirgends mehr — die Adresse lautet
> `<kapitel>/<ort>/<id>`, heute ohne Endung); (b) **`POST /rename` ist mit dem Cutover auf die
> Datenbank umgestellt** statt erst in Scheibe 3 — der Datei-Kaskade hätte
> sonst niemand mehr zugesehen.

**Löst ADR #11 ab** (und damit die dort formulierte Reihenfolge „Markdown
bleibt vorerst Source of Truth"). Die dort benannten Trigger sind eingetreten:
Job-Persistenz, Rename als Datenoperation und die
Editing-UI als Sicherheitsnetz stehen. Planung und
PO-Entscheidungen: Planungsfassung 3, final.

**Entscheidung:** Eine SQLite-Datenbank ist die **alleinige** Quelle der
Wahrheit für Kampagneninhalte. Kein Spiegel auf das Dateisystem, kein
Auto-Export, kein Zwei-Wege-Abgleich — die Klasse von Konfliktproblemen, die
ein Spiegel erzeugt, wird nicht gebaut.

- **Markdown ist das Inhaltsformat der `body`-Spalten** — und sonst nichts in
  der Speicherung. Das Body-Vokabular aus README.md (Callouts, `## If:`,
  Hashtags) ist normativ.
- **Ein Body = ein Markdown-Feld,** in der UI als Markdown editierbar
  (PO-Entscheidung). „Blöcke als Zeilen" ist eine bewusst offen gelassene
  Später-Option; das Schema verbaut sie nicht.
- **Das Glossar ist eine strukturierte Tabelle** (Begriff → Erklärung), kein
  Markdown-Blob. Der Ausbau zur Generator-Wissensbasis ist ein Folge-Feature.
- **Altdateien werden nie gelöscht, verschoben oder markiert.** Der Server
  liest überhaupt keinen Kampagnen-Dateibaum (auch nicht beim
  Boot; nur `grimoire seed` liest einen, wenn man ihm einen nennt). Der komplette,
  menschenlesbare Vor-Migrations-Stand bleibt damit liegen — das ist die
  Abfederung der Einbahnstraße, zusammen mit „manueller Export" als bekanntem
  Später-Pfad.
- **Die Migration verliert nie still Inhalt.** Was nicht zu Zeilen wird,
  nennt der Lauf mit Pfad und Grund im Bericht auf stdout; die Datei bleibt
  unverändert im Baum, der ohnehin nur Eingabe ist.
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
  Volume-Sicherung plus Image-Rollback auf einen älteren Versions-Tag (ADR #12).
- **FTS5 statt Fuse.js** für die Suche, als handgeschriebene
  Custom-Migration (Tokenizer `unicode61 remove_diacritics 2`, Ranking
  `bm25(search_fts, 10, 6, 4, 1)`), explizit aus der Store-Schicht gepflegt.
- **`rev` ersetzt `mtimeMs`** als 409-Guard (Zeilenversion statt Dateizeit —
  **PRAGMAs:** `journal_mode=WAL`, `foreign_keys=ON`,
  `busy_timeout=5000`. **`GRIMOIRE_DATA`** (Default `./data`) hält
  `grimoire.db` samt `-wal`/`-shm` — die einzige Dateneinstellung
  überhaupt (siehe Nachtrag unten).

**Treiber — Abweichung von der Planung, hier als Bun-Kopplung registriert
(Pflicht aus ADR #7):** Die Planung ging davon aus, dass `node:sqlite` auf beiden
Laufzeiten verfügbar ist und dass Drizzle einen `drizzle-orm/node-sqlite`
-Treiber mitbringt. Beides trifft nicht zu: **Bun implementiert `node:sqlite`
nicht** (geprüft mit 1.3.14, der in CI gepinnten Version — Bun verweist auf
`bun:sqlite`), und **drizzle-orm 0.45.2 hat keinen `node-sqlite`-Treiber**.
Konsequenz, gekapselt in `server/src/db/driver.ts`:

- **`node:sqlite` ist der primäre Treiber** (Node ≥ 22.16 — ab 22.13 ohne
  Flag, ab 22.16 mit `setReturnArrays`). Der Server läuft damit auf reinem
  Node **ohne native Abhängigkeit**; die Node-Portabilität aus ADR #7 ist real und
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

**Nachtrag (die Datei-Ära ist restlos raus):** Die drei Stellen, an
denen ADR #13 die Dateiwelt noch durchgelassen hat, sind geschlossen. Die
Entscheidung selbst bleibt; das hier ist ihre Vollendung.

- **Kein Import mehr im Produktivpfad.** Eine frische Instanz startet **leer**
  — der Boot öffnet die Datenbank und wendet die Schema-Migrationen an, sonst
  nichts. `CAMPAIGN_ROOT` gibt es nicht mehr (weg aus Config, Dockerfile,
  Compose und DEPLOYMENT.md), `GET /api/:campaign/migration-report` und der
  App-Hinweis dazu sind entfernt. Einträge in eine leere Datenbank zu
  schreiben ist ausschließlich das **Dev-/E2E-Werkzeug `grimoire seed <dir>`**
  (Report auf stdout), das die JSON-Fixtures über die Store-Schicht lädt
  (ADR #20). Der Kaltstart einer echten Kampagne läuft in der UI.
- **Adressen tragen keine Dateiendung.** `campaign`, `inbox`, `glossary`,
  `<kapitel>`, `<kapitel>/[<gruppe>/]<szenen-id>`, `npcs/<id>`,
  `locations/<id>`, `sessions/<id>` — das Schema steht abschließend in
  `server/src/store/paths.ts` und gilt in API, App-Routen, Cache-Keys, Links,
  Usage-/Rename-Antworten und E2E. **Keine Alt-Kompatibilität** (PO: keine
  gespeicherten URLs); eine `.md`-Adresse benennt einfach nichts. Damit fällt
  auch die Endungsregel des Wächters: `assertSafeAddress` weist Traversal,
  absolute Pfade und versteckte Segmente weiter mit 400 ab, aber eine Adresse
  ohne Zeile ist ein ehrliches 404 statt „only .md files are served".
- **Wire und Code sprechen `properties`/`rev`.** `frontmatter` → `properties`,
  `mtimeMs` → `rev`, `PATCH /frontmatter` → `PATCH /properties`; dazu die
  Code-Namen (`patchProperties`, `PropertiesAction`, `writeWithRev`, …).
  `frontmatter`/`mtime` existieren nur noch in `server/src/db/` (dem Importer,
  wo ein Frontmatter-Block wirklich das Thema ist) und als echte Datei-`mtime`
  im Static-Serving (ETag/Last-Modified eines gebauten Assets).

**Nachtrag — Schema ohne Datei-Buchhaltung:** `scenes.chapter_declared` ist
weg (Migration 0011). Das Flag hielt fest, ob ein Frontmatter-Block `chapter:`
nannte, damit `PATCH { chapter: null }` den Key ausblenden konnte; das Kapitel
ist Fremdschlüssel und Teil der Adresse, also immer gerendert, und `null` ist
ein 400. `extra` gehört dem Importer: die API ändert und löscht dort vorhandene
Keys, legt aber keine neuen an (unbekannter Key im Patch → 400). Die
Tabellen `unknown_files` und `migration_report` sind weg (Migration 0012): sie
verwahrten Dateien und Befunde der einmaligen Migration aus dem Dateibaum, den
kein Produktionspfad mehr liest — der Seed-Bericht kommt aus dem Speicher.
Adressen und URL sprechen vom Eintrag: `GET/PUT /api/:campaign/entry`, die
Route `/:campaign/entry/<adresse>`, die Kampagne heißt `campaign` und ein
Kapitel seine id — die Unterstrich-Namen der Ordner-Metadateien sind weg.

**Nachtrag zu ADR #10:** Generator-Jobs sind persistent
(`generate_jobs`); der dort akzeptierte Verlust bei Neustart entfällt für
fertige Jobs, laufende werden beim Boot auf `failed` mit einer klaren deutschen
Meldung gesetzt. Wortlaut und Begründung stehen im Nachtrag unter ADR #10.

**Bewusst nicht Teil der Entscheidung:** Export/Import jenseits der
Erstmigration, Trigram-Tokenizer für tippfehlertolerante Suche, Auto-Backups,
Mehrnutzer-Betrieb (dafür gelten weiter ADR #3 und die Neubewertung aus ADR #7).

## 14. Referenzieren legt an — ein referenzierter Eintrag fehlt nie

> **Status: ersetzt durch ADR #19.** Diese Entscheidung ließ jeden Schreibweg den
> Eintrag anlegen, den er referenziert; ADR #19 dreht das um — eine Referenz
> nennt einen vorhandenen Eintrag, alles andere wird abgelehnt. Was von hier
> GILT: ein leerer Eintrag ist kein Fehler (dünne Karte, normal befüllbar,
> kein „fehlt"-Platzhalter), eine leere Inbox antwortet 200 statt 404, und
> „NPC-Stub anlegen" ist idempotent — vorhandener Eintrag wird verlinkt, ein
> leerer gefüllt, ein gefüllter unverändert zurückgegeben.

## 15. i18n: typisierter TS-Katalog + ICU über `intl-messageformat`

> **Status: final.** Gilt für alles Nutzersichtbare in `app/` **und**
> für jeden Fehler-Body des Servers, den ein Mensch liest. Der Zuschnitt in
> Scheiben ist mit dem PO-Feedback entfallen: die Migration ist
> vollständig, das Lint-Gate ist überall scharf.

**Entscheidung:** Nutzersichtbare Texte stehen im Katalog
`app/src/i18n/` — `de.ts` (Primärsprache, CLAUDE.md) und `en.ts`, beide als
TS-Objekte. `de.ts` definiert den Key-Satz (`MessageKey = keyof typeof de`),
jede weitere Sprache ist ein totales `Record<MessageKey, string>`. Ein
fehlender Key und ein Key, den es nur in `en.ts` gibt, sind beide ein
**Typfehler** — kein Build-Schritt, kein Extraktions-Tool, kein
Laufzeit-Fallback auf eine andere Sprache nötig.

Interpolation und Plural sind **ICU MessageFormat** über
**`intl-messageformat`** (≈10 kB gzip, ein Paket, keine Peers).

**Warum nicht `i18next`:** Es bringt ein eigenes Ressourcen-, Namespace- und
Backend-Modell mit (plus `react-i18next` für den Hook) für Probleme, die ein
Einzelnutzer-Tool mit zwei Sprachen und einem Bundle nicht hat; Plural läuft
über Key-Suffixe (`_one`/`_other`) statt im Text, was die Form aus dem Satz
zieht; und Typsicherheit erfordert Module-Augmentation und generierte
Typen statt eines `keyof`. `intl-messageformat` ist das kleinere Stück:
reiner Formatter, wir behalten Katalog und Laden selbst in der Hand.

**Kriterien, die entschieden haben:**

- **Größe:** ein Paket, ≈10 kB gzip; `i18next` + `react-i18next` ist mehr
  Laufzeit für weniger Typsicherheit.
- **Keine Locale-Downloads:** Pluralkategorien kommen aus dem eingebauten
  `Intl.PluralRules`, Datums-/Zahlformate aus `Intl` — nichts wird zur
  Laufzeit nachgeladen, was ein selbst gehostetes, offline nutzbares Tool
  ohnehin nicht dürfte.
- **Plural/ICU im Text:** `{count, plural, one {# Eintrag} other {# Einträge}}`
  — die Form steht im Satz, wo Übersetzende sie sehen.
- **Typsicherheit:** über `keyof`, ohne Codegen.

**Regeln, die daraus folgen:**

- `t(key, params)` kommt in Komponenten aus `useT()`/`useI18n()`. Reine
  Helfer in `app/src/lib/` **bekommen den Translator als Argument** — die
  lib-Ebene entscheidet nie, in welcher Sprache die UI läuft.
- Ein Wert mit Markup mitten im Satz wird über `tNode` zu Parts formatiert,
  niemals aus zwei Halbsätzen zusammengeklebt.
- Zeitangaben laufen über `Intl` mit der gewählten Sprache, nicht über
  handgebaute Formate.
- **Die Sprache ist eine Instanz-Einstellung auf dem Server**
  (`GET/PUT /api/settings`, Zeile `setting:locale` in `meta`). Kein
  localStorage (Qualitäts-Boden: der Server ist die Wahrheit). Ohne
  gespeicherten Wert folgt die App `navigator.language` (`de*` → de, sonst
  en) und schreibt nichts.
- **Der erste Paint ist gegated.** Solange `GET /api/settings` läuft, rendert
  `I18nProvider` nichts Sprachabhängiges, sondern eine neutrale Shell (nur das
  Wortmarken-Glyph). Sonst zeigt eine auf Deutsch gestellte Instanz im
  englischen Browser für einen Frame englische Chrome und tauscht sie dann aus
  — genau in dem Moment, in dem sonst nichts auf dem Schirm ist. Folge:
  unterhalb des Providers ist `isPending` immer `false`, kein View muss einen
  Zustand „Sprache noch unbekannt" behandeln.
- **`<html lang>` folgt der Sprache**, gesetzt im Provider. `index.html` kann
  nur einen statischen Wert tragen; ein falsches `lang` spricht die Seite im
  Screenreader falsch aus und trennt sie falsch.
- **Die Sprachwahl steht auf einer Einstellungsseite,** nicht im Menü des
  Kampagnen-Switchers (PO-Feedback). Route `/settings`,
  kampagnenunabhängig, Einstieg ist **ein** Zahnrad-Icon rechts im Topbar
  (icon-only bei jeder Breite, damit es die Leiste nicht wachsen lässt).
  Begründung: das Switcher-Menü ist, wo man eine *Kampagne*
  wählt; eine instanzweite Einstellung darin ist schwer zu finden und
  kategorial falsch. Die Seite trennt **Instanz-Abschnitte** (heute: Sprache)
  von **Kampagnen-Abschnitten** (`CAMPAIGN_SECTIONS`, zunächst leer, heute
  Glossar und Kampagnenwissen); ohne Kampagne entfällt die zweite Hälfte samt
  Überschrift.
- **Der Umschalter bleibt zusätzlich dort, wo es kein Chrome gibt** — über
  `components/LanguageSwitch.tsx` (gleiche Radio-Semantik, native Radios) als
  Fußzeile auf dem **Kaltstart** (keine Kampagne, kein Switcher) und auf der
  **mobilen Startfläche** (die den Topbar unter `md` ersetzt, das Zahnrad also
  gar nicht zeigt). Mobil bewusst **inline statt Link auf `/settings`**: die
  mobile Fläche ist Nachschlagen und Einwerfen (UI-BRIEF), die Lesesprache ist
  die eine Instanz-Einstellung, die ein Telefon plausibel braucht — die übrigen
  Abschnitte der Seite sind Vorbereitungsarbeit am Schreibtisch. Alle drei
  Flächen lesen und schreiben dieselbe Server-Einstellung über `useI18n` —
  keine zweite Wahrheit.
- **Der Server ist sprachfrei.** Jeder Fehler-Body, den ein Mensch liest,
  trägt einen stabilen `code` (`shared/src/error-codes.ts`) plus die
  Parameter, die sein Satz braucht; der `error`-Text bleibt als **englischer
  technischer Fallback** daneben (curl, Log, fremder Client). Die App bildet
  den Satz aus dem Katalog (`app/src/i18n/server-errors.ts`, Keys
  `server.<code>`). **Degradiert** nach der CLAUDE.md-Regel: kein Code, ein
  unbekannter Code oder ein Body ohne die versprochenen Parameter fallen auf
  den englischen `error`-Text zurück, danach auf den generischen Satz des
  Views — nie auf eine leere Meldung. Codes sind **append-only**. Texte, die
  nur im CLI/Log erscheinen (`grimoire seed`, Boot), bleiben englisch und
  bekommen keinen Code.
- **Lint-Gate:** `react/jsx-no-literals` (`bun run lint`, in CI) — **`error`
  überall** in `app/src`. Die zweistufige Variante (scharf für migrierte
  Dateien, `warn` für den Rest) war die To-do-Liste der Scheiben; die gibt es
  nicht mehr. Die `allowedStrings`-Liste ist die einzige Ausnahme und trägt
  ausschließlich Nicht-Copy: Trennzeichen, Tastennamen (`⌘K`, `esc`) und im
  Block-Composer angezeigte Markdown-Marker (`[!`, `]`).
  **ESLint bleibt auf `^9`:** `eslint-plugin-react@7.37.5` deklariert als Peer
  `… || ^9.7` und kennt ESLint 10 nicht; da dieses Gate genau aus einer Regel
  dieses Plugins besteht, ist die Major-Version des Linters die kleinere
  Abhängigkeit. Anheben, sobald das Plugin ESLint 10 als Peer führt.
- Enum-Labels, die sich viele Views teilen (Szenen-/NPC-Status in
  `lib/scene-status.ts`, `lib/entity.ts`), kommen ebenfalls aus dem Katalog;
  die Helfer nehmen dafür `t: Translate` als Argument (`sceneStatusMeta`,
  `sceneStatusOptions`, `npcStatusLabel`, `browseListTitle`). Ein **unbekannter**
  Wert wird weiter verbatim angezeigt — die Datei bleibt die Wahrheit.

## 16. Der Prüfzustand einer Generierung gehört auf den Job

> **Status: final.** Betrifft den Generator-Prüfschritt (Szenen, NPC)
> und den „Mit KI ergänzen"-Lauf.

**Entscheidung:** Alles, was der DM im Prüfschritt tut — Text bearbeiten,
vorgeschlagene Einträge annehmen/ablehnen, Szenen aus dem Lauf nehmen, je
Feld/Block übernehmen oder behalten — steht als Spalte auf der Job-Zeile
(`generate_jobs.review`), nicht im Browser. Die App liest ihren Zustand aus
dem Job und schreibt jede Änderung zurück: Texteingaben debounced (~600 ms)
und spätestens beim Verlassen des Feldes, Entscheidungen sofort.

**Warum:** ADR #10 hat den LAUF serverseitig gemacht, weil ein Browser-Zurück
zwanzig Minuten Modellarbeit vernichtet hat. Der Prüfschritt hatte genau
dasselbe Problem eine Ebene höher — er ist die Arbeit, die der DM selbst
hineinsteckt, und sie war flüchtiger als das Ergebnis, das sie bearbeitet.
Mit dem Job als Zeile (ADR #13) ist die Zeile der offensichtliche Ort; ein
zweiter Speicher (localStorage) verbietet sich ohnehin (Qualitäts-Boden: der
Server ist die Wahrheit).

**Konsequenzen:**

- Der Zustand hat ein eigenes `rev`. Zwei Tabs sind der Normalfall, nicht die
  Ausnahme: der zweite `PATCH …/review` bekommt `409 rev_conflict` und die App
  lädt neu, statt die Entscheidung des anderen still zu überschreiben. Es ist
  dasselbe Protokoll wie bei jedem anderen Schreibzugriff (ADR #4) — kein
  zweites Konfliktmodell.
- Ein Lauf ist damit **teilweise übernehmbar**: `POST …/job/:id/accept`
  schreibt genau die gewählten Teile in einer Transaktion (Konfliktprüfung
  drin, FTS und Referenzen folgen) und vermerkt sie im selben Commit auf dem
  Job. Der Job verschwindet von selbst, sobald nichts mehr offen ist.
- **„Verwerfen" nimmt nur den offenen Rest mit** (Lead-Entscheid).
  Was einzeln übernommen wurde, ist ein Eintrag und kein Job mehr — es im
  Prüfschritt weiter zu bearbeiten ist ausdrücklich kein Ziel, dafür gibt es
  den normalen Editor.
- Kein Undo-Verlauf und kein Merge zwischen zwei Bearbeitern. Grimoire ist
  einbenutzerig; „zwei Tabs" ist ein Konflikt, den man meldet, keiner, den man
  zusammenführt.

## 17. Die Gruppe einer Szene IST ihr `location` — kein eigenes Feld

**Entscheidung:** `scenes.group_slug` entfällt ersatzlos (Migration 0009).
Adresse und Kapitelgruppierung einer Szene werden aus der Spalte `location`
abgeleitet: `<kapitel>/<location>/<id>`, ohne `location` `<kapitel>/<id>`.
`location` ist damit immer eine Orts-id oder leer — Freitext wird mit
`400 location_not_an_id` abgelehnt, eine id ohne Eintrag mit
`400 location_unknown` (ADR #19).

**Warum:** `group_slug` („rein eine Anzeige-Gruppierung") und `location`
waren zwei unabhängige Werte für dieselbe Sache — ein Erbe der
Verzeichnisstruktur aus der Markdown-Zeit. Sobald der DM im Prüfschritt oder
in den Eigenschaften den Ort korrigierte, blieb die Gruppe stehen: Anzeige
und Adresse widersprachen dem Feld, das der DM gerade gesetzt hatte. Zwei
Quellen für eine Wahrheit driften immer; die Reparatur ist, eine davon
abzuschaffen, nicht sie zu synchronisieren.

**Abgeleitete Spalte vs. Entfernen:** Eine beibehaltene, abgeleitete Spalte
hätte jeden Schreibpfad (Patch, Roh-Editor, Import, Generator-Übernahme,
Ergänzen) verpflichtet, sie mitzuziehen — also genau die Drift-Möglichkeit
konserviert, die diese Entscheidung beseitigt. Sie fällt weg; `store/paths.ts`
`sceneAddress(row)` ist die eine Stelle, die die Ableitung kennt.

**Konsequenzen:**

- **Eine Szenen-Adresse ist nicht stabil, die id ist es.** Der Store löst
  eine Szene über ihre **id** auf und ignoriert das Gruppen-Segment der
  Adresse; die Antwort trägt in `path` die aktuelle Adresse. Die App
  vergleicht und ersetzt die URL (`replace`, kein History-Eintrag). Ein
  3xx-Redirect wäre die andere Möglichkeit gewesen — dagegen spricht, dass
  `fetch` ihm folgt, ohne dass die App die Ziel-URL erfährt: die Adresszeile
  bliebe dann falsch. `[[id]]`-Referenzen, `scenes_played` und die
  Log-Marker adressieren ohnehin über ids und sind nicht betroffen.
- **Der Schreibschutz bleibt `rev`** (ADR #4), nicht die Adresse. Dass ein
  Schreibzugriff über eine veraltete Adresse die richtige Zeile trifft, ist
  gewollt; dass er einen Stand überschreibt, den er nicht gesehen hat, fängt
  weiterhin der Rev-Check ab.
- **Der Generator vergibt keine Pfade mehr** (generator/README):
  das Modell liefert Dokumente, der Server bildet die Adresse aus Kapitel +
  `id` und die Gruppe aus `location`. Der Prüfschritt adressiert Teile über
  `<kapitel>/<id>`; die tatsächlich geschriebene Adresse steht in der
  Antwort (`written`).
- **Migration in zwei Schritten.** Der Datenschritt braucht `group_slug`,
  Migration 0009 löscht die Spalte — also läuft er **vor** dem Migrator, auf
  dem rohen Client (`db/group-migration.ts`, aufgerufen aus `openDb`). In
  SQL ginge er nicht: aus Freitext eine id zu machen ist die deutsche
  Transliteration aus `@grimoire/shared/slug`. Er ist idempotent (die Spalte
  ist danach weg) und meldet beim Start jede Szene, deren Adresse sich
  geändert hat.
- **Die Fixtures nennen den Ort selbst:** jede Beispielszene trägt ihr
  `location` in den Eigenschaften, und der Seed schreibt es unverändert —
  eine Gruppe wird nirgends mehr aus einer Adresse abgeleitet.

## 18. Das Kapitel entsteht aus dem Lauf, sein Status ist ein Enum

**Entscheidung (a): Das Kapitel eines „Neues Kapitel"-Laufs entsteht aus dem
Zustand des Laufs, nicht aus dem des Browsers.** Der Titel wird beim **Start**
am Job vermerkt (`generate_jobs.new_chapter_title`, Migration 0013), und die
Übernahme legt das Kapitel daraus an — idempotent und im selben Vorgang wie die
Szenen. Der Prüfschritt ist persistent (ADR #16), die Übernahme passiert also
regelmäßig nach Navigation oder Reload; Titel und id dürfen dann nicht im
Browser liegen. `chapter`/`chapterTitle` am Übernahme-Aufruf bleiben ein
Override für den Ganz-Lauf-Endpoint und ältere App-Stände; die App sendet sie
nur, solange das Formular auf dem Schirm das des laufenden Jobs ist.

Die Übernahme legt das Kapitel auch dann an, wenn kein übernommener Teil es
nennt: das Kapitel gehört dem Lauf, nicht dem einzelnen Teil. Ein generierter
Szenen-Entwurf bekommt sein Kapitel im selben Schreibvorgang; ist die
Kapitel-id kein Slug, ist das 400. **Die Dialoge bleiben unverändert:** ein
Kapitel, das der DM tippt, muss existieren (400, ADR #19) — dort ist ein
unbekanntes Kapitel ein Tippfehler.

**Entscheidung (b): Der Kapitel-Status ist ein Enum** `planned | active | done`,
genau einmal in `shared/` definiert (`CHAPTER_STATUSES`), Labels de „Geplant /
Aktiv / Abgeschlossen", en „Planned / Active / Done". Die API schreibt nur
diese drei Werte und antwortet sonst **400**; ein bereits gespeicherter
Fremdwert wird weiterhin **verbatim angezeigt**, und es gibt keine Prüfregel im
Schema — das Format degradiert wie überall, nur der Schreibweg ist eng. Ein neu
angelegtes Kapitel startet auf `planned`.

`active` ist **eine Entscheidung über zwei Kapitel**, und „genau ein aktives
Kapitel" gehört dem **Feld, nicht einem Endpoint**: `POST /chapters/:id/active`
und ein `PATCH /properties`, dessen Status auf `active` landet, führen denselben
Tausch im selben Vorgang aus. Sonst wäre der Eigenschaften-Dialog eine zweite
Tür daran vorbei. Der Tausch-Endpoint hat bewusst **keinen rev-Schutz**: er
setzt einen Wert und ändert dabei absichtlich ein Kapitel, das der Aufrufer nie
gelesen hat; `PATCH /properties` behält seinen (ADR #4).

In der Kapitelübersicht ist die Status-Anzeige deshalb **das Bedienelement**
(wie beim Szenen-Status, gemeinsames Markup in `components/StatusMenu`):
„Aktiv" ruft den Tausch, „Geplant" und „Abgeschlossen" patchen das Kapitel.
Die Auswahl des Werts, der schon angezeigt wird, schreibt nichts — bei „Aktiv"
wäre das ein zweiter Tausch. Mobil bleibt der Status **Anzeige**: unter `md`
rendert die Route die Startfläche statt der Kapitelübersicht, die Regel steht
also genau an einer Stelle.

## 19. Jede Referenz ist ein Fremdschlüssel — eine Nennung legt nichts an

**Entscheidung:** Jede gespeicherte Referenz bekommt einen zusammengesetzten
Fremdschlüssel `(campaign_id, <referenz>)` mit `ON UPDATE CASCADE` und
`ON DELETE NO ACTION` (Migration 0014). Eine Referenz nennt damit einen
Eintrag, den es gibt — und die Datenbank ist es, die das garantiert.

| Referenz | Ziel | Pflicht |
| -------- | ---- | ------- |
| `scenes.chapter_id` | `chapters` | ja — eine Szene gehört zu einem Kapitel |
| `scenes.location` | `locations` | nein |
| `scene_npcs.npc_id` | `npcs` | ja |
| `npcs.chapter_id` | `chapters` | nein |
| `locations.chapter_id` | `chapters` | nein |
| `log_entries.scene_id` | `scenes` | nein |
| `session_scenes_played.scene_id` | `scenes` | ja |

`generate_jobs.chapter` bleibt ohne Fremdschlüssel: ein Lauf mit „Neues
Kapitel" nennt das Kapitel, das er selbst anlegt — beim Übernehmen des
Vorschlags entsteht der Kapitel-Eintrag zusammen mit den Szenen.

**Eine Nennung legt nichts an.** Ein Eintrag entsteht über „Neu anlegen",
über „NPC-Stub anlegen" und über das Übernehmen eines Generator-Vorschlags,
sonst nirgends — und dazu gehört das Kapitel eines „Neues Kapitel"-Laufs, das
die Übernahme aus dem Lauf anlegt (ADR #18). Ein übernommener Szenen-Vorschlag
nimmt außerdem die vorgeschlagenen Einträge mit, die er nennt: sie sind Teil
desselben Vorschlags, und was der DM abgelehnt hat, bleibt abgelehnt — dann
wird die Szene abgewiesen und nennt den fehlenden Eintrag.

**Das Mitschreiben ist ein Zwischenstand.** Eine übernommene Szene schreibt
die vorgeschlagenen Einträge mit, die sie nennt, damit ein Lauf nicht an
seinen eigenen Referenzen scheitert — nicht, weil das die gewollte Lösung
wäre. Gewollt ist ein Review in Referenz-Reihenfolge: erst die Orte, dann die
NPCs, dann die Szenen, sodass nichts geschrieben wird, bevor seine Ziele
existieren. Das ist als eigene Arbeit festgehalten und dreht diesen Punkt
wieder zurück.

Wer in `npcs:`, `location:`, `chapter:`, in einer Schnellnotiz oder in
`scenes_played:` etwas einträgt, das keinen Eintrag hat, bekommt 400 mit
einem eigenen Code (`npc_unknown`, `location_unknown`,
`chapter_unknown`, `log_scene_unknown`, `played_scene_unknown`) und dem
Hinweis, den Eintrag zuerst anzulegen; geschrieben wird nichts.

**Eine Nennung im Text ist keine Referenz.** `[[id]]` und die Zeilen unter
`## Beziehungen` bleiben sichtbarer Text: `npc_relations` entfällt, weil
nichts in der Speicherung aus Text abgeleitet wird — eine Beziehung als
Daten wären Eigenschaften im Dialog und im Generator, kein geparster
Abschnitt. Ein `[[id]]` ohne Eintrag wird als Text angezeigt, ohne Fehler.

**Umbau statt ALTER TABLE:** SQLite kann einer bestehenden Tabelle keinen
Constraint hinzufügen, deshalb baut die Migration die sieben betroffenen
Tabellen neu auf — der dokumentierte Weg. Der Migrator läuft in einer
Transaktion, in der `PRAGMA foreign_keys` ignoriert wird, also würden die
Kind-Einträge beim Ersetzen ihrer Eltern mitgelöscht: sie werden vorher in
Hilfstabellen derselben Transaktion gesichert und danach zurückgeschrieben.

**Vorabprüfung statt Reparatur:** Vor den Constraints prüft
`db/reference-preflight.ts`, ob jede Referenz auflösbar ist. Wenn nicht,
bricht der Start ab und nennt im Log pro Tabelle und Spalte die Werte ohne
Eintrag und ihre Anzahl, mit dem Hinweis, die Daten zuerst in der vorherigen
Version oder direkt in der Datenbank zu korrigieren; es wird nichts
migriert. Nichts wird dabei angelegt, umgeschrieben oder verworfen — das
sind Entscheidungen, die nur der DM treffen kann.

**Bewusst nicht Teil der Entscheidung:** ein Löschweg für Einträge (es gibt
keinen; `ON DELETE NO ACTION` sagt nur, dass ein solcher Weg eine eigene
Entscheidung braucht) und ein Umgang mit Referenzen zwischen Kampagnen (die
Fremdschlüssel schließen sie aus, weil `campaign_id` Teil jeder Referenz
ist).

## 20. Fixtures sind JSON-Einträge, es gibt keinen Import

**Entscheidung:** Die Beispielkampagne liegt unter `fixtures/` als Einträge in
der Form, die die API spricht — eine JSON-Datei je Eintrag mit `kind`, den
Eigenschaften unter `properties` und dem Text unter `body`; Sessions, Ideen und
Glossar tragen ihre Listen strukturiert. `grimoire seed <dir>` liest
`<dir>/<kampagne>/*.json` und schreibt die Einträge über die Store-Schicht.
Einen Markdown-Importer gibt es nicht.

**Warum:** Der Importer war die Einmal-Migration einer alten
Markdown-Kampagne. Kein Produktivpfad importiert, und wer die App frisch
installiert, fängt nicht mit einem Verzeichnisbaum an, sondern legt seine
Kampagne in der UI an. Ein Seed, der durch einen Parser läuft, prüft damit
den Parser statt den Speicher — und Fixtures in der Form der API sind
gleichzeitig die Referenz dafür, was die API antwortet.

**Folgen:**

- Die Spalte `extra` entfällt: sie hielt Felder, die nur ein Import
  mitbringen konnte.
- Die Planungsentscheidung F5 („kein zweites Datenformat für Fixtures") ist
  zurückgezogen: es gibt genau ein Fixture-Format, und es ist das Format der
  API.

## 21. ids sind unveränderlich

**Entscheidung:** Die `id` eines Eintrags wird beim Anlegen gesetzt und ändert
sich danach nie. Der Eigenschaften-Dialog zeigt sie als Kontext, bietet aber
keine Änderung; `PATCH /properties` lehnt ein `id`-Feld mit 400 ab.

**Warum:** Die id ist der Referenz-Schlüssel des ganzen Modells — sie steht in
jeder Adresse, in jedem Fremdschlüssel und in jeder `[[id]]`-Referenz im Text.
Ein Apparat, der sie nachträglich überall mitzieht, ist der teuerste Teil der
Schreibschicht und wird praktisch nie gebraucht: Die Personalisierung der id
passiert einmal, im Anlege-Dialog. Ein Eintrag, der einen besseren **Titel**
bekommt, braucht keine neue id — `[[id]]`-Referenzen lösen immer auf den
aktuellen Anzeigenamen auf, also stimmt der Text ohnehin überall.

**Folgen:**

- Es gibt keinen Endpoint, der eine id ändert, keine Referenz-Kaskade und
  keinen Verwendungs-Bericht (`GET /usage` diente nur der Vorschau davor).
- Die `ON UPDATE CASCADE`-Fremdschlüssel bleiben im Schema: sie halten Kind-
  Zeilen ehrlich und kosten nichts.
- Anzeigenamen bleiben frei änderbar; der Suchindex zieht die referierenden
  Einträge dabei nach (`server/src/store/refs.ts`).

## 22. Ein URL-Schema: alles Kampagnenabhängige unter `/campaigns/:id`

**Entscheidung:** Jeder kampagnenabhängige Pfad hängt unter der Kampagne — in
der API `/api/campaigns/:id/…`, in der App `/campaigns/:id/…`. Die Mehrzahl
`campaigns` ist gesetzt, auch für den einzelnen Eintrag
(`GET /api/campaigns/:id`). Die Adresse eines Eintrags steht im **Pfad**:
`GET /api/campaigns/beispiel/entries/01-salzhafen/leuchtturm/ankunft-leuchtturm`,
in der App `/campaigns/beispiel/entries/<adresse>`. Kampagnenlos bleiben
`/api/campaigns`, `/api/settings` und `/settings`. Es gibt kein Alt-Schema und
keine Umleitungsschicht: alte URLs antworten 404.

**Warum:** Die Kampagnen-id stand als erstes Segment und kollidierte damit mit
jedem kampagnenlosen Pfad — `/:campaign` traf auch `/settings`. Das erzwang
Sonderfälle an drei Stellen der App (eine Liste der Nicht-Kampagnen-Segmente,
eine Umleitung im Kampagnen-Scope und eine eigene Herleitung im Topbar), die
mit jedem neuen kampagnenlosen Pfad mitwachsen. Mit dem Präfix ist die
Kollision ausgeschlossen statt abgefangen, und Erweiterungen haben ein Muster.
Die Adresse im Pfad macht die URL zur Adresse: eine Leseansicht ist ein Pfad,
kein Query-Parameter, und `PUT` braucht die Adresse nicht mehr im Rumpf.

**Folgen:**

- `PUT /api/campaigns/:id/entries/<adresse>` nimmt `{ rev, body }`; das Feld
  `path` im Rumpf entfällt. `PATCH /properties` behält seine Form. Der eine
  Schreibweg je Eintrag (ein `PATCH` für Eigenschaften und Text) ist eine
  eigene Entscheidung und folgt.
- Die Kollisions-Sonderfälle sind gelöscht, nicht angepasst.
- `.`- und `..`-Segmente erreichen den Server nicht mehr: jeder URL-Parser
  löst sie vorher auf. Was ankommt, ist eine gewöhnliche Adresse — die
  Antwort ist 404, nicht die 400 der Adressprüfung, die für absolute Pfade,
  Backslashes und versteckte Segmente weiter gilt.

## 23. Ein Schreibweg je Eintrag

**Kontext:** Ein Eintrag wurde über zwei Endpoints geschrieben: `PATCH
/properties` für die Felder und `PUT /entries/<adresse>` für den Text, jeder
mit eigenem Aufruf und eigener 409. Beide treffen dieselbe Zeile, also
denselben Wächter `rev` — wer nacheinander speichert, macht seine erste
Antwort selbst ungültig. Die App umging das mit einer Regel, die den Text als
„textneutral" behandelte und den nächsten `rev` erriet, statt ihn zu kennen.
Dazu war die Adresse `glossary` der letzte Weg, auf dem Text zurück in
Spalten geparst wurde.

**Entscheidung:** Ein Eintrag hat genau einen Schreibweg:

    PATCH /api/campaigns/:campaign/entries/<adresse>
    { rev, properties?, body?, force? }

- Mindestens eines von `properties` und `body` muss dabei sein, sonst 400
  `nothing_to_write`. Beides zusammen ist **ein** Schreibvorgang in einer
  Transaktion, gegen **einen** `rev`: eine Zeilen-Änderung, ein Schritt von
  `rev`, ein Versions-Zähler, ein Index-Lauf. Wie viel eine Anfrage trägt,
  ist an `rev` nicht ablesbar.
- Ein veralteter `rev` ist 409 `rev_conflict` und trägt neben dem aktuellen
  `rev` den **aktuellen Eintrag** — der Konfliktdialog zeigt, was im Weg
  steht, ohne nachzuladen. Dieselbe 409-Form gilt für jeden Schreibzugriff
  mit Wächter.
- `force: true` schreibt auf die Zeile, wie sie jetzt ist, und schreibt nur
  die mitgeschickten Felder: ein fremd geänderter Status übersteht also ein
  erzwungenes Text-Speichern.
- Glossar, Kampagnenwissen und Ideen sind **Listen**. Sie werden auf ihren
  Seiten über ihre eigenen Endpoints gepflegt und nehmen keinen `body` an
  (400 `body_not_editable`). Es gibt keinen Parser mehr, der Text in Zeilen
  zurückliest.
- Die App hält den `rev` der laufenden Bearbeitung und schickt ihn mit,
  statt ihn einzufrieren und zu raten. Die „textneutral"-Regel entfällt.

**Folgen:**

- `PATCH /properties` und `PUT /entries/<adresse>` sind gelöscht — keine
  Umleitung, kein Alias. Die Endpoint-Namen in älteren Entscheidungen (#4,
  #13, #19, #22) sind damit überholt; die Regeln dahinter — Wächter statt
  stilles Überschreiben, Referenzen sind Fremdschlüssel — gelten weiter.
- In der Schreibschicht gibt es eine Funktion statt drei
  (`server/src/store/write.ts` `patchEntry`); der Generator-Apply benutzt
  genau sie, also gelten dort dieselben Prüfungen.
- `campaigns.glossary_intro` wird nicht mehr geschrieben. Die Spalte bleibt
  und wird weiter angezeigt, damit ein älterer Bestand seinen Vorspann
  behält.
- Jeder Anlege-Endpoint antwortet wie eine Änderung mit dem Eintrag; `POST
  /api/campaigns` bleibt die Ausnahme und antwortet mit der
  Kampagnen-Übersicht, weil es keine Kampagne betritt, sondern eine anlegt.
- Die 400 `body_not_editable` für einen `body` auf Glossar, Ideen oder
  Session ist eine Zwischenlösung, solange diese Listen noch eine
  Eintrags-Adresse haben; die Adresse fällt in einer eigenen Entscheidung,
  damit fällt der Code.

## 24. Der Generator kennt kein Markdown-Zwischenformat

**Entscheidung:** Ein Entwurf des Generators ist von der Antwort des Modells
bis in die Zeile ein Paar aus `properties` und `body`. Der Server setzt daraus
nirgends einen Markdown-Text mit Eigenschaften davor zusammen und liest
nirgends einen zurück: die Antwort liefert die beiden Hälften, die Validierung
liest sie, der Prüfschritt zeigt sie, und die Schreibschicht bekommt sie
unverändert. Änderungen des DM werden **je Hälfte** gespeichert
(`draftEdits: { "<adresse>": { properties?, body? } }`): die genannte Hälfte
ersetzt die des Entwurfs vollständig, die andere bleibt die des Modells. Auf
der Leitung heißt ein Entwurf `{ path, properties, body }`; ein Feld
`markdown` gibt es nicht mehr. Der bestehende Eintrag, den ein
Ergänzen-Lauf dem Modell zeigt, ist **Prompt-Formatierung** und wird dort
gebaut, wo der Prompt gebaut wird (`server/src/llm-provider.ts`) — kein
Speicherformat.

**Kontext:** Der Generator antwortet seit ADR #20 mit einem erzwungenen
JSON-Objekt (`properties`, `body`, `warnings`). Trotzdem rannte jeder Entwurf
danach durch einen Renderer und einen Parser: der Server baute aus dem Objekt
einen Markdown-Text, trug ihn als `markdown` durch Job, Prüfschritt und
Änderungen des DM, und beim Übernehmen wurde derselbe Text wieder in
Eigenschaften und Text zerlegt. Die Runde konnte nur verlieren — eine
Eigenschaft, die als YAML anders zurückkommt, als sie hineingegangen ist
(ein Datum, ein `+2`, ein Doppelpunkt in einem Satz), ein Block, der beim
Parsen degradiert und den ganzen Text zum Body macht. Und seit ADR #13 ist
die Zeile die Wahrheit: es gibt keinen Leser dieses Textes außer dem
Generator selbst.

**Folgen:**

- `shared/src/parse.ts` ist gelöscht, mit ihm die Abhängigkeiten
  `gray-matter` (shared) und `js-yaml` (server). Nichts im Repo parst
  Eigenschaften mehr aus Text.
- `ParsedFile` entfällt; `EntryResponse` steht für sich. Der Renderer des
  Stores rendert die Hälften einer Zeile, nicht mehr einen Eintrag als einen
  Text.
- Ein Job, dessen gespeicherte Entwürfe oder Änderungen in der alten Form
  liegen, wird beim Start als `failed` markiert (`code:
  "job_draft_format"`) — nicht konvertiert. Zurückparsen wäre genau die
  Runde, die diese Entscheidung abschafft, und ein Lauf kostet ein paar
  Token; ein halb konvertierter Entwurf kostet einen falschen Eintrag in der
  Kampagne.
- `POST …/generate/apply`, `POST …/generate/job/:id/accept` und `PATCH
  …/generate/job/:id/review` sprechen die Objektform. Das ist ein Bruch der
  Schnittstelle, und er ist keiner in der Praxis: ein Entwurf lebt nur
  zwischen einem Lauf und seinem Übernehmen.

## 25. Status und Typ sind Constraints der Datenbank

**Entscheidung:** Die vier geschlossenen Felder des Datenmodells —
`scenes.status`, `scenes.type`, `npcs.status`, `chapters.status` — sind
`CHECK`-Constraints ihrer Spalten. Die erlaubten Werte stehen **einmal**, in
`shared/src/types.ts` (`SCENE_STATUSES`, `SCENE_TYPES`, `NPC_STATUSES`,
`CHAPTER_STATUSES`); das Schema baut die Constraints aus genau diesen Listen,
wiederholt sie also nicht. Ein fremder Wert auf dem Schreibweg ist eine 400
mit `status_not_allowed` bzw. `scene_type_not_allowed`, nicht ein
`CHECK constraint failed` aus SQLite. Vor der Migration prüft ein
Vorlauf (`server/src/db/status-preflight.ts`) jede Zeile und **verweigert**
den Start mit Kampagne, Adresse und Wert, statt etwas stillschweigend zu
korrigieren.

**Kontext:** Bis hierher war jede dieser Listen eine Absprache: die Spalte war
offenes `text`, und wer sie einhielt, war die API — an den Stellen, an denen
jemand daran gedacht hatte. Beim Kapitel-Status war das so (400), bei Szene
und NPC nicht, also kam ein Tippfehler aus dem Generator oder aus einem
direkten Schreibzugriff einfach in der Spalte an und war danach ein Wert, den
die Leseansicht wörtlich anzeigt und den niemand mehr als Fehler erkennt.
Seit ADR #13 ist die Zeile die Wahrheit; dann gehört eine Regel über den
Inhalt einer Spalte auch in die Spalte. Das ist dieselbe Bewegung wie ADR #19:
Referenzen sind seit dort Fremdschlüssel und keine Absprache mehr.

Der Widerspruch zum „Format degradiert" aus README.md ist keiner. Degradieren
ist eine Regel für den **Leser**: ein unbekannter Callout und eine unbekannte
Überschrift werden angezeigt und werfen nie. Geschlossen ist der
**Schreibweg** — die Spalte kann keinen fremden Wert aufnehmen.

**Folgen:**

- Migration `0016_status_checks.sql` baut `chapters`, `npcs` und `scenes` neu.
  Sie ist handgeschrieben, wie `0014`: der Migrator läuft in einer
  Transaktion, in der `PRAGMA foreign_keys` ignoriert wird, also würde ein
  generierter Neubau `scene_npcs`/`scene_tags` über deren Kaskade löschen und
  am Ablegen der Elterntabelle scheitern. Die betroffenen Zeilen werden
  vorher beiseitegelegt und Eltern-vor-Kind zurückgeschrieben. `rev` bleibt
  unberührt: kein Wert ändert sich, also behält ein offener Editor sein
  Wächter-Token.
- Ein Bestand mit einem fremden Wert migriert **nicht**. Der Vorlauf nennt je
  Eintrag Kampagne, Adresse, Feld und Wert; korrigiert wird in der vorigen
  Version der App oder direkt in der Datenbank. Automatisch zu reparieren
  hieße zu entscheiden, welche der drei oder vier Positionen gemeint war —
  das kann nur der DM.
- Zwei neue Fehlercodes, `status_not_allowed` (`{ kind, value, allowed }`) und
  `scene_type_not_allowed` (`{ value, allowed }`). Die App braucht je einen
  Katalog-Eintrag; ohne ihn degradiert sie auf den englischen `error`-Satz.
- Neue Werte in einer der Listen sind ab jetzt eine Migration, keine Änderung
  an einer Konstante allein. Das ist gewollt: eine fünfte Position im Status
  ist eine Entscheidung über das Datenmodell.
- Dieselbe Bewegung gilt für die Zeitstempel: `sessions.started`/`ended` und
  die Pausen haben genau eine Form (`yyyy-mm-ddTHH:MM:SS`,
  `server/src/store/time.ts`), der Leser liest nur sie, und ein Vorlauf
  (`server/src/db/timestamp-preflight.ts`) verweigert den Start mit Kampagne,
  Session, Spalte und Wert, statt etwas stillschweigend zu korrigieren.
- Die minutengenauen Zeiten früherer Sessions (`yyyy-mm-ddThh:mm`) ergänzt
  Migration `0017_session_timestamps_seconds.sql` einmalig um `:00` — eine
  Migration und keine Reparatur, weil die Ergänzung verlustfrei und
  deterministisch ist: der Wert nennt die Minute, `:00` ist die einzige
  Sekunde, die diese Genauigkeit zulässt, und die Lesung ändert sich nicht.
  Deshalb läuft dieser Vorlauf — anders als die beiden über ihm — NACH dem
  Migrator; jede andere Form bleibt unangetastet und wird von ihm gemeldet.
