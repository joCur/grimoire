# Grimoire — Entscheidungen (leichtgewichtige ADRs)

Festgehaltene Architektur-Entscheidungen mit Begründung. Neue Entscheidungen
unten anfügen, alte nicht löschen — bei Änderung Status auf `ersetzt durch #N`.

## 1. Source of Truth: Markdown + Frontmatter auf dem Dateisystem

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

## 5. Tech-Stack

**Frontend:** Vite + React 19 + Tailwind v4 + shadcn/ui.
Server-State: TanStack Query (Caching, Refetch nach Mutation,
409-Handling). Lokaler UI-State: plain React — kein Zustand/Redux.
Markdown-Rendering: react-markdown + eigenes Remark-Plugin für
`[!callout]`-Blöcke und `## If:`-Überschriften.
Kein Electron/Tauri — Web-App hinter Tailscale reicht.

**Backend:** Bun + Hono. Bibliotheken: gray-matter (Frontmatter),
chokidar (Datei-Watcher für externe Edits), Fuse.js (Suche im Speicher —
kein SQLite nötig bei ein paar hundert Dateien).
Hono statt Express/Fastify: minimal, typsicher, läuft auf Bun UND Node
(Runtime-Wechsel bleibt möglich, siehe #7).

**Icons:** Lucide für UI-Chrome (konsistent mit shadcn);
game-icons.net (CC BY) für thematische Marker (Entitäts- und
Callout-Typen). Benötigte SVGs als eigene Komponenten einchecken.

**Deployment:** ein Docker-Container (Bun-Image), Volume auf
`campaigns/`, erreichbar nur über Tailscale.

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
- **Mehr Daten / komplexere Queries?** Fuse.js → SQLite (bun:sqlite ist
  eingebaut). Das Dateisystem bleibt Source of Truth, SQLite wäre nur
  Index/Cache.
- **Bun-spezifisches Risiko?** Hono läuft unverändert auf Node; einzige
  Bun-Kopplung wäre bun:sqlite (dann better-sqlite3 als Node-Ersatz).
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

Externe Edits (Editor, git pull, Generator) sollen in der App sichtbar
werden, ohne manuell neu zu laden. Mechanismus: chokidar beobachtet
CAMPAIGN_ROOT und invalidiert pro Kampagne den In-Memory-Suchindex und
einen Versionszähler; die App pollt `GET /api/:campaign/version` und
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

## 11. App-first: Bearbeitung in der App ist das Ziel, der Editor Ausweichlösung

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
  Normale main-Merges bauen in `ci.yml` weiterhin ein Image, aber nur unter
  dem Commit-SHA. `:latest` heißt damit „letzter Release", nicht „letzter
  Merge". Das Compose-File referenziert
  `${GRIMOIRE_VERSION:-latest}`; empfohlen ist eine festgenagelte Version.
- Die Build-Id für den Reload-Banner (#24, `GRIMOIRE_BUILD`) bleibt
  erhalten: Release-Images brennen den Tag ein, CI-Images den SHA — in beiden
  Fällen derselbe Wert in Bundle und Server, sonst zeigte jeder Deploy sein
  eigenes Banner.

Bewusst nicht dabei: Multi-Arch (amd64 genügt), Auto-Deploy (der PO pullt
weiterhin selbst) und rückwirkende Changelog-Generierung für die Commits vor
diesem Eintrag.
