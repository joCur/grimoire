# e2e — die kritischen Pfade gegen den echten Stack

Playwright-Suite für die neun kritischen Pfade aus `CLAUDE.md`. Gebaute App,
echter Server-Prozess auf einer eigenen SQLite-Datenbank, echter Browser.
Nichts im Browser ist gemockt — die einzige Attrappe ist das LLM: ein lokaler,
OpenAI-kompatibler Stub (`fixtures/stub-llm.ts`), den der Server über den
normalen `OpenAICompatProvider` per HTTP aufruft.

## Seit dem SQLite-Cutover (#57)

Die Datenbank ist die einzige Wahrheit; der Server liest und schreibt keine
Kampagnen-Markdown-Dateien mehr. Für die Suite heißt das:

- **Gesät wird über den echten Importer — `grimoire seed`.** Jeder Test
  bekommt ein leeres `GRIMOIRE_DATA`-Verzeichnis; die `server`-Fixture ruft
  darauf `grimoire seed <baum>` mit der pristinen Kopie von
  `examples/beispiel` auf und startet DANN den Server. Seit Issue #79
  importiert der Boot selbst nichts mehr; der Seed bleibt aber derselbe
  Importer (Planung #52, PO-Entscheidung F5: kein zweites Datenformat für
  Fixtures).
- **Der Markdown-Baum ist nur noch EINGABE**, einmal pro Test gelesen. Ein
  Test, der Inhalte braucht, die die Beispielkampagne nicht hat, sät sie VOR
  dem Seed in seine eigene Kopie des Baums:
  `test.use({ seed: { files: { "locations/hafen.md": "…" }, remove: ["_campaign.md"] } })`.
  Ohne Seed wird die geteilte pristine Kopie direkt benutzt (niemand schreibt
  hinein), die meisten Tests kopieren also gar nichts.
- **Zusicherungen laufen über die API** (`api`-Helfer, s. u.) — es gibt keine
  Datei mehr, die man zurücklesen könnte. Der frühere `files`-Helfer ist weg;
  eine Fixture, die von „der Datei auf der Platte" erzählt, wäre eine Lüge.
- **Ein Szenen-Pfadsegment ist die `id`**, nicht der frühere Dateiname:
  `01-salzhafen/hafen/lighthouse-arrival.md` und `.../smuggler-captured.md`.
- **`mtimeMs` auf der Leitung ist die Zeilenversion `rev`** — ein opakes
  Wächter-Token. Ein veraltetes antwortet weiter mit 409.
- **„Extern geändert" gibt es nicht mehr.** Kritischer Pfad 9 prüft darum den
  ZWEITEN SCHREIBER: während der Editor offen steht, schreibt der Test über
  die API (`api.writeBody`), danach speichert die UI — und muss den Konflikt
  zeigen und neu laden statt still zu überschreiben. Genauso in
  `status-control`, `frontmatter-form` und `block-composer`.

## Lokal ausführen

```bash
bun install
bunx playwright install chromium     # einmalig
bun run e2e                          # aus dem Repo-Root

# oder direkt in e2e/
cd e2e
npx playwright test                          # alles
npx playwright test generator                # nur den Generator-Pfad
npx playwright test -g "Schnellnotiz"        # nach Testnamen
npx playwright test --headed --debug 04      # zuschauen
npx playwright show-report                   # Report nach einem Fehlschlag
```

Voraussetzung ist `bun` im `PATH` (Server und Stub laufen darauf); liegt es
woanders, hilft `GRIMOIRE_BUN=/pfad/zu/bun`.

Nützliche Schalter:

| Variable        | Wirkung                                                      |
| --------------- | ------------------------------------------------------------ |
| `E2E_VERBOSE=1` | Ausgabe von Server und Stub-LLM durchreichen                 |
| `E2E_KEEP=1`    | Datenbanken und Kampagnen-Kopien nach dem Lauf behalten      |

## Aufbau

```
playwright.config.ts     Projekt (nur chromium), globalSetup, Report
support/global-setup.ts  baut die App, legt die pristine Kopie an, startet den Stub
support/test.ts          das `test` der Suite: eigene Datenbank + eigener
                         Server + `baseURL` pro Test, plus die Fixtures
                         `api`, `db` und `seed`
support/procs.ts         verwaltete Kindprozesse (Start, Warten, Stoppen)
fixtures/stub-llm.ts     standalone LLM-Stub (auch einzeln startbar)
fixtures/replies.ts      die kanonischen Modellantworten
tests/*.e2e.ts           ein Spec pro kritischem Pfad (Zuordnung unten)
```

**Isolation:** Jeder Test bekommt seine eigene Datenbank *und* seinen eigenen
Server-Prozess auf eigenem Port (Bereich ab 3200, pro Worker getrennt).
Zusicherungen sehen damit genau die Zeilen, die dieser Test geschrieben hat —
inklusive des Generator-Jobs, der seit #23 selbst eine Zeile ist.
`examples/` wird nur kopiert, nie verändert. Boot plus Import kosten ~0,2 s.

