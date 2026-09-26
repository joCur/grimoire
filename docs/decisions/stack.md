# Tech-Stack

## Entscheidung

**Frontend:** Vite + React 19 + Tailwind v4 + shadcn/ui. Server-State hält
TanStack Query (Caching, Refetch nach Mutation, 409-Handling), lokaler
UI-State ist plain React — kein Zustand, kein Redux. Markdown rendert
react-markdown mit einem eigenen Remark-Plugin für `[!callout]`-Blöcke und
`## If:`-Überschriften. GFM nur für Tabellen: `micromark-extension-gfm-table`
und `mdast-util-gfm-table` statt `remark-gfm`. Kein Electron, kein Tauri —
eine Web-App hinter Tailscale reicht.

**Backend:** Bun + Hono, SQLite über Drizzle (`server/src/db/`), Suche als
FTS5-Index (`decisions/sqlite`).

**Icons:** Lucide für UI-Chrome (konsistent mit shadcn); game-icons.net
(CC BY) für thematische Marker (Entitäts- und Callout-Typen). Benötigte SVGs
werden als eigene Komponenten eingecheckt.

**Deployment:** ein Docker-Container (Bun-Image) mit einem Volume auf
`GRIMOIRE_DATA`, erreichbar nur über Tailscale. Details stehen in
[docs/DEPLOYMENT.md](../DEPLOYMENT.md).

### Monorepo mit Bun-Workspaces

Das Repo ist ein Bun-Workspace-Monorepo aus `shared/` (Entitäts-Typen,
`@grimoire/shared`), `server/` und `app/`. Server und Frontend importieren
dieselben Typen; das Datenformat ist damit genau einmal in Code beschrieben
(`decisions/resources`). `shared/` wird ohne Build-Schritt als
TypeScript-Quelle konsumiert — Bun und Vite können das nativ, unter Node
läuft es über tsx. Test-Runner ist `bun test`.

### Node-Portabilität: Bun-only-APIs nur mit Eintrag hier

Hono läuft unverändert auf Bun und Node. Ein Wechsel der Runtime ist eine
Änderung am Deployment, kein Code-Umbau, solange keine Bun-only-API im
Laufzeit-Code steht. Deshalb gilt: **Eine Bun-only-API braucht einen Eintrag
in dieser Datei.** Die Regel betrifft Laufzeit-APIs; `bun test` als
Dev-Werkzeug fällt nicht darunter.

Eingetragen ist genau eine:

- **`bun:sqlite` als Fallback hinter `server/src/db/driver.ts`.** Der Treiber
  nimmt `node:sqlite`, wo die Runtime es anbietet, und sonst `bun:sqlite`.
  Bun implementiert `node:sqlite` nicht (geprüft mit Bun 1.3.14, der in CI
  gepinnten Version), und drizzle-orm 0.45.2 hat keinen `node-sqlite`-Treiber.
  Auf Node (≥ 22.16, wegen `setReturnArrays`) läuft der Server damit ohne
  native Abhängigkeit; auf Bun, der Runtime des Images, läuft `bun:sqlite`.
  Beide hängen hinter einer Schnittstelle mit identischer Parameter- und
  Zeilenbehandlung. `server/test/db-smoke.test.ts` beweist FTS5,
  Transaktionen und UPSERT auf beiden Laufzeiten; der CI-Job `db-smoke-node`
  fährt dieselbe Datei auf Node. Driftet ein Treiber, ist das das
  Frühwarnsignal. Fielen beide aus, wäre `better-sqlite3` hinter derselben
  Schnittstelle der Ersatz; implementiert ist er nicht.

## Warum

- Hono statt Express oder Fastify: minimal, typsicher, und es läuft auf Bun
  und Node.
- `remark-gfm` ließe sich nicht auf Tabellen beschränken: Aufgabenlisten
  machten ein `- [ ]` im Text des DM zu einem Bedienelement, das nichts
  schreibt.
- Ein `shared/`-Paket ohne Build-Schritt hält Server und App auf demselben
  Typ, ohne dass eine generierte Kopie veralten kann.

## Folgen

Bun/Hono ist keine „nur für klein"-Entscheidung; die Grenzen sind benannt:

- **App-Level-Auth:** erst Forward Auth im Proxy, sonst Hono-Middleware
  (`decisions/scope`).
- **Mehr Daten, komplexere Queries:** SQLite ist die Quelle der Wahrheit
  (`decisions/sqlite`).
- **Bun-spezifisches Risiko:** begrenzt auf die eine eingetragene Kopplung
  oben.
- **Mehrnutzer- und Rechte-Anforderungen:** dann ist nicht die Runtime das
  Problem, sondern Datenmodell und Auth-Modell (`decisions/scope`).

Für neue Abhängigkeiten gilt `decisions/dependencies`; eintragspflichtig
bleiben allein Bun-only-APIs.
