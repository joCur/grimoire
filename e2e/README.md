# e2e — die kritischen Pfade gegen den echten Stack

Playwright-Suite für die zehn kritischen Pfade aus `CLAUDE.md`. Gebaute App,
echter Server-Prozess auf einer eigenen SQLite-Datenbank, echter Browser.
Nichts im Browser ist gemockt — die einzige Attrappe ist das LLM: ein lokaler,
OpenAI-kompatibler Stub (`fixtures/stub-llm.ts`), den der Server über den
normalen `OpenAICompatProvider` per HTTP aufruft.

## So sät die Suite

- **Gesät wird über den echten Importer — `grimoire seed`.** Jeder Test
  bekommt ein leeres `GRIMOIRE_DATA`-Verzeichnis; die `server`-Fixture ruft
  darauf `grimoire seed <baum>` mit der pristinen Kopie von
  `examples/beispiel` auf und startet DANN den Server (der Boot selbst
  importiert nichts). Derselbe Importer, kein zweites Fixture-Format
  (PO-Entscheidung F5).
- **Der Markdown-Baum ist EINGABE**, einmal pro Test gelesen. Ein Test, der
  Inhalte braucht, die die Beispielkampagne nicht hat, sät sie VOR dem Seed
  in seine eigene Kopie des Baums:
  `test.use({ seed: { files: { "locations/hafen": "…" }, remove: ["_campaign"] } })`.
  Die Schlüssel sind **Adressen** wie überall in der Suite — das `.md` für
  den Importer hängt die Fixture selbst an (ein Schlüssel, der es schon
  trägt, wird ebenso akzeptiert). Ohne Seed wird die geteilte pristine Kopie
  direkt benutzt (niemand schreibt hinein), die meisten Tests kopieren also
  gar nichts.