**Die zwei Zusicherungs-Helfer:**

- `api` — getippte Aufrufe gegen den Server dieses Tests: `api.raw(rel)` (die
  serialisierte Datei — der Nachfolger von `files.read`), `api.file`,
  `api.exists`, `api.get`/`api.send` und die beiden Schreibwege
  `api.writeBody` / `api.patchFrontmatter`, die sich frisch ein Token holen
  und damit den „zweiten Schreiber" spielen.
- `db` — liest `grimoire.db` dieses Tests über den Treiber des Servers
  (`server/src/db/driver.ts`, keine zweite SQLite-Abhängigkeit). Nur für
  Behauptungen, die die API nicht machen kann — die Migrations-Marker in
  `meta` und Zeilenzahlen (`tests/first-migration.e2e.ts`).

Jede Schreibaktion der UI wird weiter doppelt geprüft: in der Oberfläche und
über die API.

Spec-Dateien heißen `*.e2e.ts`, damit `bun test` im Repo-Root sie nicht
einsammelt (Bun matcht `*.test.ts` und `*.spec.ts`).

## Stub-Fixtures anpassen

`fixtures/replies.ts` enthält die Modellantworten als lesbare Markdown-Blöcke:
den Szenen-Entwurf mit NPC- und Ort-Stub, die NPC-Datei und je eine bewusst
ungültige Variante. Sie erfüllen die aktuelle mechanische Validierung aus
`server/src/generator.ts` (Szene: Pfad im Ziel-Kapitel, `status: draft`, nur
bekannte Callouts, Referenzen existieren oder kommen als Stub mit; NPC-Stub
*mit* Status, Ort-Stub *ohne*; NPC-Lauf: `id` == Dateiname, kein `chapter`,
Quickstats als Strings in Anführungszeichen, `## Notizen` leer).

Wenn sich eine Validierungsregel ändert, ist diese Datei die Stelle, die
mitwandert. Die Specs behaupten die dort definierten Titel und ids.

Welche Antwort kommt, entscheidet ausschließlich der Prompt — der Stub hält
keinen Zustand und kann mehrere Worker parallel bedienen:

- `chapter: <id>` im Kontext-Block → Szenen-Lauf für genau dieses Kapitel
- kein `chapter` → NPC-Lauf, `vorgegebene id: <id>` fixiert den Dateinamen
- `E2E_SLOW` im Quelltext → der Stub antwortet **nie** (die Verbindung stirbt
  mit dem Server-Prozess, der gefragt hat). Das ist die einzige Möglichkeit,
  einen Job anzusehen, während er wirklich `running` ist — der Neustart-Fall
  aus #23.
- `E2E_INVALID` im Quelltext → Antwort, die die Validierung reißt (auch im
  Korrektur-Turn, der Lauf endet also in einem 422)
- `E2E_TRUNCATED` im Quelltext → `finish_reason: "length"`

Der Stub läuft auch allein, z. B. um einen Prompt von Hand anzuschauen:

```bash
bun e2e/fixtures/stub-llm.ts --port 4319
LLM_PROVIDER=openai LLM_BASE_URL=http://127.0.0.1:4319/v1 LLM_MODEL=stub \
  APP_DIST=app/dist GRIMOIRE_DATA=/tmp/grimoire-scratch \
  bun server/src/server.ts
# (mit Inhalt: vorher GRIMOIRE_DATA=/tmp/grimoire-scratch bun server/src/cli.ts seed)
```

## Regel

