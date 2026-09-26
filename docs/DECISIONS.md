# Grimoire — Entscheidungen (leichtgewichtige ADRs)

Festgehaltene Architektur-Entscheidungen mit Begründung. Ein ADR hält nur
Zielentscheidungen fest: keine befristeten ADRs, keine Zwischenstände. Eine
Änderung schreibt das gültige ADR um oder fügt unten ein neues an. Ersetzt ein
neues ADR ein altes vollständig, schrumpft das alte auf seine Überschrift und
„Ersetzt durch ADR #N.“ Nummern werden nie neu vergeben oder umnummeriert.

## 1. Source of Truth: Markdown + Frontmatter auf dem Dateisystem

Ersetzt durch ADR #13.

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

- App-first: Bearbeitet wird in der App. Zielbild des PO sind alle
  Pflege-Operationen aus der App heraus, und die Priorisierung richtet sich
  danach. Die Datenbank ist die Wahrheit (ADR #13); einen Datenpfad an der App
  vorbei, etwa einen externen Editor, gibt es nicht.
- Session-Log und Ideen sind append-only: eine Log-Zeile und eine Idee werden
  einmal geschrieben. Die einzigen Änderungen danach sind das Sichten einer
  Log-Zeile (`reviewed`) und das Abhaken einer Idee (`done`).
- Konfliktschutz: Ein Schreibzugriff gilt nur bei unveränderter Zeilenversion
  `rev`, sonst 409.

## 5. Tech-Stack

**Frontend:** Vite + React 19 + Tailwind v4 + shadcn/ui.
Server-State: TanStack Query (Caching, Refetch nach Mutation,
409-Handling). Lokaler UI-State: plain React — kein Zustand/Redux.
Markdown-Rendering: react-markdown + eigenes Remark-Plugin für
`[!callout]`-Blöcke und `## If:`-Überschriften.
GFM nur für Tabellen: `micromark-extension-gfm-table` +
`mdast-util-gfm-table` statt `remark-gfm` — die Sammel-Plugin-Variante
ließe sich nicht auf Tabellen beschränken (Aufgabenlisten würden ein `- [ ]`
im Text des DM zu einem Bedienelement machen, das nichts schreibt).
Kein Electron/Tauri — Web-App hinter Tailscale reicht.

**Backend:** Bun + Hono, Drizzle über SQLite (`server/src/db/`), Suche als
FTS5-Index. `jsonrepair` (exakt gepinnt) im Generator: **jede**
Modell-Antwort ist ein per Schema erzwungenes JSON-Objekt — die Gliederung ihr
eigenes (`shared/schema/outline.schema.json`), ein Aufruf für eine Entität
das Schema, das aus ihrem zod-Schema abgeleitet ist; die Form dieser Antwort
regelt ADR #31. Ein Endpoint, der `response_format`
annimmt und ignoriert, liefert trotzdem Handgeschriebenes, und dort sind die
Fehler mechanisch (Komma am Ende, einfache Anführungszeichen): eine
deterministische Reparatur vor der Validierung ist deutlich billiger als eine
Korrekturrunde, die den ganzen Prompt erneut sendet. Die Regeln selbst bleiben
unangetastet, und ein reparierter Lauf trägt eine Warnung.
Hono statt Express/Fastify: minimal, typsicher, läuft auf Bun UND Node
(Runtime-Wechsel bleibt möglich, siehe ADR #7).

**Abhängigkeiten:** Für allgemeine Aufgaben wird ein etabliertes Paket
eingebunden (ADR #30); eintragspflichtig bleiben allein Bun-only-APIs
(ADR #7).

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
- **Mehr Daten / komplexere Queries?** Entschieden in ADR #13: SQLite ist
  die Quelle der Wahrheit.
- **Bun-spezifisches Risiko?** Hono läuft unverändert auf Node; die einzige
  registrierte Bun-Kopplung ist `bun:sqlite` als Fallback hinter
  `server/src/db/driver.ts` — primär läuft `node:sqlite`; `better-sqlite3`
  wäre der Ersatz, wenn beide ausfallen, ist aber nicht implementiert (ADR #13).
  Runtime-Wechsel = Deployment-Änderung, kein Code-Umbau, solange keine
  weiteren Bun-only-APIs benutzt werden. Diese Regel gilt: **Bun-only-APIs
  nur mit Eintrag hier.**
- **Echte Mehrnutzer-/Rechte-Anforderungen?** Dann ist nicht die Runtime
  das Problem, sondern Datenmodell (ADR #13) und Auth-Modell (ADR #3) — an dem
  Punkt bewusst neu entscheiden statt anbauen.

## 8. Monorepo mit Bun-Workspaces und shared/-Paket

Repo als Bun-Workspace-Monorepo: `shared/` (Entitäts-Typen), `server/`,
`app/`. Das Datenformat aus README.md ist
damit genau einmal in Code beschrieben; Server und Frontend importieren
dieselben Typen (`@grimoire/shared`). shared/ wird ohne Build-Schritt als
TypeScript-Quelle konsumiert (Bun und Vite können das nativ; Node-Fallback
über tsx, siehe ADR #7). Test-Runner ist `bun test` — Dev-Werkzeug, kein
Runtime-Code; die Bun-only-Regel aus ADR #5 betrifft weiterhin nur
Laufzeit-APIs.

## 9. Client-Aktualisierung: Polling statt SSE

Änderungen sollen in der App sichtbar werden, ohne manuell neu zu laden.
Jeder Write zählt `campaigns.version` in DERSELBEN Transaktion hoch — ein Poll
kann keine erhöhte Version ohne die zugehörige Änderung sehen. Die App pollt
`GET /api/campaigns/:campaign/version` und invalidiert ihre Queries, wenn sich
der Wert ändert. Das Poll-Intervall
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
möglich sein.

**Jobs sind Zeilen** in `generate_jobs` (ADR #13): mit der Datenbank als
Wahrheit ist sie der naheliegende Ort dafür, und auch ein Deploy in der Minute
zwischen „fertig" und „Übernehmen" darf kein fertiges Ergebnis wegwerfen. Ein
**fertiger** Job (`done`/`failed`) übersteht einen Neustart vollständig —
Ergebnis, Fehlerbody und die Review-Edits — und bleibt übernehmbar. Ein
**laufender** Job kann es nicht, weil sein Provider-Call mit dem Prozess
stirbt: der Boot schreibt jede übrig gebliebene `running`-Zeile auf `failed`
mit der Meldung „Server wurde während des Laufs neu gestartet — Job neu
starten" (`server/src/db/job-boot.ts`), statt die App ins endlose Pollen zu
schicken.

**Pipeline:** Ein Szenen-Lauf ist kein einzelner Provider-Call, sondern eine
**Pipeline** — und damit besteht ein Job aus **Teilen**. Ein
Gliederungs-Aufruf legt fest, welche Szenen es gibt (rein systeminterner
Schritt zur Fehlerreduktion, dem Nutzer wird die Gliederung nie zum Bearbeiten
angeboten — PO, 15.09.); danach ist jede Szene und jeder neue Eintrag ein
eigener Aufruf, drei gleichzeitig.

Konsequenzen für das Job-Modell:

- Die Zeile trägt die Gliederung, die Teile mit Status je Teil
  (`pending | running | done | failed`), Fehlertext und Token-Verbrauch je
  Teil sowie Token- und Aufruf-Summe des Laufs (`pipeline`-Spalte). Der Quelltext des Laufs steht mit in der Zeile, weil
  ein Teil-Neustart denselben Ausschnitt erneut schicken muss.
- Ein **fertiger Teil ist sofort prüfbar und übernehmbar**, während andere noch
  laufen: der Job bleibt `running`, das Ergebnis füllt sich, und die Prüfseite
  zeigt Teile in Gliederungsreihenfolge. Der Job wird `done`, sobald ein Teil
  etwas produziert hat, und `failed` nur, wenn kein einziger Teil durchkam.
  „Übernehmen" verlangt deshalb **kein fertiges Job**, sondern ein Ergebnis:
  409 bleibt für einen gescheiterten Lauf und für einen, der noch keinen Teil
  fertig hat (das ist auch, was einen laufenden Ein-Aufruf-Lauf
  unübernehmbar macht — er hat gar keine Teile).
- **Neustart:** laufende (und noch wartende) Teile werden `failed` mit der
  Neustart-Meldung, **fertige bleiben stehen** und übernehmbar. Ein Job ohne
  Teile — der Ergänzen- und der NPC-Lauf sind Ein-Aufruf-Läufe — verhält sich
  wie oben beschrieben.
- **„Erneut versuchen" je Teil:** `PATCH …/generator-jobs/:id/parts/:key
  { status: "running" }` startet genau diesen Teil neu, aus der gespeicherten Gliederung — in **einer
  Transaktion** über der neu gelesenen Zeile, die nur diesen Teil anfasst:
  während der Kontext-Lesung kann ein Geschwister-Teil fertig werden, und ein
  Rückschreiben der ganzen `pipeline`-Spalte überschriebe dessen Ergebnis.
  Ein noch `pending` Teil wird abgelehnt (409) — er gehört dem Pool des Laufs
  und würde sonst zweimal laufen. Abbruch
  („Verwerfen") stoppt die offenen Teile; was schon übernommen wurde, ist eine
  Zeile der Kampagne und kein Teil des Jobs.
- Ein Lauf pro Kampagne; der Prüfzustand liegt am Job (ADR #16).

## 11. App-first: Bearbeitung in der App ist das Ziel, der Editor Ausweichlösung

Ersetzt durch ADR #13.

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

### CI baut zur Prüfung, publiziert nie

`ci.yml` pusht kein Image — **der Release-Workflow ist der einzige Schreiber
der GHCR-Registry.**

- Ein SHA-Push bei jedem Merge hielte das Paket dauerhaft „gerade
  aktualisiert" und verwässerte damit genau die Release-Semantik, für die
  dieser Eintrag existiert: Publikation ist ein bewusstes, mit Changelog
  belegtes Ereignis.
- Rollback läuft über die **Versions-Tags** — zu ihnen gehört ein Changelog,
  zu einem SHA nicht.
- Das CI-Gate: `require-green-ci` verlangt den
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

**Entscheidung:** Eine SQLite-Datenbank ist die **alleinige** Quelle der
Wahrheit für Kampagneninhalte. Kein Spiegel auf das Dateisystem, kein
Auto-Export, kein Zwei-Wege-Abgleich — die Klasse von Konfliktproblemen, die
ein Spiegel erzeugt, wird nicht gebaut. Das ist die Folge des App-first-Ziels
(ADR #4): gepflegt wird in der App, also gehört die Wahrheit hinter ihre API.

- **Markdown ist das Inhaltsformat der `body`-Spalten** — und sonst nichts in
  der Speicherung. Das Body-Vokabular aus README.md (Callouts, `## If:`,
  Hashtags) ist normativ, und das Format degradiert statt zu validieren:
  unbekannte Callouts und Überschriften sind normaler Text.
- **Ein Body = ein Markdown-Feld,** in der UI als Markdown editierbar
  (PO-Entscheidung). „Blöcke als Zeilen" ist eine bewusst offen gelassene
  Später-Option; das Schema verbaut sie nicht.
- **Das Glossar ist eine strukturierte Tabelle** (Begriff → Erklärung), kein
  Markdown-Blob.
- **Der Server liest keine Kampagnendateien.** Eine frische Instanz startet
  **leer** — der Boot öffnet die Datenbank und wendet die Schema-Migrationen
  an, sonst nichts. Der Kaltstart einer echten Kampagne läuft in der UI. Zeilen
  in eine leere Datenbank schreibt außerhalb der App allein das
  **Dev-/E2E-Werkzeug `grimoire seed <dir>`** (Report auf stdout), das die
  JSON-Fixtures über die Store-Schicht lädt (ADR #20).
- **Sicherung der DB-Datei ist Sache des Stack-Owners** (Volume-Backup,
  Hinweis in DEPLOYMENT.md); ein eigenes Backup-System ist bewusst kein
  Feature.
- **ORM: Drizzle** (`drizzle-orm`, `drizzle-kit` als Dev-Dependency).
  `server/src/db/schema.ts` ist die eine Typquelle; Migrationen sind
  generierte, **committete** SQL-Dateien und werden beim Boot in einer
  Transaktion angewandt. Downgrade wird nicht unterstützt; Rückweg ist
  Volume-Sicherung plus Image-Rollback auf einen älteren Versions-Tag (ADR #12).
  Die Kette beginnt mit einer Baseline, dem Schema von v0.7 (ADR #28).
- **FTS5** für die Suche, als handgeschriebene Custom-Migration (Tokenizer
  `unicode61 remove_diacritics 2`, Ranking `bm25(search_fts, 10, 6, 4, 1)`),
  explizit aus der Store-Schicht gepflegt.
- **`rev` ist der 409-Guard:** die Zeilenversion, die jeder Schreibzugriff
  mitschickt (ADR #4).
- **PRAGMAs:** `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- **`GRIMOIRE_DATA`** (Default `./data`) hält `grimoire.db` samt
  `-wal`/`-shm` — die einzige Dateneinstellung überhaupt.

**Treiber — hier als Bun-Kopplung registriert (Pflicht aus ADR #7):**
**Bun implementiert `node:sqlite` nicht** (geprüft mit 1.3.14, der in CI
gepinnten Version — Bun verweist auf `bun:sqlite`), und **drizzle-orm 0.45.2
hat keinen `node-sqlite`-Treiber**. Konsequenz, gekapselt in
`server/src/db/driver.ts`:

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

**Generator-Jobs** sind Zeilen dieser Datenbank (`generate_jobs`); was ein
Neustart mit ihnen macht, steht unter ADR #10.

**Bewusst nicht Teil der Entscheidung:** Export/Import, Trigram-Tokenizer für
tippfehlertolerante Suche, Auto-Backups, Mehrnutzer-Betrieb (dafür gelten
weiter ADR #3 und die Neubewertung aus ADR #7).

## 14. Referenzieren legt an — ein referenzierter Eintrag fehlt nie

Ersetzt durch ADR #19.

## 15. i18n: typisierter TS-Katalog + ICU über `intl-messageformat`

Gilt für alles Nutzersichtbare in `app/` **und** für jeden Fehler-Body des
Servers, den ein Mensch liest.

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
  überall** in `app/src`. Die `allowedStrings`-Liste ist die einzige Ausnahme und trägt
  ausschließlich Nicht-Copy: Trennzeichen, Tastennamen (`⌘K`, `esc`) und im
  Block-Composer angezeigte Markdown-Marker (`[!`, `]`).
  **ESLint bleibt auf `^9`:** `eslint-plugin-react@7.37.5` deklariert als Peer
  `… || ^9.7` und kennt ESLint 10 nicht; da dieses Gate genau aus einer Regel
  dieses Plugins besteht, ist die Major-Version des Linters die kleinere
  Abhängigkeit. Anheben, sobald das Plugin ESLint 10 als Peer führt.
- Enum-Labels, die sich viele Views teilen (Szenen-/NPC-Status in
  `scene/scene-status.ts`, `npc/npc-status.ts`), kommen ebenfalls aus dem Katalog;
  die Helfer nehmen dafür `t: Translate` als Argument (`sceneStatusMeta`,
  `sceneStatusOptions`, `npcStatusLabel`, `browseListTitle`). Ein **unbekannter**
  Wert wird verbatim angezeigt — die Zeile bleibt die Wahrheit.

## 16. Der Prüfzustand einer Generierung gehört auf den Job

Betrifft den Generator-Prüfschritt (Szenen, NPC) und den „Mit KI
ergänzen"-Lauf.

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
  Ausnahme: der zweite `PATCH …/generator-jobs/:id` bekommt
  `409 rev_conflict`, und die App lädt neu, statt die Entscheidung des
  anderen still zu überschreiben. Es ist
  dasselbe Protokoll wie bei jedem anderen Schreibzugriff (ADR #4) — kein
  zweites Konfliktmodell.
- Ein Lauf ist damit **teilweise übernehmbar**: das Übernehmen (ADR #31)
  schreibt genau die gewählten Teile in einer Transaktion (Konfliktprüfung
  drin, FTS und Referenzen folgen) und vermerkt sie im selben Commit auf dem
  Job. Ist nichts mehr offen, ist der Job erledigt.
- **„Verwerfen" nimmt nur den offenen Rest mit** (Lead-Entscheid).
  Was einzeln übernommen wurde, ist eine Zeile der Kampagne und kein Teil des
  Jobs — es im Prüfschritt weiter zu bearbeiten ist ausdrücklich kein Ziel,
  dafür gibt es den normalen Editor.
- Kein Undo-Verlauf und kein Merge zwischen zwei Bearbeitern. Grimoire ist
  einbenutzerig; „zwei Tabs" ist ein Konflikt, den man meldet, keiner, den man
  zusammenführt.

## 17. Die Gruppe einer Szene IST ihr `location` — kein eigenes Feld

**Entscheidung:** Der Ort einer Szene steht in genau einer Spalte,
`location`; eine Gruppe daneben gibt es nicht. `location` ist eine Orts-id
oder leer — Freitext wird mit `400 location_not_an_id` abgelehnt, eine id ohne
Ort mit `400 location_unknown` (ADR #19). Aus `location` wird nichts
abgeleitet: die URL einer Szene regelt ADR #31, und die Kapitelübersicht
gruppiert nicht nach Ort, sondern zeigt die Reihenfolge des DM mit dem Ort in
der Metazeile (ADR #27).

**Warum:** Eine Gruppe neben `location` wäre ein zweiter Wert für dieselbe
Sache. Korrigiert der DM im Prüfschritt oder in den Eigenschaften den Ort,
bliebe die Gruppe stehen, und die Anzeige widerspräche dem Feld, das der DM
gerade gesetzt hat. Zwei Quellen für eine Wahrheit driften immer; die
Reparatur ist, eine davon abzuschaffen, nicht sie zu synchronisieren.

**Abgeleitete Spalte vs. keine Spalte:** Eine abgeleitete Spalte hätte jeden
Schreibpfad (Patch, Generator-Übernahme, Ergänzen) verpflichtet, sie
mitzuziehen — also genau die Drift-Möglichkeit konserviert, die diese
Entscheidung beseitigt.

**Die Fixtures nennen den Ort selbst:** jede Beispielszene trägt ihr
`location`, und der Seed schreibt es unverändert.

## 18. Das Kapitel entsteht aus dem Lauf, sein Status ist ein Enum

**Entscheidung (a): Das Kapitel eines „Neues Kapitel"-Laufs entsteht aus dem
Zustand des Laufs, nicht aus dem des Browsers.** Der Titel wird beim **Start**
am Job vermerkt (`generate_jobs.new_chapter_title`), und die Übernahme legt
das Kapitel daraus an — idempotent und im selben Vorgang wie die Szenen. Der
Prüfschritt ist persistent (ADR #16), die Übernahme passiert also regelmäßig
nach Navigation oder Reload; Titel und id dürfen dann nicht im Browser liegen.

Die Übernahme legt das Kapitel auch dann an, wenn kein übernommener Teil es
nennt: das Kapitel gehört dem Lauf, nicht dem einzelnen Teil. Eine generierte
Szene bekommt ihr Kapitel im selben Schreibvorgang; ist die Kapitel-id kein
Slug, ist das 400. **Die Dialoge bleiben davon unberührt:** ein Kapitel, das
der DM tippt, muss existieren (400, ADR #19) — dort ist ein unbekanntes
Kapitel ein Tippfehler.

**Entscheidung (b): Der Kapitel-Status ist ein Enum** `planned | active | done`,
genau einmal in `shared/` definiert (`CHAPTER_STATUSES`), Labels de „Geplant /
Aktiv / Abgeschlossen", en „Planned / Active / Done". Die API schreibt nur
diese drei Werte und antwortet sonst **400**; die Spalte ist ein
CHECK-Constraint (ADR #25). Ein neu angelegtes Kapitel startet auf `planned`.

`active` ist **eine Entscheidung über zwei Kapitel**, und „genau ein aktives
Kapitel" gehört dem **Feld, nicht einem Endpoint**: jeder Schreibweg, der
`active` setzt, stellt das bisher aktive Kapitel im selben Vorgang auf
`planned` zurück. Sonst wäre der Eigenschaften-Dialog eine zweite Tür daran
vorbei. Die Schreibwege selbst — `PATCH …/chapters/:id { rev, status:
"active" }` mit Wächter wie jeder Schreibzugriff und `POST …/chapters` mit
`status: "active"` — regelt ADR #31.

In der Kapitelübersicht ist die Status-Anzeige deshalb **das Bedienelement**
(wie beim Szenen-Status, gemeinsames Markup in `components/StatusMenu`): jede
Auswahl patcht das Kapitel. Die Auswahl des Werts, der schon angezeigt wird,
schreibt nichts. Mobil bleibt der Status **Anzeige**: unter `md` rendert die
Route die Startfläche statt der Kapitelübersicht, die Regel steht also genau
an einer Stelle.

## 19. Jede Referenz ist ein Fremdschlüssel — eine Nennung legt nichts an

**Entscheidung:** Jede gespeicherte Referenz bekommt einen zusammengesetzten
Fremdschlüssel `(campaign_id, <referenz>)` mit `ON UPDATE CASCADE` und
`ON DELETE NO ACTION`. Eine Referenz nennt damit einen
Eintrag, den es gibt — und die Datenbank ist es, die das garantiert.

| Referenz | Ziel | Pflicht |
| -------- | ---- | ------- |
| `scenes.chapter_id` | `chapters` | ja — eine Szene gehört zu einem Kapitel |
| `scenes.location` | `locations` | nein |
| `scene_npcs.npc_id` | `npcs` | ja |
| `npcs.chapter_id` | `chapters` | nein |
| `locations.chapter_id` | `chapters` | nein |
| `log_entries.scene_id` | `scenes` | nein |
| `played_scenes.scene_id` | `scenes` | ja |

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

**Ein leerer Eintrag ist kein Fehler:** er zeigt eine dünne Karte, ist normal
befüllbar und bekommt keinen „fehlt"-Platzhalter.

Wer in `npcs`, `location` oder `chapter`, in einer Schnellnotiz oder in einer
gespielten Szene etwas nennt, das keinen Eintrag hat, bekommt 400 mit
einem eigenen Code (`npc_unknown`, `location_unknown`,
`chapter_unknown`, `log_scene_unknown`, `played_scene_unknown`) und dem
Hinweis, den Eintrag zuerst anzulegen; geschrieben wird nichts.

**Eine Nennung im Text ist keine Referenz.** `[[id]]` und die Zeilen unter
`## Beziehungen` bleiben sichtbarer Text: es gibt keine Tabelle für
Beziehungen, weil nichts in der Speicherung aus Text abgeleitet wird — eine Beziehung als
Daten wären Eigenschaften im Dialog und im Generator, kein geparster
Abschnitt. Ein `[[id]]` ohne Eintrag wird als Text angezeigt, ohne Fehler.

**Bewusst nicht Teil der Entscheidung:** ein Löschweg für Einträge (es gibt
keinen; `ON DELETE NO ACTION` sagt nur, dass ein solcher Weg eine eigene
Entscheidung braucht) und ein Umgang mit Referenzen zwischen Kampagnen (die
Fremdschlüssel schließen sie aus, weil `campaign_id` Teil jeder Referenz
ist).

## 20. Fixtures sind JSON-Einträge, es gibt keinen Import

**Entscheidung:** Es gibt genau ein Fixture-Format, und es ist die Form der
API: die Beispielkampagne liegt unter `fixtures/` als die Objekte, die ihre
Ressourcen liefern — auch Sessions, Ideen und Glossar-Begriffe strukturiert,
nicht als Text. Ablage und Form je Entität regelt ADR #31. `grimoire seed
<dir>` liest sie und schreibt sie über die Store-Schicht. Einen Importer gibt
es nicht.

**Warum:** Kein Produktivpfad importiert, und wer die App frisch installiert,
fängt nicht mit einem Verzeichnisbaum an, sondern legt seine Kampagne in der
UI an. Ein Seed, der durch einen Parser läuft, prüfte den Parser statt den
Speicher — und Fixtures in der Form der API sind gleichzeitig die Referenz
dafür, was die API antwortet.

## 21. ids sind unveränderlich

**Entscheidung:** Die `id` eines Eintrags wird beim Anlegen gesetzt und ändert
sich danach nie. Der Eigenschaften-Dialog zeigt sie als Kontext, bietet aber
keine Änderung; kein Schreibzugriff ändert sie (ADR #31).

**Warum:** Die id ist der Referenz-Schlüssel des ganzen Modells — sie steht in
jeder URL, in jedem Fremdschlüssel und in jeder `[[id]]`-Referenz im Text.
Ein Apparat, der sie nachträglich überall mitzieht, ist der teuerste Teil der
Schreibschicht und wird praktisch nie gebraucht: Die Personalisierung der id
passiert einmal, im Anlege-Dialog. Ein Eintrag, der einen besseren **Titel**
bekommt, braucht keine neue id — `[[id]]`-Referenzen lösen immer auf den
aktuellen Anzeigenamen auf, also stimmt der Text ohnehin überall.

**Folgen:**

- Es gibt keinen Endpoint, der eine id ändert, keine Referenz-Kaskade und
  keinen Verwendungs-Bericht.
- Die `ON UPDATE CASCADE`-Fremdschlüssel bleiben im Schema: sie halten Kind-
  Zeilen ehrlich und kosten nichts.
- Anzeigenamen bleiben frei änderbar; der Suchindex zieht die referierenden
  Einträge dabei nach (`server/src/store/refs.ts`).

## 22. Ein URL-Schema: alles Kampagnenabhängige unter `/campaigns/:id`

**Entscheidung:** Jeder kampagnenabhängige Pfad hängt unter der Kampagne — in
der API `/api/campaigns/:id/…`, in der App `/campaigns/:id/…`. Die Mehrzahl
`campaigns` ist gesetzt, auch für die einzelne Kampagne
(`GET /api/campaigns/:id`). Welche Ressourcen und App-Routen darunter liegen,
regelt ADR #31. Kampagnenlos bleiben `/api/campaigns`, `/api/settings` und
`/settings`. Es gibt kein Alt-Schema und keine Umleitungsschicht: eine URL,
die nichts benennt, antwortet 404, ohne Umleitung und ohne Alias.

**Warum:** Stünde die Kampagnen-id als erstes Segment, kollidierte sie mit
jedem kampagnenlosen Pfad — `/:campaign` träfe auch `/settings`. Das erzwänge
Sonderfälle an mehreren Stellen der App (eine Liste der
Nicht-Kampagnen-Segmente, eine Umleitung im Kampagnen-Scope, eine eigene
Herleitung im Topbar), die mit jedem neuen kampagnenlosen Pfad mitwüchsen. Mit
dem Präfix ist die Kollision ausgeschlossen statt abgefangen, und
Erweiterungen haben ein Muster.

## 23. Ein Schreibweg je Eintrag

**Warum:** Alle Felder einer Entität, `body` eingeschlossen, liegen in einer
Zeile und teilen einen Wächter `rev`. Zwei Schreibwege auf dieselbe Zeile
machten die erste Antwort durch den zweiten Aufruf selbst ungültig, und die App
müsste den nächsten `rev` erraten, statt ihn zu kennen.

**Entscheidung:** Jede Entität hat genau einen Schreibweg, `PATCH` auf ihrer
eigenen Ressource; Endpunkt und Form (`{ rev, force?, …Teilmenge ihrer
Felder }`) regelt ADR #31.

- Mindestens ein Feld muss dabei sein, sonst 400 `nothing_to_write`. Alle
  Felder zusammen sind **ein** Schreibvorgang in einer Transaktion, gegen
  **einen** `rev`: eine Zeilen-Änderung, ein Schritt von `rev`, ein
  Versions-Zähler, ein Index-Lauf. Wie viel eine Anfrage trägt, ist an `rev`
  nicht ablesbar.
- Ein veralteter `rev` ist 409 `rev_conflict` und trägt neben dem aktuellen
  `rev` den **aktuellen Stand** — der Konfliktdialog zeigt, was im Weg
  steht, ohne nachzuladen. Dieselbe 409-Form gilt für jeden Schreibzugriff
  mit Wächter.
- `force: true` schreibt auf die Zeile, wie sie jetzt ist, und schreibt nur
  die mitgeschickten Felder: ein fremd geänderter Status übersteht also ein
  erzwungenes Text-Speichern.
- Die App hält den `rev` der laufenden Bearbeitung und schickt ihn mit,
  statt ihn einzufrieren und zu raten.

**Folgen:**

- Das Übernehmen eines Generator-Vorschlags ist kein Weg an diesen Regeln
  vorbei: es prüft dieselben Felder und Referenzen wie das Anlegen seiner
  Entität.
- Jeder Anlege-Endpoint antwortet mit dem Typ seiner Entität, auch
  `POST /api/campaigns` (`Campaign`).

## 24. Der Generator kennt kein Markdown-Zwischenformat

**Entscheidung:** Ein Vorschlag des Generators ist von der Antwort des Modells
bis in die Zeile der Typ seiner Entität ohne `rev` (ADR #31). Der Server setzt
nirgends einen Text mit vorangestellten Feldern zusammen und liest nirgends
einen zurück: die Antwort liefert die Felder, die Validierung liest sie, der
Prüfschritt zeigt sie, und die Schreibschicht bekommt sie unverändert.
Änderungen des DM werden **je Entität und id** gespeichert (`sceneEdits`,
`npcEdits`): eine Änderung nennt die Felder, die sie setzt, `null` löscht ein
optionales, und jedes andere Feld behält den Wert des Modells. Der bestehende
Stand, den ein Ergänzen-Lauf dem Modell zeigt, ist **Prompt-Formatierung** und
wird dort gebaut, wo der Prompt gebaut wird (`server/src/llm-provider.ts`) —
kein Speicherformat.

**Warum:** Ein Text mit vorangestellten Feldern, der durch Job, Prüfschritt
und Änderungen des DM getragen und beim Übernehmen wieder in Felder und Text
zerlegt wird, kann nur verlieren — ein Feld, das als YAML anders zurückkommt,
als es hineingegangen ist (ein Datum, ein `+2`, ein Doppelpunkt in einem
Satz), ein Block, der beim Parsen degradiert und den ganzen Text zum Body
macht. Die Zeile ist die Wahrheit (ADR #13); einen Leser eines solchen Textes
gäbe es außer dem Generator selbst nicht.

**Folgen:**

- Nichts im Repo parst Felder aus Text; es gibt keinen Frontmatter-Parser und
  keine YAML-Abhängigkeit.
- Prüfen und Übernehmen eines Jobs (`PATCH …/generator-jobs/:id`, ADR #31)
  sprechen die Objektform.
- Der Code `job_draft_format` wird nicht gesendet; er bleibt in der
  append-only-Liste der Fehlercodes (ADR #15).

## 25. Status und Typ sind Constraints der Datenbank

**Entscheidung:** Die vier geschlossenen Felder des Datenmodells —
`scenes.status`, `scenes.type`, `npcs.status`, `chapters.status` — sind
`CHECK`-Constraints ihrer Spalten. Die erlaubten Werte stehen **einmal**, in
den Modulen ihrer Entität (`SCENE_STATUSES` und `SCENE_TYPES` in
`shared/src/scene.ts`, `NPC_STATUSES` in `npc.ts`, `CHAPTER_STATUSES` in
`chapter.ts`); das Schema baut die Constraints aus genau diesen Listen,
wiederholt sie also nicht. Ein fremder Wert auf dem Schreibweg ist eine 400
mit `status_not_allowed` (`{ kind, value, allowed }`) bzw.
`scene_type_not_allowed` (`{ value, allowed }`), nicht ein
`CHECK constraint failed` aus SQLite.

**Warum:** Eine Liste, die nur die API einhält, ist eine Absprache: sie gilt
an den Stellen, an denen jemand daran gedacht hat, und ein Tippfehler aus dem
Generator oder aus einem direkten Schreibzugriff käme in der Spalte an und
wäre danach ein Wert, den die Leseansicht wörtlich anzeigt und den niemand
mehr als Fehler erkennt. Die Zeile ist die Wahrheit (ADR #13); dann gehört
eine Regel über den Inhalt einer Spalte auch in die Spalte. Das ist dieselbe
Bewegung wie ADR #19: Referenzen sind Fremdschlüssel und keine Absprache.

Der Widerspruch zum „Format degradiert" aus README.md ist keiner. Degradieren
ist eine Regel für den **Leser**: ein unbekannter Callout und eine unbekannte
Überschrift werden angezeigt und werfen nie. Geschlossen ist der
**Schreibweg** — die Spalte kann keinen fremden Wert aufnehmen.

**Folgen:**

- Die App braucht für jeden der beiden Codes einen Katalog-Eintrag; ohne ihn
  degradiert sie auf den englischen `error`-Satz.
- Neue Werte in einer der Listen sind eine Migration, keine Änderung an einer
  Konstante allein. Das ist gewollt: eine fünfte Position im Status ist eine
  Entscheidung über das Datenmodell.
- Dieselbe Bewegung gilt für die Zeitstempel: `sessions.started`/`ended` und
  die Pausen haben genau eine Form (`yyyy-mm-ddTHH:MM:SS`,
  `server/src/store/time.ts`). Der Server bildet sie aus dem Epochen-Wert,
  den der Client schreibt (ADR #31), und der Leser liest nur sie.

## 26. Listen sind keine Einträge

Ersetzt durch ADR #31.

## 27. Die Reihenfolge der Szenen im Kapitel ist gesetzt, nicht abgeleitet

**Entscheidung:** Ein Kapitel hat eine **Szenenreihenfolge**, und die setzt der
DM. `scenes.pos` ist diese Reihenfolge — fortlaufend **innerhalb des
Kapitels** —, gepflegt über Hoch/Runter an der Zeile. Die Kapitelübersicht
zeigt genau sie: eine durchgehende Liste ohne Ortsgruppen. Der Ort steht an
der Szene — in der Metazeile ihrer Zeile, mit dem Namen des Orts. Eventualszenen bleiben ein eigener
Block am Ende.

- **Lesen:** `ChapterNode.scenes: SceneSummary[]`, sortiert nach `pos`.
  `SceneSummary` trägt neben der Orts-id den aufgelösten **Ortsnamen**
  (`locationName`).
- **Schreiben:** `PUT /api/campaigns/:campaign/chapters/:chapter/scene-order`
  mit `{ scenes: string[], rev }`. `scenes` ist die vollständige neue
  Reihenfolge; ist sie nicht exakt die Menge der Szenen-ids dieses Kapitels —
  eine fehlt, eine doppelt sich, eine gehört woanders hin —, ist das **400**
  und es wird nichts geschrieben. Eine Teilliste **ohne Positionen**
  anzunehmen hieße, den Rest irgendwohin zu sortieren, und das entscheidet
  niemand nebenbei; dieser Endpoint bedient das Hoch/Runter an der Zeile, dem
  die vollständige Liste ohnehin vorliegt — sie zu schicken kostet nichts.

  Eine Teilliste **mit ausdrücklichen Positionen** ist etwas anderes, und
  sie gibt es genau einmal: für die Szenen eines Generator-Laufs, damit
  dessen Reihenfolge auch über mehrere Teil-Übernahmen hält. `pos` ist ein
  Sortierschlüssel und verträgt Lücken, nichts hier setzt dichte Werte
  voraus. Die Regel: **Position = Startwert des Laufs + Nummer der Szene in
  der Gliederung.**

  - **Die Nummer** ist der Index der Szene unter den Szenen-Teilen der
    Gliederung, in Gliederungsreihenfolge. Der Entwurf trägt kein eigenes
    Feld dafür — die Gliederung liegt am Job. Eine verworfene oder
    fehlgeschlagene Szene behält ihre Nummer und hinterlässt eine Lücke, ein
    Retry ändert die Nummer nicht.
  - **Der Startwert** ist der stabile Bezugspunkt, den die Nummern
    brauchen: das Kapitelende bei der **ersten Szenen-Übernahme** des Laufs.
    Er wird im selben Commit am Job gespeichert (im serverinternen
    Pipeline-Stand, neben der Gliederung, übersteht also einen Neustart) und
    für diesen Lauf nie neu berechnet — ein je Übernahme neu berechnetes
    „ans Ende" wanderte mit, und eine später übernommene frühere Szene
    landete wieder hinten. Nicht der Laufstart: eine Szene, die der DM
    zwischen Start und erster Übernahme von Hand anlegt, steht so vor dem
    Lauf. Ein neues Kapitel beginnt damit bei 0, ohne Sonderfall.
  - **Die Handsortierung gewinnt.** Mit dem Startwert speichert der Job den
    `scene_order_rev` des Kapitels. Hat der sich seitdem bewegt — der DM hat
    über diesen Endpoint umsortiert, der die Positionen dicht neu schreibt —,
    hängt jede weitere Übernahme dieses Laufs ans Kapitelende wie jede andere
    neue Szene. Einen neuen Startwert gibt es nicht: er sortierte nur wieder
    um die Ordnung des DM herum.
  - **Ein Gleichstand** entsteht nur, wenn der DM mitten in der Prüfung eine
    Szene von Hand anlegt. Er braucht keine eigene Regel: die Kapitelliste
    sortiert nach `pos, id`, das Ergebnis ist eindeutig.

  Wer alles in einem Aufruf übernimmt, bekommt dieselbe Reihenfolge, und
  keine Übernahme bewegt `scene_order_rev`, `chapters.rev` oder
  das `rev` einer bestehenden Szene. Ein neuer Lauf ersetzt den alten Job
  (ein Job je Kampagne) und bekommt seinen eigenen Startwert; ein
  Einsortieren über Läufe hinweg gibt es nicht.
- **Der Wächter ist `chapters.scene_order_rev`** — ein eigener Zähler, der
  nur die Writes dieser einen Liste zählt und den `ChapterNode` mitliefert;
  das `rev` im Rumpf ist seiner. Ein alter Stand ist **409 `rev_conflict`**.
  Der Write bumpt `scene_order_rev` und `campaigns.version` — **weder**
  `scenes.rev` **noch** `chapters.rev`.
- **Neue Szenen landen am Ende** ihres Kapitels. Wechselt eine Szene das
  Kapitel, landet sie am Ende des Zielkapitels: dort ist sie neu, und wo sie
  in der Dramaturgie des anderen Kapitels stand, sagt über das Ziel nichts.
  Die eine Ausnahme sind die übernommenen Entwürfe eines Generator-Laufs:
  sie stehen am Startwert des Laufs plus ihrer Nummer in der Gliederung
  (oben), solange der DM das Kapitel nicht von Hand umsortiert hat.
- **Die Session-Ansicht liest dieselbe Reihenfolge.** Sie öffnet die erste
  Szene, deren Status weder `played` noch `dropped` ist, sonst die erste;
  unter der offenen Szene steht der Schritt „Nächste Szene: <Titel>".

**Warum keine abgeleitete Ordnung:** Eine abgeleitete Reihenfolge fiele an,
statt gesetzt zu werden — etwa nach Szenen-id oder nach Ortsname. Beide
Schlüssel sind für diese Aufgabe die falschen. Die id entsteht aus dem
getippten Namen und steht danach fest (ADR #21); der Name wiederum ist
Dramaturgie — „Ankunft am Leuchtturm", „Der Keller" —, und wer dramaturgisch
benennt, sortiert nicht. Der DM könnte die Ordnung also nur über den Namen
beeinflussen, und genau das wirkt nicht: ein neuer Titel ändert die id nicht,
und die id ist es, die die Sortierung liest. Übrig bliebe, ids zu Nummern zu
machen (`01-ankunft`) — eine Reihenfolge, die beim ersten Umstellen falsch
wird und die der Referenz-Schlüssel des ganzen Modells danach mit sich
herumträgt.

Eine Ordnung, die der DM nicht setzen kann, ist am Tisch keine Ordnung. Die
Kapitelübersicht ist das Werkzeug der Vorbereitung, und Vorbereitung heißt: in
welcher Reihenfolge erzähle ich das. Der Ort ist dafür eine Eigenschaft der
Szene, keine Gliederungsebene über ihr — zwei Szenen am selben Ort können in
der Dramaturgie weit auseinanderliegen, und die Gruppierung hat sie trotzdem
nebeneinandergestellt.

**Warum die Ordnung dem Kapitel gehört und trotzdem einen eigenen Wächter
bekommt:** Eine Reihenfolge ist eine Aussage über eine **Menge**, nicht über
ein einzelnes Element. „Diese Szene ist die dritte" heißt nichts ohne die
anderen, und ein Umsortieren ändert immer mehrere Positionen auf einmal.
Deshalb ist der Schreibweg einer für das ganze Kapitel. Sie gehört dem
Kapitel — aber sie **ist** nicht das Kapitel: dessen `rev` bewacht seine
Felder samt Text, die sich einen Wächter teilen (ADR #23), und die
Reihenfolge ist keins davon. Sie ist eine eigene Liste mit eigener
Lebensdauer, also bekommt sie `chapters.scene_order_rev`.

Dasselbe Muster hat die Reihenfolge des Kampagnenwissens
(`campaigns.knowledge_item_order_rev`, ADR #31). Ein Zähler, den jeder
unbeteiligte Write hochdreht, macht eine offene Bearbeitung unspeicherbar —
am härtesten während einer laufenden Session, wo ständig geschrieben wird.
Ein Wächter zählt deshalb nur die Writes, gegen die er schützt.

Am Kapitel stehen damit **drei Schreibwege mit drei Wächtern**, und keiner
stört den anderen: die Szene mit `scenes.rev` (ihre Felder samt Text), das
Kapitel mit `chapters.rev` (Titel, Status, Kapiteltext) und die Reihenfolge mit `chapters.scene_order_rev`. Ein
Hoch/Runter treibt weder einen offenen Szenen-Editor noch einen offenen
Kapiteltext in eine 409 — beides wären Konflikte über etwas, das sich gar
nicht widerspricht. Umgekehrt merkt der, der gerade umsortiert, es sofort,
wenn jemand anders die Reihenfolge verändert hat. Genau das soll ein Wächter:
echte Überschreibungen abfangen und sonst schweigen.

**Warum `pos` kein Feld der Szene ist:** Jedes Feld ist eine Spalte, aber
nicht jede Spalte ist ein Feld. `pos` steht deshalb **nicht** im Typ der
Szene, nicht in den Fixtures und nicht im Eigenschaften-Dialog. Felder sind,
was eine Szene über sich selbst aussagt: Titel, Typ, Ort, Status, NPCs. Wo er in einer Liste steht, sagt die
Liste über ihn aus, nicht er über sich. Eine Positionszahl im
Eigenschaften-Dialog wäre obendrein unbedienbar: der DM müsste ausrechnen,
welche Zahl die Szene an die gewünschte Stelle bringt, und die Nachbarn zögen
nicht mit.

Im Schema ist das kein Sonderfall, sondern Regel 2: Reihenfolge ist
festgehaltene Information und wohnt in einer `pos`-Spalte. `scene_npcs.pos`
hält die Reihenfolge der NPCs einer Szene, `chapters.pos` die der Kapitel —
beide sind keine Eigenschaften, beide werden nicht im Dialog gepflegt, und
`scenes.pos` reiht sich genau dort ein.

**Verhältnis zu ADR #17:** Dessen Kern — zwei unabhängige Werte für
dieselbe Sache driften, also schafft man einen ab — gilt auch hier: die
Reihenfolge hat genau eine Quelle, `pos`, statt aus Namen oder Ort abgeleitet
zu werden.

**Migration** `0001_scene_pos_per_chapter.sql`: die Spalte
`chapters.scene_order_rev` und ein `UPDATE` mit Fensterfunktion, das jedem
Kapitel seine Positionen ab 0 vergibt, in der Reihenfolge, die die
Kapitelübersicht bis dahin nach Ort gruppiert zeigte: zuerst die Szenen mit
Ort, sortiert nach dem Anzeigenamen des Orts (sein `name`, ersatzweise seine
id), innerhalb eines Orts nach Szenen-id; die Szenen ohne Ort am Ende. So
sieht der DM nach dem Update dieselbe Liste, nur ohne Überschriften. Die
kampagnenweit vergebenen Werte davor werden **verworfen** statt umgerechnet:
„ans Ende anhängen" zählt gegen die Geschwister im eigenen Kapitel. Jeder Teil
der Regel ist eine Spalte oder ein Join; das Skript ist idempotent, und eine
frische Datenbank fasst es nicht an.

**Verworfene Alternativen:**

- **Ortsgruppen behalten und nur innerhalb der Gruppe sortieren.** Rettet
  genau die Gliederung, die das Problem ist: Der DM kann die Szene, die er als
  nächste erzählen will, nicht nach oben bringen, wenn ihr Ort eine Gruppe
  weiter unten hat. Zwei Ordnungsachsen, von denen er nur eine bedient, sind
  eine halbe Bedienung.
- **Die Gruppenreihenfolge aus der kleinsten `pos` der Gruppe ableiten.**
  Macht die Liste bedienbar und die Gruppen unerklärlich: eine Szene nach oben
  zu schieben verschiebt plötzlich ihre ganze Gruppe mit, und eine Szene
  zwischen zwei Szenen eines anderen Orts abzulegen ist unmöglich — die Gruppe
  zieht sie zurück. Eine Bedienung, deren Ergebnis man vorher nicht absehen
  kann, ist keine.
- **Die Reihenfolge nur in der Session-Ansicht führen.** Dann gäbe es zwei
  Szenenlisten mit zwei Reihenfolgen, und ausgerechnet die Vorbereitung — der
  Ort, an dem über Dramaturgie entschieden wird — hätte die schlechtere. Die
  Session-Ansicht moderiert, was die Vorbereitung gelegt hat; sie ist nicht
  die Stelle, an der die Ordnung entsteht.
- **Den `rev` des Kapitel-Eintrags als Wächter nehmen.** Naheliegend, weil
  die Reihenfolge dem Kapitel gehört — und derselbe Fehler, den `scenes.rev`
  eine Zeile höher vermeidet, nur eine Ebene versetzt. Der Kapiteltext ist
  bearbeitbar; ein Umsortieren würde einen offenen Kapitel-Editor in eine 409
  treiben, und ein Kapitel-Write (Titel, Status, Text) würde umgekehrt ein
  vorbereitetes Umsortieren ungültig machen. Beide Male ein Konflikt, der
  keiner ist. Ein Wächter, der auf fremde Writes anspringt, erzieht dazu, die
  Konfliktzeile wegzuklicken — und dann fängt er die echte Überschreibung
  auch nicht mehr.
- **Drag & Drop statt Hoch/Runter.** Später möglich, jetzt nicht: es braucht
  eine Bibliothek, eine Tastatur-Bedienung, die ohnehin auf Hoch/Runter
  hinausläuft, und eine Greiffläche, die mit der „ruhigen Liste" aus
  docs/UI-BRIEF.md ringt. Hoch/Runter ist mit Tastatur und Zeigegerät dieselbe
  Bedienung, ist auf dem Handy nicht kaputt und schreibt dieselbe Liste an
  denselben Endpoint. Kommt Drag & Drop später dazu, ändert es die Geste und
  nicht den Contract.

**Bewusst nicht Teil der Entscheidung:** Eine Reihenfolge über Kapitelgrenzen
hinweg — die Kapitel haben ihre eigene (`chapters.pos`). Sortieren nach
Status, Tag oder Ort als Ansicht: die Kapitelübersicht filtert, sie sortiert
nicht um. Und der Eventualszenen-Block bekommt keine zweite Ordnung — er ist
derselbe `pos`-Lauf, nur getrennt gezeigt.

## 28. v0.7 ist die Baseline

**Entscheidung:** Grimoire v0.7 ist die erste unterstützte Version.
Installationen vor v0.7 werden nicht unterstützt: der Server erkennt eine
solche Datenbank nicht und behandelt sie nicht gesondert — es gibt keinen
Versions-Riegel. Die Migrationen `0000`–`0018`, die jede v0.7-Datenbank
durchlaufen hat, sind zu **einer** Baseline zusammengefasst
(`server/src/db/migrations/0000_baseline.sql`). Die spätere Migration aus
ADR #27 steht als `0001_scene_pos_per_chapter.sql` unverändert darauf.

**Warum:** Jede Datenbank, die einmal mit v0.7 gestartet ist, hat die
Migrationen 0000–0018 und alle Vorabprüfungen davor bestanden, und eine
Installation von vor v0.7 gibt es nicht. Code, der ältere Stände über diese
Schwelle bringt, hat damit keinen Anwendungsfall, aber Pflegekosten:
Prüf- und Datenschritte rund um den Migrator, ein Boot-Durchgang für
Generator-Jobs, ihre Tests und neunzehn Migrationen, die jede neue Instanz
nacheinander durchliefe, um am Ende dasselbe Schema zu haben.

**Wie die Baseline greift:** Drizzles Migrator wendet eine Migration nur an,
wenn ihr `when` im Journal größer ist als der `created_at` der zuletzt
eingetragenen; Hashes vergleicht er nicht. Die Baseline trägt deshalb das
`when` der bisherigen `0018` (`1789757329900`), `0001` das der bisherigen
`0019` (`1789760000000`). Daraus folgt:

| Datenbank | Baseline | `0001` |
| --------- | -------- | ------ |
| leer (frische Installation) | angewandt | angewandt |
| v0.7 | übersprungen | angewandt |
| v0.8 | übersprungen | übersprungen |

Diese beiden `when`-Werte ändern sich nie. Neue Migrationen entstehen über
`drizzle-kit generate` und stehen auf `0001`.

**Inhalt der Baseline:** genau das Schema einer über 0000–0018 migrierten
Datenbank — Tabellen mit derselben Spaltenreihenfolge, Primär- und
Fremdschlüssel, CHECK-Constraints, der eine Index und die FTS5-Tabelle. Es
ist aus dem `sqlite_master` einer frisch migrierten Datenbank abgeleitet und
im PR einmalig verglichen, nicht als bleibender Test (Migrationen werden
nicht getestet, CLAUDE.md). Ohne Gegenstück bleibt nur SQLites interne
Tabelle `sqlite_sequence`: eine längst gelöschte Tabelle mit
`AUTOINCREMENT` hat sie hinterlassen, sie ist leer und lässt sich nicht per
DDL anlegen. Das Snapshot in `meta/` ist das der bisherigen `0018`, sodass
`drizzle-kit generate` gegen `schema.ts` weiter nur echte Änderungen findet.

**Entfällt:**

- der Datenschritt vor dem Migrator (`db/group-migration.ts`, ADR #17) und
  die Vorabprüfungen (`db/reference-preflight.ts`, ADR #19;
  `db/status-preflight.ts` und `db/timestamp-preflight.ts`, ADR #25;
  `db/list-rows-preflight.ts` für die Listenzeilen) samt Tests und
  Boot-Meldungen.
  `openDb` öffnet die Datei, setzt die PRAGMAs und migriert, sonst nichts;
- der Boot-Durchgang für Jobs in der alten Entwurfsform (ADR #24).

**Bleibt:** die Constraints selbst — Fremdschlüssel, CHECK, die eine Form der
Zeitstempel — und ihre Fehlerpfade auf dem Schreibweg. Sie sind das
Verhalten, nicht der Übergang. Ebenso `failInterruptedJobs`: ein Neustart
kann jederzeit einen laufenden Job treffen, das ist kein Übergangscode.

**Künftige Migrationen:** Damit kein neuer Übergangscode entsteht, gelten für
jede Migration nach der Baseline vier Regeln:

1. **Datenänderungen stehen in der Migration selbst.** Umzüge,
   Umformatierungen und Aufteilungen sind SQL der Migration und laufen in
   derselben Transaktion wie die Schemaänderung. Es gibt keinen Datenschritt
   vor oder nach dem Migrator, keine Vorabprüfung und keinen Boot-Durchgang.
2. **Nicht eindeutig Übertragbares entscheidet die Migration fest und
   verlustfrei** — etwa `NULL` setzen, den Wert sichtbar in den Text
   übernehmen oder ihn als eigenen Abschnitt anhängen. Die Entscheidung steht
   im ADR der Änderung. Das ersetzt die Start-Verweigerung, ohne etwas hinter
   dem Rücken des DM zu reparieren: die Migration entscheidet nachvollziehbar
   und dokumentiert, statt still zu raten.
3. **Kein Code, der nur für eine Migration existiert.** Übergangscode gibt es
   nicht, auch nicht per eigenem, befristetem ADR: ein Umbau wird so
   geschnitten, dass weder Adapter noch Doppelwege entstehen (`CLAUDE.md`,
   „Arbeitsweise“).
4. **Ungültige Daten entstehen gar nicht erst.** Das leisten CHECK-Constraints,
   Fremdschlüssel und die 400 am Schreibpfad. Deshalb braucht es auch künftig
   keine Vorabprüfung.

**Verworfene Alternativen:**

- **Ein Versions-Riegel**, der eine Datenbank von vor v0.7 erkennt und mit
  einem Hinweis abweist. Er wäre genau der Übergangscode, der hier entfällt,
  für Installationen, die es nicht gibt.
- **Nur die Prüfungen entfernen, die Migrationen stehen lassen.** Die alten
  Migrationen 0009, 0014, 0016 und 0018 setzen voraus, dass ihre Prüfung
  vorher lief; ohne sie wären sie Code, der auf einer Datenbank mitten im
  Umbau scheitern kann. Eine neue Instanz braucht nur den Endstand, und den
  legt die Baseline in einem Schritt an.

## 29. Was als Daten gebraucht wird, ist eine Eigenschaft oder eine Listenzeile

**Warum:** Ein Abschnitt, den Code über den Text seiner `##`-Überschrift
findet, ist eine Absprache mit dem DM, die still bricht: Leser und Schreiber
erkennen Überschriften leicht nach verschiedenen Regeln (Groß/Klein, CRLF),
und was der DM anders schreibt, fällt still heraus oder entsteht doppelt.
ADR #19 sagt, dass die Speicherung nichts aus Text ableitet; dasselbe gilt für
Anzeige, Schreibwege und Prüfungen.

**Entscheidung:** Was eine Ansicht, ein Schreibweg oder eine Prüfung als Daten
braucht, ist eine **Eigenschaft** einer Entität oder eine **eigene Zeile**
(ADR #31) — nie ein Abschnitt, der über den Text seiner Überschrift gefunden
wird. Überschriften im Text gliedern ihn für den DM; eine Bedeutung für den
Code hat allein `## If:`, ein Element des Renderers (README). Im Code von
`app/`, `server/` und `shared/` sucht allein `## If:` eine Überschrift per
Text.

Eine Zeile ist ihre Spalten: kein Markdown in der Zeile, kein Leser, der Text
in Zeilen zurückparst, und keine Skelett-Zeilen, die nur ein Text bräuchte
(Überschriften, Marker). Eine Pause ist eine Zeile der Pausen einer Session
und keine Log-Zeile: Pausieren schreibt keine Log-Zeile.

Eine Migration, die eine solche Eigenschaft oder Zeile einführt, **überträgt
nichts** aus dem Text (ADR #28, Regel 2): ein bestehender Abschnitt bleibt
freier Text. Einen Wert aus einem Markdown-Abschnitt zu schneiden, wäre genau
der Leser, den diese Entscheidung ausschließt.

**Motivation und Atmosphäre:**

- `npcs.motivation` und `locations.atmosphere` sind Spalten und damit
  Eigenschaften (`motivation`, `atmosphere`). NPC-Karte, Ort-Karte,
  Hover-Vorschau und Leseansicht lesen sie; ein `## Will` oder
  `## Atmosphäre` im Text hat darauf keinen Einfluss. Ein `[[id]]` im Wert
  erscheint bei der Anzeige als aktueller Name — Anzeige, keine Referenz im
  Sinn von ADR #19 —, und die Suche indexiert beide Felder mit aufgelösten
  Namen.
- Bearbeitet werden sie im Bearbeiten-Modus der Leseansicht neben dem Text,
  nicht im Eigenschaften-Dialog.
  Sie teilen den einen Wächter `rev` (ADR #23): ein Speichern ist ein PATCH
  mit dem, was sich geändert hat, und „Trotzdem speichern" schreibt genau
  das — eine fremd geänderte Eigenschaft bleibt.
- Der Generator liefert beide Felder über das Antwort-Schema, nullable wie
  `voice` und `appearance`; NPC- und Ort-Prompt beschreiben sie als
  Eigenschaft.

**Die offenen Fäden eines Kapitels:**

- Ein Faden ist eine Zeile der Tabelle `threads` und nie eine Checkliste im
  Kapiteltext: `campaign_id`, eine opake `id` (eindeutig je Kampagne, nicht je
  Kapitel und nicht die Position), das Kapitel `chapter_id` als
  Fremdschlüssel (ADR #19), `text`, `done`, `pos`. Ressource, Endpunkte und
  Wächter regelt ADR #31: ein Faden liegt flach unter der Kampagne, sein
  Kapitel ist ein Feld, und jeder Faden hat sein eigenes `rev`. Ein weiterer
  Anker (Szene, Kampagne) wäre eine weitere Besitzer-Spalte.
- Anlegen trägt kein `rev`, wie Idee und Log-Zeile: ein Anhängen
  überschreibt nichts, und ein Wächter würde „Handlungsstrang übernehmen" nur
  deshalb abweisen, weil sich in einem anderen Tab etwas bewegt hat.
- **Getrennte Wächter:** kein Schreibzugriff auf einen Faden berührt Text oder
  `rev` des Kapitels, und ein Kapitel-Write bewegt keinen Faden — dieselbe
  Trennung wie bei der Szenenreihenfolge (ADR #27).
- **Nachbereitung und Kapitelübersicht** lesen Zeilen. „Handlungsstrang
  übernehmen" legt einen Faden an; die Kapitelübersicht zeigt die Fäden unter
  dem Kapiteltext und pflegt sie (abhaken, umformulieren, löschen, von Hand
  ergänzen).
- **Keine Suche, kein Generator-Kontext:** die Fäden werden nicht indexiert,
  wie die Ideen. Der Kapiteltext erreicht keinen Generator-Prompt — ein
  Szenen-Lauf kennt vom Kapitel nur die id —, also fehlt dem Generator nichts.
- Ein vorhandener Abschnitt `## Offene Fäden` bleibt freier Text des Kapitels.

**Generator-Prüfungen und NPC-Stub:**

- Keine Prüfung des Generators und kein Schreibweg des NPC-Stubs verzweigt
  über eine Überschrift. `## Weiß` und `## Beziehungen` sind Empfehlung der
  NPC-Prompts, freier Text.
- Geprüft wird eine Regel ohne Überschrift: jedes `[[id]]` in einem erzeugten
  Text nennt einen NPC, Ort oder eine Szene der Kampagne oder einen Vorschlag
  desselben Laufs (die Gliederung eines Szenen-Laufs, im NPC-Lauf der NPC
  selbst) — sonst geht die Antwort als Korrektur-Turn zurück. Sie gilt für
  Szenen, NPCs und Orte im neuen Lauf und im Ergänzen-Lauf; dort nur für
  Verweise, die der Vorschlag neu bringt, denn ein Verweis im bestehenden
  Text gehört dem DM, und die Ergänzungsregel verlangt, ihn stehen zu lassen.
  Gelesen wird mit der Grammatik von Anzeige und Suche
  (`@grimoire/shared/refs`): nur eine kebab-case-id in doppelten Klammern,
  nichts in Code. Geprüft wird der Text; `motivation` und `atmosphere`
  zeigen ein `[[id]]` ohne Eintrag als Text.
- Das ist eine Regel für die **Antwort des Modells**, keine Referenz im Sinn
  von ADR #19: „Übernehmen" und der Schreibweg prüfen sie nicht, und ein
  `[[id]]` ohne Eintrag, das der DM schreibt, bleibt sichtbarer Text.
- **NPC-Stub:** Der Text eines neuen Stubs ist genau die Notiz, ohne
  Überschrift; ohne Notiz bleibt er leer. Ein Stub ohne Name und Notiz gilt
  als leer (`isEmptyNpcRow`), und ein späteres Anlegen oder Übernehmen
  derselben id füllt ihn, statt mit 409 zu kollidieren. Ein NPC mit Inhalt
  kommt unverändert zurück; die Notiz wird dann nicht angehängt.
- Ein bestehender Abschnitt `## Notizen` bleibt freier Text.

**Kapitel und Kampagne zeigen ihren ganzen Text:**

- **Anzeige:** Die Kapitelübersicht zeigt den **ganzen Text** des Kapitels,
  der Kopf unter der Kurzbeschreibung den ganzen Text der Kampagne — beide
  durch denselben Renderer wie jeder Text (Callouts, `## If:`, `[[id]]`),
  auf wenige Zeilen begrenzt und aufklappbar. Ob der Text länger ist, wird
  gemessen; „Mehr anzeigen“ steht nur dann da. Ausgewählt wird nichts, und
  keine Überschrift hat für die Anzeige eine Bedeutung.
- **Anlegen:** „Kapitel anlegen“ schreibt die Beschreibung aus dem Dialog als
  `body` des Kapitels (`POST …/chapters { title, id?, status?, body? }`), so
  wie sie getippt wurde — getrimmt, mit einem abschließenden Zeilenumbruch,
  ohne Überschrift davor.
- **Lauf „Neues Kapitel“:** Die Gliederung trägt `chapterDescription`
  (`shared/schema/outline.schema.json`, nullable). Nur der Gliederungs-Aufruf
  eines Laufs, der sein Kapitel anlegt, erfährt das (Kontextzeile
  `neues Kapitel: ja`) und beschreibt das Kapitel aus dem Quellmaterial.
  „Entwürfe prüfen“ zeigt die Beschreibung lesend, und das Übernehmen legt das
  Kapitel mit ihr als Text an (ADR #18: das Kapitel entsteht aus dem Lauf).
  Für einen Lauf in ein bestehendes Kapitel verwirft die Validierung das Feld,
  und der Text eines Kapitels, das beim Übernehmen schon existiert, bleibt
  unberührt. Fehlt die Beschreibung, beginnt das Kapitel mit leerem Text; das
  kostet keinen Korrektur-Turn.
- Ein bestehendes Kapitel mit `## Ziel des Kapitels` zeigt diese Überschrift
  schlicht als Teil seines Textes.

## 30. Abhängigkeiten statt Eigenbau

**Entscheidung:** Für allgemeine Aufgaben wird ein etabliertes Paket
eingebunden, nicht selbst gebaut — Validierung, Schemata, Datum und Zeit,
Diffs, das Lesen gängiger Formate und was sonst nicht Grimoire-spezifisch ist.
Selbst geschrieben wird, was nur Grimoire hat: das Datenmodell, die
Schreibregeln, das Text-Vokabular, die Oberfläche.

**Warum:** Was wir nicht selbst pflegen, müssen wir nicht bedenken und nicht
testen. Ein Hand-Helfer für eine Standardaufgabe kostet jedes Mal dasselbe:
Randfälle, die das Paket längst kennt, eigene Tests dafür und eine Stelle
mehr, die beim nächsten Umbau mitgezogen werden will. Ein etabliertes Paket
bringt das mit, ist dokumentiert und von vielen geprüft. Die Kosten einer
Abhängigkeit — ein Eintrag im Lockfile, gelegentlich ein Update — sind
kleiner als die eines eigenen Nachbaus.

**Folgen:**

- Eine neue Abhängigkeit braucht keinen Eintrag hier. Eintragspflichtig
  bleiben allein **Bun-only-APIs** (Node-Portabilität, ADR #5 und #7);
  `CLAUDE.md` hält beide Regeln unter „Arbeitsweise“ fest.
- „Etabliert“ heißt: verbreitet, gepflegt, mit Typen. Versionen stehen im
  Lockfile und werden bewusst angehoben; wo ein Paket exakt gepinnt werden
  muss, steht der Grund an seiner Stelle (`jsonrepair`, ADR #5).
- Anwendungen: `date-fns` für Datum und Zeit, `zod` für das Schema jeder
  Entität (ADR #31).

## 31. Eine Ressource und ein Typ je Entität

**Kontext:** Die Datenbank hält jede Entität in ihrer eigenen Tabelle mit
eigenen Spalten. Ein gemeinsamer Endpunkt über mehrere Entitäten mit einer
untypisierten Abbildung der Felder verliert diese Typisierung auf dem Weg zur
Leitung: die zulässigen Schlüssel brauchen dann eine eigene Liste, ihre Formen
eine eigene Beschreibung, die Generator-Schemata eine dritte Fassung, und
Store wie App verzweigen an jeder Stelle darüber, welche Entität gemeint ist.
Ein neues Feld kostet so mehrere Stellen statt einer.

**Entscheidung:** Jede Entität der Datenbank ist eine eigene Ressource mit
eigenem Typ und eigenem zod-Modul als einziger Quelle. Einen allgemeinen
Endpunkt über mehrere Entitäten gibt es weder in der API noch in der App.

Die Ressourcen der Entitäten:

| Entität | Lesen/Ändern | Anlegen/Liste | App-Route |
|---|---|---|---|
| Kampagne | `GET/PATCH /campaigns/:c` | `POST /campaigns` | `/campaigns/:c` |
| Kapitel | `GET/PATCH /campaigns/:c/chapters/:id` | `GET/POST /campaigns/:c/chapters` | `/campaigns/:c/chapters/:id` |
| Szene | `GET/PATCH /campaigns/:c/scenes/:id` | `GET/POST /campaigns/:c/scenes` | `/campaigns/:c/scenes/:id` |
| NPC | `GET/PATCH /campaigns/:c/npcs/:id` | `GET/POST /campaigns/:c/npcs` | `/campaigns/:c/npcs/:id` |
| Ort | `GET/PATCH /campaigns/:c/locations/:id` | `GET/POST /campaigns/:c/locations` | `/campaigns/:c/locations/:id` |
| Faden | `GET/PATCH/DELETE /campaigns/:c/threads/:id` | `GET/POST /campaigns/:c/threads` | in der Kapitelübersicht |
| Idee | `GET/PATCH /campaigns/:c/ideas/:id` | `GET/POST /campaigns/:c/ideas` | in Nachbereitung und Mobil-Startfläche |
| Glossar-Begriff | `GET/PATCH/DELETE /campaigns/:c/glossary-terms/:id` | `GET/POST /campaigns/:c/glossary-terms` | auf der Glossar-Seite `/campaigns/:c/glossary` |
| Kampagnenwissen | `GET/PATCH/DELETE /campaigns/:c/knowledge-items/:id` | `GET/POST /campaigns/:c/knowledge-items` | auf der Wissens-Seite `/campaigns/:c/knowledge` |
| Session | `GET/PATCH/DELETE /campaigns/:c/sessions/:id` | `GET/POST /campaigns/:c/sessions` | `/campaigns/:c/sessions/:id`, live `/campaigns/:c/live` |
| Pause | `PATCH /campaigns/:c/sessions/:s/pauses/:id` | `POST /campaigns/:c/sessions/:s/pauses` | in der Session |
| Log-Zeile | `PATCH /campaigns/:c/sessions/:s/log/:id` | `POST /campaigns/:c/sessions/:s/log` | in Session und Nachbereitung |
| Gespielte Szene | — | `POST /campaigns/:c/sessions/:s/played-scenes` | in der Session |
| Generator-Job | `GET/PATCH/DELETE /campaigns/:c/generator-jobs/:id` | `GET/POST /campaigns/:c/generator-jobs` | auf der Generator-Seite `/campaigns/:c/generate` und in den Ergänzen-Dialogen |
| Teil eines Laufs | `PATCH /campaigns/:c/generator-jobs/:j/parts/:key` | — | im Generator-Job |

Die API-Pfade stehen unter `/api` (ADR #22). URL-Segmente sind der
englische Plural der Entität.

- **Leitung:** Jede Ressource antwortet mit ihrem eigenen Typ, etwa
  `Location { id, name, chapter?, roll20Page?, atmosphere?, body, rev }`. Es
  gibt kein `kind`, kein `path`, keinen gemeinsamen Basistyp und keine
  Vereinigung mehrerer Entitäten; welche gemeint ist, steht in der URL.
  Feldnamen sind gewöhnliche Bezeichner (`roll20Page`).
- **Stabile Schlüssel.** Jede Entität hat eine stabile `id`, und über sie —
  nie über ihre Position und nie über einen änderbaren Text — nennen URL,
  Leitung und Verweise sie. Setzt der DM die id nicht selbst (ein Faden, eine
  Idee, ein Glossar-Begriff, ein Stück Kampagnenwissen), vergibt der Server
  beim Anlegen eine opake. Ein Text, der je Kampagne nur einmal stehen darf
  (der Begriff eines Glossar-Begriffs), ist ein Feld mit eindeutigem Index,
  kein Schlüssel.
- **Flach oder verschachtelt.** Eine Entität, die zwischen Eltern wandern
  kann, liegt flach unter der Kampagne, und ihr Elternteil ist ein Feld: eine
  Szene unter `…/scenes/:id`, ein Faden unter `…/threads/:id`, jeweils mit
  `chapter`. Ihre ids sind je Kampagne eindeutig, und ihre URL ändert sich
  nicht, wenn sie wandert; die Liste filtert nach dem Elternteil
  (`…/threads?chapter=<id>`). Eine Entität, die ohne ihren Elternteil nicht
  existiert und nie wandert, hängt unter ihm
  (`…/<eltern>/:id/<entitäten>/:id`): Pause, Log-Zeile und gespielte Szene
  unter ihrer Session. Gelesen wird ein solches Kind mit seinem Elternteil,
  das es eingebettet liefert; geschrieben wird es nur über seine eigene
  Ressource, und ein Schreibzugriff auf den Elternteil schreibt es nicht.
- **Keine Sammelbegriffe.** Jedes Feld ist ein Feld seiner Entität, `body`
  eingeschlossen. Typen, Code und Doku beschreiben jede Entität mit ihren
  eigenen Feldern; es gibt keine Hälften einer Entität und keine gemeinsame
  Form, die mehrere Entitäten vertritt.
- **Übergänge sind Änderungen an Ressourcen, keine Aktions-Endpunkte.** Ein
  Zustand ist ein Feld: ein Wechsel ist ein `PATCH` darauf, ein Anfang ein
  `POST`, ein Verwerfen ein `DELETE`. Eine Idee abhaken ist
  `PATCH …/ideas/:id { rev, done }`. Welches Kapitel aktiv ist, sagt sein
  `status`, und je Kampagne ist höchstens ein Kapitel aktiv.
  Eine Session startet mit `POST …/sessions`, endet mit
  `PATCH …/sessions/:id { rev, endedMs }` und wird verworfen mit `DELETE`;
  eine Pause beginnt mit `POST` und endet mit `PATCH` auf die Pause. Welche
  Session läuft, sagt ein Filter der Liste (`…/sessions?running=true`), kein
  eigener Endpunkt.
  Ein Generator-Lauf beginnt mit `POST …/generator-jobs { kind, … }` (ein
  Szenen- oder NPC-Lauf) oder auf der Ressource, die er ergänzt. Geprüft und
  übernommen wird er mit `PATCH …/generator-jobs/:id { rev, … }`: die
  Entscheidungen stehen unter `review`, und wer Vorschläge in
  `review.writtenScenes`, `writtenNpcs` oder `writtenLocations` nennt,
  schreibt sie in die Kampagne. Ist danach nichts mehr offen, ist der Job
  erledigt, und die Antwort ist sein letzter Stand. Ein gescheiterter Teil
  läuft erneut mit `PATCH …/parts/:key { status: "running" }`; verworfen wird
  der Job mit `DELETE`. Je Kampagne gibt es höchstens einen Job, darum ist
  seine Liste leer oder hat genau einen Eintrag.
  `PATCH …/chapters/:id { rev, status: "active" }` und `POST …/chapters` mit
  `status: "active"` aktivieren ein Kapitel; der Server setzt das bisher
  aktive Kapitel in derselben Transaktion auf `planned`, und dessen `rev`
  bewegt sich mit. Jeder Schreibweg, der `active` setzt, hält diese Regel.
- **Schreiben:** `PATCH` nimmt `{ rev, force?, …Teilmenge der Felder }` und
  prüft sie gegen das Schema der Entität. `null` löscht ein optionales Feld;
  ein Feld, das die Entität nicht hat, oder ein Wert der falschen Form ist
  eine 400, die das Feld nennt. Die `id` wird nie geändert (ADR #21). Ein
  veralteter `rev` ist 409 mit dem aktuellen Stand der Ressource unter dem
  Namen der Entität (`{ thread }`, `{ idea }`, `{ glossaryTerm }` …); `force` und
  `nothing_to_write` gelten wie in ADR #23. Anlegen antwortet mit dem Typ der
  Entität und trägt kein `rev`, denn eine neue Zeile überschreibt nichts.
  `DELETE` trägt `{ rev }` wie jeder Schreibzugriff mit Wächter.
- **Zeitpunkte schreibt der Client als Epochen-Wert.** Gespeichert ist ein
  Zeitpunkt als zonenlose Lokalzeit des Servers; nur der Server weiß, zu
  welcher Uhr sie gehört. Er liefert darum die Epochen-Lesung daneben
  (`startedMs`, `toMs` …), und ein Schreibzugriff nennt einen Zeitpunkt in
  genau dieser Form — die Lokalzeit daraus bildet der Server.
- **Ein Wächter je Zeile.** Jede Entität trägt ihr eigenes `rev`, und ein
  Schreibzugriff bewegt nur das der Zeile, die er schreibt. Einen Zähler über
  alle Zeilen einer Art gibt es nicht.
- **Reihenfolge.** Wo der DM eine Reihenfolge setzt, schreibt sie ein
  eigener Endpunkt mit eigenem Wächter an dem, dem die Reihenfolge gehört,
  und kein `rev` einer Entität bewegt sich dabei — die Szenen eines Kapitels
  (`…/chapters/:id/scene-order`, ADR #27), das Kampagnenwissen einer
  Kampagne (`…/knowledge-item-order { items, rev }`). Ein alter Stand ist 409
  mit der aktuellen Reihenfolge. Wo die Reihenfolge alle Zeilen einer
  Kampagne nennt, bewegt auch Anlegen und Löschen ihren Wächter, denn beide
  ändern, was sie aufzählt. Wo die App nicht sortiert, gilt die Reihenfolge
  des Anlegens, und es gibt keinen Reihenfolge-Endpunkt (Faden, Idee,
  Glossar-Begriff).
- **Eine Quelle je Entität: ein zod-Schema** in `shared/src/<entität>.ts`.
  Aus ihm kommen der TypeScript-Typ (`z.infer`), die Prüfung von `PATCH`,
  `POST` und Seed und das Antwort-Schema des Generators. Keine dieser Formen
  wird von Hand nachgebaut: jede Entität leitet ihre Formen selbst und
  ausdrücklich mit der API von zod ab (`omit`, `extend`, `partial`,
  `nullable`, `z.toJSONSchema`) — ein gemeinsames Modul, das über die Felder
  beliebiger Entitäten läuft, gibt es nicht.
- **Generator-Schema:** Das Antwort-Schema einer Entität ist ihr Typ ohne
  `rev` in der strengen Form der Provider, abgeleitet mit `z.toJSONSchema`:
  null-fähig statt optional, `additionalProperties: false`, jedes Feld in
  `required`, kein `pattern`, kein `format`, keine Grenzen. Das Schema trägt
  allein die Form, keine `description`; was das Modell über die Felder wissen
  muss und das Schema nicht sagen kann, steht in ihrem Prompt unter
  `generator/` und wird in der Validierung geprüft. Ein Test prüft genau die
  Regeln des strict mode an den abgeleiteten Schemata.
- **Wo gemischt wird, nennt der Treffer seine Entität.** Ein Suchtreffer ist
  `{ kind, id, title }`: die Suche ist wirklich gemischt, deshalb trägt der
  Treffer `kind`, und die App öffnet daraus die Route der Entität.
  `[[id]]`-Verweise lösen gegen die Ressourcen auf.
- **Ergänzen hängt an der Ressource:** `POST …/<ressource>/:id/augment`
  startet den Lauf und antwortet mit seinem Generator-Job, `POST …/<ressource>/:id/augment/apply` übernimmt ihn. Der
  Vorschlag ist der gelesene Stand neben dem vorgeschlagenen, beide im Typ der
  Entität ohne `rev`.
- **Generator-Ergebnis:** Ein Job listet in seinem Ergebnis `scenes`, `npcs`
  und `locations` als eigene getypte Listen, jede im Typ ihrer Entität ohne
  `rev`. Prüfen, Entscheiden und Übernehmen laufen je Entität.
- **Server:** Das Domänenmodul einer Entität (`server/src/store/<entität>.ts`)
  rendert, liest, schreibt und übernimmt sie getypt.
- **App: Jede Entität verwaltet sich selbst.** Alles, was die App über eine
  Entität weiß, liegt in ihrem Ordner `app/src/<entität>/`: Route und
  Leseansicht, Aktionen, Bearbeiten-Hook und Anlege-Dialog, Karte, Vorschau,
  Kurzfassung und Drawer-Inhalt, ihre Formularfelder, Link und Beschriftung,
  die Teile des Generators, die nur sie betreffen, und die Tests daneben. Die
  Formularfelder sind gegen den Typ der Entität getypt, sodass ein Feld ohne
  Formularfeld nicht übersetzt.
  - Slices importieren einander nicht. Gemeinsam sind nur UI-Bausteine ohne
    Wissen über Entitäten (Formularfelder in `app/src/components/fields/`,
    Kartenhülle, Kurzform, Dialog- und Editor-Flächen); keiner kennt ein
    `kind`.
  - Wo wirklich gemischt wird — `[[id]]`-Auflösung, Suche, Kampagnenbaum,
    Topbar, Seitenkontext, Live-Drawer —, steht nur ein Verteiler: Er ordnet
    eine id oder einen Treffer ihrer Entität zu; Beschriftung, Link und
    Vorschau kommen aus deren Slice.
  - Kein Barrel: Aufrufer importieren die konkrete Datei
    (`@/npc/NpcCard`).

**Warum zod:** Validierung und Schemata sind eine allgemeine Aufgabe (ADR #30).
zod liefert Typ, Prüfung und JSON-Schema aus einer Beschreibung, in der
Sprache, in der der übrige Code geschrieben ist — die Formen können nicht
auseinanderlaufen, weil es nur eine gibt.

**Folgen:**

- Ein neues Feld ist eine Zeile im Schema seiner Entität und eine in ihren
  Formularfeldern, dazu seine Spalte samt Migration. Typ, Prüfung und
  Generator-Schema folgen.
- Die Fixtures liegen je Entität: `fixtures/<kampagne>/<ressource>/<id>.json`,
  etwa `fixtures/beispiel/locations/leuchtturm.json`. Jede Datei ist das
  Objekt, das die Ressource liefert, ohne `rev`. Die Bodies bleiben Zeichen
  für Zeichen, wie sie sind.
- Gespeicherte Generator-Jobs, deren Nutzlast eine Entität in einer anderen
  Form trägt, werden nicht überführt: die Migration löscht sie per SQL
  (ADR #28, Regel 2). Ein Lauf kostet ein paar Token, ein halb überführter
  Vorschlag eine falsche Zeile in der Kampagne.