- **Eine leere Instanz** — keine Kampagne, der Normalfall einer frischen
  Installation — schaltet den Seed-Lauf ab: `test.use({ seed: { skip: true } })`
  (Pfad 10, Issue #56).
- **Zusicherungen laufen über die API** (`api`-Helfer, s. u.); wo eine
  Zusicherung wirklich die Speicherung meint, über `db`.
- **Adressen tragen keine Dateiendung** und ein Szenen-Segment ist die `id`.
- **Das Wächter-Token heißt `rev`** (die Zeilenversion) und die Felder eines
  Dokuments `properties`. Ein veraltetes `rev` antwortet mit 409.
- **Konflikte kommen vom ZWEITEN SCHREIBER**, nicht von außen: kritischer
  Pfad 9 schreibt über die API (`api.writeBody`), während der Editor offen
  steht, danach speichert die UI — und muss den Konflikt zeigen und neu laden
  statt still zu überschreiben. Genauso in `status-control`,
  `properties-form` und `block-composer`.

## Gruppe = Ort

Die **Gruppe** einer Szene ist ihr `location` (#100), es gibt kein eigenes
Gruppenfeld. Für die Suite heißt das drei Dinge:

- **Die Adressen der Beispielszenen folgen ihrem Ort, nicht dem Baum.** Beide
  Quelldateien liegen im Verzeichnis `hafen/`, nennen aber verschiedene Orte,
  also lauten die Adressen `01-salzhafen/leuchtturm/lighthouse-arrival` und
  `01-salzhafen/bucht/smuggler-captured`. `hafen` ist keine Gruppe und kommt
  in keiner Zusicherung vor. `locations/bucht` gibt es im Baum nicht — der
  Import legt den Eintrag an, weil eine Szene ihn nennt („Referenzieren legt
  an", #70), die Kampagne hat also **zwei** Orte.
- **Eine veraltete Szenen-Adresse ist kein 404.** Sie nennt dieselbe id, der
  Server löst sie auf und antwortet mit der aktuellen Adresse (`path`); die
  App ersetzt die URL (ADR #17). `api.exists(<alte Adresse>)` ist deshalb
  `true` — wer prüfen will, WO eine Szene liegt, fragt
  `(await api.file(rel)).path`.
- **Der Generator vergibt keine Pfade.** Der Prüfschritt adressiert eine
  Szene als `<kapitel>/<id>` (`DRAFT_PATH` in den Specs), geschrieben wird
  sie unter `<kapitel>/<location>/<id>` (`SCENE_PATH`). Die Fixture-Antwort
  setzt `location: bucht` und schlägt diesen Ort im selben Lauf vor — Pfad 6
  prüft damit genau AK1 des Tickets.

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
  `api.writeBody` / `api.patchProperties`, die sich frisch ein Token holen
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

`fixtures/replies.ts` enthält die Modellantworten als **Objekte**, genau so,
wie das erzwungene Schema sie beschreibt: ein Eintrags-Aufruf antwortet
`{ properties, body, warnings }`, die Gliederung ihr eigenes Format. Ein
String, der kein Objekt ist, reist unverändert — das ist eine Antwort, die ein
Test absichtlich unlesbar geschrieben hat. Der Stub serialisiert das Objekt als
JSON in den Message-Content.

Abgedeckt sind: der Szenen-Entwurf mit NPC- und Ort-Stub, der NPC-Eintrag
und je eine bewusst ungültige Variante. Sie erfüllen die aktuelle
mechanische Validierung aus `server/src/generator.ts`.

Der Stub ist ein OpenAI-kompatibler Endpoint und **ignoriert**
`response_format`. Genau das ist der Wert dieses Pfades: der Lauf muss auch
dort funktionieren, wo das Schema nicht wirklich erzwungen wird — dafür ist
der tolerante Leser im Server (`parseJsonReply`) das Netz.

Keine Antwort enthält eine Adresse: die `id` in `properties` ist alles, was das
Modell über die Adressierung entscheidet. Die inhaltlichen Regeln bleiben
(Szene: `status: draft`, nur bekannte Callouts, `location` ist eine id,
Referenzen existieren oder kommen als Eintrag mit; NPC-Eintrag *mit* Status,
Ort-Eintrag *ohne*; NPC-Lauf: kebab-`id`, kein `chapter`, Quickstats als
`{ key, value }`-Liste mit String-Werten, `## Notizen` leer).

Wenn sich eine Validierungsregel ändert, ist diese Datei die Stelle, die
mitwandert. Die Specs behaupten die dort definierten Titel und ids.

Welche Antwort kommt, entscheidet ausschließlich der Prompt — der Stub hält
keinen Zustand und kann mehrere Worker parallel bedienen:

- ein Abschnitt „## Bestehender Eintrag" im Prompt → **Ergänzungs-Lauf**
  (Issue #36). Die Antwort spiegelt den Eintrag zurück und hängt etwas an:
  bei einem LEEREN NPC (den #70 beim Referenzieren angelegt hat) werden
  `role`/`voice` gefüllt und ein Körper geschrieben, bei allem anderen kommt
  genau ein neuer `## If:`-Abschnitt dazu — jeder bestehende Block
  unverändert. Diese Verzweigung wird ZUERST geprüft: ein Szenen-Ergänzungs-
  Lauf trägt auch eine `chapter:`-Zeile.
- der System-Prompt ist der **Gliederungs-Prompt** („System-Prompt:
  Gliederung") → der Gliederungs-Aufruf eines Szenen-Laufs (#102). Die Antwort
  ist die Szenenliste; jede Szene zitiert den ersten und letzten Satz des
  Quelltextes **wörtlich**, damit der Ausschnitt-Schnitt des Servers wirklich
  greift (eine Fehlzuordnung wäre eine Warnung in jedem Spec).
- der Prompt trägt eine **„## Gliederung des Durchlaufs"** und eine
  `chapter:`-Zeile → ein **Szenen-Teil**; welche Szene, sagt die Markierung
  „← DIESE Szene" im Gliederungsblock
- der Prompt trägt die Gliederung, aber kein `chapter` → ein **Eintrags-Teil**
  (NPC oder Ort, je nach System-Prompt)
- kein `chapter` und keine Gliederung → NPC-Lauf (ein Aufruf),
  `vorgegebene id: <id>` fixiert den Dateinamen
- `E2E_SLOW` im Quelltext → der Stub antwortet **nie** (die Verbindung stirbt
  mit dem Server-Prozess, der gefragt hat). Das ist die einzige Möglichkeit,
  einen Job anzusehen, während er wirklich `running` ist — der Neustart-Fall
  aus #23.
- `E2E_INVALID` im Quelltext → Antwort, die die Validierung reißt (auch im
  Korrektur-Turn, der Lauf endet also in einem 422)
- `E2E_TRUNCATED` im Quelltext → `finish_reason: "length"`
- `E2E_THREE_SCENES` im Quelltext → die Gliederung hat **drei** Szenen und
  keine Vorschläge — die Form, in der man Teile einzeln fertig werden,
  fehlschlagen und wiederholen sehen kann (#102)
- `E2E_PART_FAIL:<nonce>` → die **mittlere** der drei Szenen reißt ihre ganze
  erste Runde (Erstaufruf **und** Korrektur-Turn) und gelingt ab der zweiten.
  Erst das macht den Teil wirklich `failed` — ein Fehler, den der Korrektur-
  Turn heilt, ist kein fehlgeschlagener Teil —, und genau das repariert dann
  „Erneut versuchen". Der Rundenzähler ist der **einzige** Zustand des Stubs
  und hängt an der `nonce`, die der Spec schreibt: so können parallele Worker
  sich den Fehlschlag nicht gegenseitig wegnehmen.
- `E2E_ASCII_QUOTES` → der Szenen-Körper trägt deutsche Anführungszeichen mit
  dem **ASCII-Zeichen `"`** als Schlusszeichen. Eine Antwort, die das Modell
  selbst einpacken musste, bezahlte dieses `"` mit einer Korrekturrunde; als
  `body` eines erzwungenen Objekts ist es Text, der Lauf muss also ohne eine
  einzige Korrekturrunde `done` erreichen (zwei Aufrufe: Gliederung + eine
  Szene).
- `E2E_HOLD_LAST` → nur die **letzte** Szene wird gehalten, die anderen
  antworten normal. Das ist die Lage, die ein Neustart mitten im Lauf braucht:
  fertige Teile zum Behalten und einen in Flug. (Der Name beginnt bewusst
  nicht mit `E2E_SLOW` — das wird als Teilstring geprüft und würde jeden
  Aufruf halten.)

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
| 1 Auto-Einstieg    | `tests/pool.e2e.ts` (Gruppen = Ortsnamen, „Ohne Ort")          |
| 2 Szene lesen      | `tests/scene-rendering.e2e.ts`, `tests/rename.e2e.ts`          |
| 3 ⌘K-Suche         | `tests/search.e2e.ts`                                          |
| 4 Session-Zyklus   | `tests/session-cycle.e2e.ts`                                   |
| 5 Nachbereitung    | `tests/review.e2e.ts`                                         |
| 6 Generator        | `tests/generator.e2e.ts`, `tests/generator-pipeline.e2e.ts`, `tests/generator-restart.e2e.ts`, `tests/augment.e2e.ts` |
| 7 Eigenschaften/409 | `tests/status-control.e2e.ts`, `tests/properties-form.e2e.ts`, `tests/rename.e2e.ts` |
| 8 Mobil            | `tests/mobile.e2e.ts`                                          |
| 9 Eintrag bearbeiten | `tests/block-composer.e2e.ts`, `tests/entry-edit.e2e.ts`        |
| 10 Kaltstart       | `tests/cold-start.e2e.ts`                                       |

`tests/generator-restart.e2e.ts` ist die Neustart-Hälfte von Pfad 6 (#23) und
braucht darum, wie der Seed-Spec unten, zwei Server hintereinander auf
DEMSELBEN Datenverzeichnis: der erste startet einen Lauf bzw. bringt ihn zu
Ende, der zweite ist der Neustart. Ein **fertiger** Job ist danach vollständig
da (Ergebnis, Review-Edits) und wird übernommen; ein **laufender** steht als
`failed` mit „Server wurde während des Laufs neu gestartet — Job neu starten"
statt als endloser Spinner.

`tests/generator-pipeline.e2e.ts` ist die **Pipeline-Hälfte** von Pfad 6
(#102): ein Lauf mit drei Szenen, von denen eine fehlschlägt — die anderen
zwei sind prüfbar und einzeln übernehmbar, während der defekte Teil seinen
Fehlertext und sein eigenes „Erneut versuchen" trägt; danach sind alle drei da
und „Rest übernehmen" räumt den Lauf ab. Dazu „Verwerfen" mitten im Lauf und
ein Neustart mitten im Lauf (zwei Server hintereinander, wie oben): fertige
Teile bleiben, der Teil in Flug wird `failed` und ist auf dem neuen Prozess
wieder startbar, weil die Gliederung mit der Zeile zurückkommt. Die Gliederung
selbst kommt in keiner Zusicherung vor — sie wird dem Nutzer nie gezeigt.

Seit Issue #97 deckt `tests/generator.e2e.ts` zusätzlich den **Prüfzustand**
ab: Entwurf bearbeiten → Seite verlassen → zurück → der Text ist da; einen
vorgeschlagenen Eintrag entscheiden → Reload → die Entscheidung steht; eine
Szene einzeln übernehmen („Diesen übernehmen") → der Rest bleibt prüfbar und
die Fortschrittszeile sagt „1 von 3 übernommen" → „Rest übernehmen" schreibt
den Rest und der Job ist weg. Ein zweiter Spec zeigt die Lead-Entscheidung
dazu: „Rest verwerfen" nimmt nur den offenen Rest mit, das einzeln Übernommene
bleibt als Eintrag stehen. `tests/augment.e2e.ts` prüft dieselbe Persistenz
auf Block-Ebene — eine Block-Entscheidung überlebt den Reload.

`tests/augment.e2e.ts` ist die Ergänzungs-Hälfte von Pfad 6 („Mit KI
ergänzen", Issue #36): derselbe Lauf auf einen Eintrag, den es schon gibt.
Der Spec belegt AK5 — leerer #70-NPC → ergänzen → Löcher gefüllt, während
`name` und `status` (beide gefüllt) per Default NICHT ersetzt werden;
vorbereitete Szene → ein neuer Handlungsstrang als zusätzlicher Block,
jeder bestehende Block Zeichen für Zeichen gleich, `status: ready` bleibt;
Vorschlag verwerfen schreibt nichts und nimmt den Job mit; und der
409-Pfad (zweiter Schreiber während das Review offen steht) schreibt nichts
und erholt sich beim nächsten Versuch. Er berührt zusätzlich Pfad 2 (die
Leseansicht zeigt das Ergebnis sofort) und Pfad 8 — die Aktion ist
Desktop-only, die Leseansichten beider Arten müssen bei 390px weiter
rendern.

Dazu ein Spec, der auf keinem der zehn Pfade liegt, sondern auf der Naht
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
`properties-form.e2e.ts` den „Eigenschaften"-Dialog von #42 (alle Felder einer
Entitätsart, Chips/Referenzen/Select, Leeren löscht den Schlüssel, und der
deterministische 409, weil der Dialog sein Wächter-Token beim Öffnen
einfriert). Der
Dialog berührt zusätzlich Pfad 2 (die Leseansicht zeigt die neuen Werte sofort)
und Pfad 8 (Formular bei 390px) — beides steht in demselben Spec. Seit
Issue #100 prüft `properties-form.e2e.ts` dort auch den UMZUG: `location`
ändern verschiebt die Szene, die URL wird ersetzt, die Kapitelübersicht
sortiert um, die alte Adresse zeigt weiter auf dieselbe Szene und das
Session-Log bleibt gültig (es referenziert über ids). Freitext in `location`
ist dort ein 400 mit `code: "location_not_an_id"` — die Gegenprobe steht in
`scene-rendering.e2e.ts`.

Auf den Pfaden 2 und 7 liegt zusätzlich `rename.e2e.ts` (#30, erweitert um die
Usage-Vorschau aus #60, Einstieg seit #77 über „id ändern" im Fußbereich des
Eigenschaften-Dialogs — der Header-Knopf ist weg): die zweistufige
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
bei 390px. `entry-edit.e2e.ts` deckt
den „Markdown"-Fallback ab: die Textarea aus #39, ihre „Vorschau" (die es nur dort
gibt), die Kinds mit und ohne Editor und die Verlustpfade (Navigation,
fehlgeschlagener Refetch, Status-Regler daneben). Jeder Test dort betritt den
Editor über `openMarkdownEditor` — erst „Bearbeiten", dann der Umschalter „Markdown" —,
weil „Bearbeiten" allein seit #43 im Composer landet. Ein Test dort deckt
zusätzlich Issue #100 ab: eine Szene, deren `location` sich geändert hat,
wird über ihre ALTE Adresse geöffnet, bearbeitet und gespeichert — der
Editor arbeitet nur am Körper, also ist der Umzug selbst Pfad 7, aber ein
Speichern über eine veraltete Adresse darf nicht ins Leere laufen.

Pfad 10 (`cold-start.e2e.ts`, #56) ist der einzige Pfad, der OHNE Seed läuft:
`test.use({ seed: { skip: true } })` startet den Server auf einem leeren
Datenverzeichnis, der Importer läuft nie — genau das, was eine frische
Installation seit #79 ist. Der Spec legt darum alles selbst an (Kampagne →
Kapitel → Szene → Text → Session) und baut seinen `api`-Helfer mit
`apiFor(server.url, id)`, weil die Kampagnen-id erst zur Laufzeit existiert.
Dazu die beiden Listen-Einstiege („NPC/Ort anlegen") mit der
Slug-Kollision — 409 mit Vorschlag, nichts geschrieben, der Vorschlag als ein
Klick — und dieselben Listen bei 390px, womit der Spec auch auf Pfad 8 liegt.

Beide lesen nach jedem Speichern die Datei über die API zurück, und der
Composer parst und serialisiert den Textkörper: „kein Byte Diff außer dem bearbeiteten Block" ist
darum die eigentliche Zusicherung, nicht ein `toContain` auf dem neuen Satz.

Deutsche UI-Strings in Zusicherungen kommen aus den Komponenten, nicht aus dem
Gedächtnis: bei einer Textänderung in der App wandert der Spec mit.

Ein Spec deckt auch spätere Scheiben auf seinem Pfad ab, nicht nur die Scheibe,
die ihn angelegt hat: `tests/pool.e2e.ts` prüft zusätzlich Gruppenkopf-Namen,
die Topbar-Navigation und den Kampagnen-Metadaten-Dialog (#34),
`tests/review.e2e.ts` den Szenentitel im Quellchip, und
`tests/search.e2e.ts` die Frische-Zusicherung des Cutovers (#57 AK5): was die
APP gerade geschrieben hat, findet ⌘K sofort — der Index wandert in derselben
Transaktion mit, es gibt keinen Watcher mehr, auf den zu warten wäre.