**Wer einen kritischen Pfad berührt oder einen neuen schafft, erweitert diese
Suite im selben PR — sonst kein Merge** (`CLAUDE.md`, „Kritische Pfade"). Die
Pfade und die Specs stehen zueinander; die Nummer steht außerdem in der
Kopfzeile des jeweiligen Specs (die Dateinamen tragen sie bewusst nicht — die
Suite hat keine Reihenfolge). Ein Pfad kann mehr als einen Spec haben, wenn
mehrere Schreibwege auf ihm liegen:

| Pfad (CLAUDE.md)   | Spec                                                           |
| ------------------ | -------------------------------------------------------------- |
| 1 Auto-Einstieg    | `tests/pool.e2e.ts`                                            |
| 2 Szene lesen      | `tests/scene-rendering.e2e.ts`, `tests/rename.e2e.ts`          |
| 3 ⌘K-Suche         | `tests/search.e2e.ts`                                          |
| 4 Session-Zyklus   | `tests/session-cycle.e2e.ts`                                   |
| 5 Ernte            | `tests/review-harvest.e2e.ts`                                  |
| 6 Generator        | `tests/generator.e2e.ts`, `tests/generator-restart.e2e.ts`      |
| 7 Frontmatter/409  | `tests/status-control.e2e.ts`, `tests/frontmatter-form.e2e.ts`, `tests/rename.e2e.ts` |
| 8 Mobil            | `tests/mobile.e2e.ts`                                          |
| 9 Datei bearbeiten | `tests/block-composer.e2e.ts`, `tests/file-edit.e2e.ts`        |

`tests/generator-restart.e2e.ts` ist die Neustart-Hälfte von Pfad 6 (#23) und
braucht darum, wie der Seed-Spec unten, zwei Server hintereinander auf
DEMSELBEN Datenverzeichnis: der erste startet einen Lauf bzw. bringt ihn zu
Ende, der zweite ist der Neustart. Ein **fertiger** Job ist danach vollständig
da (Ergebnis, Review-Edits) und wird übernommen; ein **laufender** steht als
`failed` mit „Server wurde während des Laufs neu gestartet — Job neu starten"
statt als endloser Spinner.

Dazu ein Spec, der auf keinem der neun Pfade liegt, sondern auf der Naht
darunter: `tests/seed.e2e.ts` (Nachfolger von `first-migration.e2e.ts`, Issue
#79 AK6). Er belegt zweierlei — dass eine frische Instanz **leer** startet
(kein Boot-Import mehr) und dass `grimoire seed` den Markdown-Baum vollständig
einliest (Tree, Szenenkörper, NPC, Session, Inbox, Glossar, sauberer Report
auf stdout), während ein **zweiter** Seed-Lauf ein No-op ist: gleiche Marker,
gleiche Zeilenzahlen, gleicher Inhalt. Er braucht eigene Boots und benutzt
darum `startGrimoireServer`/`seedCampaigns` direkt statt der
`server`-Fixture.

Auf Pfad 7 teilen sich zwei Specs die Arbeit: `status-control.e2e.ts` deckt den
Status-Regler ab (ein Schlüssel, Konflikt über das Poll-Fenster),
`frontmatter-form.e2e.ts` den „Eigenschaften"-Dialog von #42 (alle Felder einer
Entitätsart, Chips/Referenzen/Select, Leeren löscht den Schlüssel, und der
deterministische 409, weil der Dialog sein Wächter-Token beim Öffnen
einfriert). Der
Dialog berührt zusätzlich Pfad 2 (die Leseansicht zeigt die neuen Werte sofort)
und Pfad 8 (Formular bei 390px) — beides steht in demselben Spec.

Auf den Pfaden 2 und 7 liegt zusätzlich `rename.e2e.ts` (#30, erweitert um die
Usage-Vorschau aus #60): „Umbenennen" in der Leseansicht, die zweistufige
Bestätigung („Vorschau" ist ein `dryRun` und schreibt nichts), die deutsche
Usage-Zusammenfassung („2 Verwendungen: 1 Szene, 1 Beziehung" — die eigene
ausgehende Beziehungszeile ist keine Referenz AUF die id) und danach die
Kaskade selbst — Szenen-`npcs:`, die `## Beziehungen`-Gegenzeile, der Umzug der
Leseansicht, und `GET /usage` auf der neuen id gegen 404 auf der alten.

Auf Pfad 9 teilen sich zwei Specs die zwei Oberflächen von „Bearbeiten", die
sich seit #43 EINEN Entwurf teilen: `block-composer.e2e.ts` deckt den
Block-Composer ab — Standardmodus, eine Karte pro Block, Anlegen/Verschieben,
Kinder eines `## If:`-Abschnitts, unbekannte Konstrukte als Roh-Block, die
Save-Sperre bei einem `##` in einem If-Kind (Hinweis an der Karte, „Speichern"
aus, Datei unverändert), der 409 mit offenem Blockformular und die Bedienung
bei 390px. `file-edit.e2e.ts` deckt
den „Roh"-Fallback ab: die Textarea aus #39, ihre „Vorschau" (die es nur dort
gibt), die Kinds mit und ohne Editor und die Verlustpfade (Navigation,
fehlgeschlagener Refetch, Status-Regler daneben). Jeder Test dort betritt den
Editor über `openRawEditor` — erst „Bearbeiten", dann der Umschalter „Roh" —,
weil „Bearbeiten" allein seit #43 im Composer landet.

Beide lesen nach jedem Speichern die Datei über die API zurück, und der
Composer parst und serialisiert den Textkörper: „kein Byte Diff außer dem bearbeiteten Block" ist
darum die eigentliche Zusicherung, nicht ein `toContain` auf dem neuen Satz.

Deutsche UI-Strings in Zusicherungen kommen aus den Komponenten, nicht aus dem
Gedächtnis: bei einer Textänderung in der App wandert der Spec mit.

Ein Spec deckt auch spätere Scheiben auf seinem Pfad ab, nicht nur die Scheibe,
die ihn angelegt hat: `tests/pool.e2e.ts` prüft zusätzlich Gruppenkopf-Namen,
die Topbar-Navigation und den Kampagnen-Metadaten-Dialog (#34),
`tests/review-harvest.e2e.ts` den Szenentitel im Quellchip, und
`tests/search.e2e.ts` die Frische-Zusicherung des Cutovers (#57 AK5): was die
APP gerade geschrieben hat, findet ⌘K sofort — der Index wandert in derselben
Transaktion mit, es gibt keinen Watcher mehr, auf den zu warten wäre.
