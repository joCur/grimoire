# e2e — die kritischen Pfade gegen den echten Stack

Playwright-Suite für die zehn kritischen Pfade aus `CLAUDE.md`. Gebaute App,
echter Server-Prozess auf einer eigenen SQLite-Datenbank, echter Browser.
Nichts im Browser ist gemockt — die einzige Attrappe ist das LLM: ein lokaler,
OpenAI-kompatibler Stub (`fixtures/stub-llm.ts`), den der Server über den
normalen `OpenAICompatProvider` per HTTP aufruft.

## So sät die Suite

- **Gesät wird über das echte Werkzeug — `grimoire seed`.** Jeder Test
  bekommt ein leeres `GRIMOIRE_DATA`-Verzeichnis; die `server`-Fixture ruft
  darauf `grimoire seed <fixtures-verzeichnis>` mit der pristinen Kopie von
  `fixtures/beispiel` auf und startet DANN den Server (der Boot selbst lädt
  nichts).
- **Die Fixtures sind EINGABE**, einmal pro Test gelesen. `fixtures/beispiel`
  hält die Beispielkampagne als **ein JSON pro Objekt**, genau in der Form,
  die die API spricht. Die Kampagne, ein Kapitel, eine Szene, ein NPC, ein
  Ort, ein Faden, eine Idee, ein Glossar-Begriff, ein Stück
  Kampagnenwissen und eine Session sind je eine eigene Ressource (ADR #31)
  und liegen als `campaigns/<id>.json`, `chapters/<id>.json`,
  `scenes/<id>.json`, `npcs/<id>.json`, `locations/<id>.json`,
  `threads/<id>.json`, `ideas/<id>.json`, `glossary-terms/<id>.json`,
  `knowledge-items/<id>.json` bzw. `sessions/<id>.json`: die Entität selbst,
  alle Felder flach, ohne `kind` und ohne `rev`. Eine Session bettet ihre
  Kinder ein — `pauses`, `log` und `playedScenes`, jede Zeile mit ihrer
  eigenen `id`.
- **Ein Test überschreibt die Beispielkampagne je Entität**, in seiner
  eigenen Kopie des Verzeichnisses:
  `test.use({ seed: { scenes: [{ id: "loot-check", … }], without: { sessions: ["2026-01-15"] } } })`.
  `campaign`, `chapters`, `scenes`, `npcs` und `locations` tragen den Typ
  der Entität aus `@grimoire/shared/<entität>` (`CampaignSeed`,
  `ChapterProposal`, `SceneProposal`, `NpcProposal`, `LocationProposal` —
  die Entität ohne `rev`), `sessions` die Session ohne ihre Wächter
  (`SessionSeed` aus `@grimoire/shared/session`). Ein Objekt, dessen `id` die
  Beispielkampagne schon hat, ERSETZT es, jedes andere kommt dazu;
  `without` lässt Objekte je Entität über ihre `id` weg. Ohne Überschreibung
  wird die geteilte pristine Kopie direkt benutzt (niemand schreibt hinein),
  die meisten Tests kopieren also gar nichts.
- **Eine Referenz zeigt auf etwas, das existiert.** Eine Szene, die einen
  Ort oder NPC nennt, den es nicht gibt, lässt den Seed-Lauf
  scheitern (ADR #19) — das ist ein Fehler im Fixture, keine Degradierung.
- **Eine leere Instanz** — keine Kampagne, der Normalfall einer frischen
  Installation — schaltet den Seed-Lauf ab: `test.use({ seed: { skip: true } })`
  (Pfad 10).
- **Zusicherungen laufen über die API** (`api` und die Helfer je Entität,
  s. u.); wo eine
  Zusicherung wirklich die Speicherung meint, über `db`.
- **Jede Entität antwortet unter ihrer eigenen Ressource**: die Kampagne
  unter `/campaigns/<id>` (`getCampaign(api)`), ein Kapitel unter
  `…/chapters/<id>` (`getChapter(api, id)`), eine Szene unter `…/scenes/<id>`
  (`getScene(api, id)`). Einen allgemeinen Endpunkt gibt es nicht: jede frühere
  Adresse unter `…/entries/*` ist ein 404.
- **Das Wächter-Token heißt `rev`** (die Zeilenversion). Ein veraltetes `rev`
  antwortet mit 409 `rev_conflict` und trägt den aktuellen Stand unter dem
  Namen der Entität mit — `campaign`, `chapter`, `scene`, `npc`, `location`.
- **Eine vorgeschlagene Szene des Generators ist die Szene ohne `rev`**
  (ADR #31) — auf der Leitung `result.scenes`, jede mit ihrer `id`, alle
  Felder flach. Änderungen des Prüfschritts reisen **je Szene und je Feld**:
  `sceneEdits: { "<id>": { title?, …, body? } }` im `PATCH` des Jobs und am
  Job; ein genanntes Feld ersetzt den Wert des Modells, `null` leert
  `trigger`/`location`, jedes andere Feld bleibt das des Modells. Verworfen
  und geschrieben wird je `id` (`droppedScenes`, `writtenScenes`): das
  Übernehmen ist derselbe `PATCH` mit `review.writtenScenes`,
  `writtenNpcs` bzw. `writtenLocations` — die ids, die geschrieben werden.
- **Der Generator-Job ist eine eigene Ressource** (ADR #31):
  `…/generator-jobs` ist die Liste mit dem einen Job der Kampagne oder
  keinem (`readGeneratorJob(api)`), `POST` startet einen Lauf und antwortet
  202 mit dem Job selbst, `PATCH …/generator-jobs/<id> { rev, … }` prüft und
  übernimmt, `PATCH …/parts/<key> { status: "running" }` startet einen
  fehlgeschlagenen Teil neu, `DELETE …/generator-jobs/<id> { rev }` verwirft.
  Die Helfer liegen in `support/generator-job.ts`. Die früheren Adressen
  `…/generate`, `…/generate/job` und `…/generate/apply` sind ein 404.
- **Eine Szene hat EINEN Schreibweg**: `PATCH …/scenes/<id>` mit
  `{ rev, force?, …Teilmenge der Felder }` (`patchScene`). Felder und
  Text zusammen sind **ein** Schreibvorgang gegen **einen** `rev` — ein
  Schritt der Zeilenversion, egal wie viel die Anfrage trug. Ein Feld, das
  eine Szene nicht hat, ist eine 400, die es nennt. Kampagne und Kapitel
  schreiben genauso über ihre Ressource (`patchCampaign`,
  `patchChapter`). Ein Kapitel wird aktiv, indem sein `status` auf
  `active` geht — der Server setzt das bisher aktive im selben Vorgang auf
  `planned`.
- **Konflikte kommen vom ZWEITEN SCHREIBER**, nicht von außen: kritischer
  Pfad 9 schreibt über die API (`patchScene`, `patchChapter`,
  `patchCampaign`), während der
  Editor offen steht, danach speichert die UI — und muss die Konfliktzeile
  mit ihren zwei Aktionen zeigen statt still zu überschreiben. Genauso in
  `status-control`, `properties-form` und `block-composer`.
- **Weil alle Felder einer Szene eine Zeile teilen, ist ein reiner
  Status-Write auch für einen offenen Texteditor ein Konflikt.** Es gibt
  keine „textneutrale" Änderung, die eine Oberfläche still übernimmt.
- **Die Konfliktzeile ist geteilt** (`EditConflict`) und das **einzige**
  `role="alert"` der App — Specs greifen sie darum über die Rolle, nicht über
  ihren Text: die Meldung des Status-Reglers beginnt mit denselben Worten.
  Ihre zwei Aktionen sind „Neu laden" (Entwurf verwerfen, gespeicherten Stand
  übernehmen) und „Trotzdem speichern" (`force`, schreibt nur die
  mitgeschickten Felder). Der Übernehmen-Schritt des Generators kann nicht
  erzwingen und zeigt darum nur „Neu laden".
  Achtung: „Trotzdem speichern" enthält „Speichern" — wer den Speicher-Knopf
  einer Oberfläche meint, schreibt `{ name: "Speichern", exact: true }`.
- **Nach „Neu laden" startet der Entwurf des Text-Editors wieder auf der
  Standard-Oberfläche** (Block-Composer). Ein Spec, der danach die Textarea
  liest, schaltet erneut auf „Markdown" um, ohne den Bearbeiten-Modus zu
  verlassen.

## Szene = eigene Ressource, Reihenfolge = eigene Liste

Eine Szene ist ihre eigene Ressource (ADR #31): sie liegt flach unter ihrer
Kampagne, ihr Kapitel und ihr Ort sind Felder, und die App liest sie unter
`/campaigns/:c/scenes/<id>`. Die Kapitelübersicht ist eine durchgehende
Liste in der Reihenfolge, die der DM setzt (ADR #27), und der Ort steht mit
seinem Namen in der Metazeile der Zeile. Für die Suite heißt das vier Dinge:

- **Eine Szene wird über ihre `id` angesprochen**, egal wo sie liegt:
  `getScene(api, "lighthouse-arrival")`, `sceneExists(api, id)`,
  `scenePath(api, id?)` für rohe Aufrufe. Beide Orte der Beispielkampagne
  gibt es als eigene Ressource (`…/locations/leuchtturm`, `…/locations/bucht`;
  `getLocation(api, id)`) — eine Referenz legt nichts an (ADR #19) —, die
  Kampagne hat also **zwei** Orte. Frühere Adressen wie
  `…/entries/<kapitel>/…/<id>`, `…/entries/npcs/<id>` und
  `…/entries/locations/<id>` sind ein 404.
- **Ein neuer Ort oder ein neues Kapitel ändert kein Feld der Route.** Die
  Szene bleibt unter `…/scenes/<id>`; wechselt sie das Kapitel, steht sie am
  Ende des Zielkapitels (Pfad 10, `cold-start`).
- **Der Generator benennt eine Szene mit ihrem Ressourcen-Segment**: der
  Prüfschritt und die Liste des Geschriebenen zeigen `scenes/<id>`, und eine
  geschriebene Szene verlinkt auf `/campaigns/:c/scenes/<id>`. Die
  Fixture-Antwort setzt `location: raeucherkammer` und schlägt diesen Ort im
  selben Lauf vor — genau das prüft Pfad 6.
- **Die Reihenfolge ist gesetzt, nicht abgeleitet.** Der Seed-Lauf hängt jede
  Szene ans Ende ihres Kapitels, in der Reihenfolge, in der er `scenes/`
  liest — alphabetisch nach der `id`; ein Spec, dessen Zusicherung von der
  Reihenfolge abhängt, wählt seine ids danach oder sagt die gemeinte
  Reihenfolge selbst an —
  `PUT …/chapters/<kapitel>/scene-order` mit `{ scenes, rev }`, wobei `rev`
  der `sceneOrderRev` des `ChapterNode` ist. Dieser Wächter zählt nur die
  Writes dieser Liste: ein Umsortieren bewegt weder `scenes.rev` noch
  `chapters.rev` und ist deshalb für keinen offenen Editor ein Konflikt — und
  umgekehrt bewegt der `PATCH` einer Szene `scene_order_rev` nicht.
  Adressiert werden die Zeilen über ihre Hoch/Runter-Schalter, die den Titel
  im zugänglichen Namen tragen (`„<Titel>“ nach oben`).

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
support/global-setup.ts  baut die App, legt die pristine Kopie von
                         fixtures/beispiel an, startet den Stub
support/test.ts          das `test` der Suite: eigene Datenbank + eigener
                         Server + `baseURL` pro Test, plus die Fixtures
                         `api`, `db` und `seed`
support/api.ts           `Api`: der Zugang zum Server eines Tests, an eine
                         Kampagne gebunden, ohne Wissen über Entitäten
support/campaign.ts, chapter.ts, scene.ts, npc.ts, location.ts,
support/thread.ts, idea.ts, glossary-term.ts, knowledge-item.ts
                         die Helfer je Entität: lesen, prüfen, schreiben,
                         Pfade — getippt mit `@grimoire/shared/<entität>`
support/session.ts       die Helfer der Sessions
support/procs.ts         verwaltete Kindprozesse (Start, Warten, Stoppen)
fixtures/stub-llm.ts     standalone LLM-Stub (auch einzeln startbar)
fixtures/replies.ts      die kanonischen Modellantworten
fixtures/*.json          Szenen, die einzelne Specs dazusäen
tests/*.e2e.ts           ein Spec pro kritischem Pfad (Zuordnung unten)
```

**Isolation:** Jeder Test bekommt seine eigene Datenbank *und* seinen eigenen
Server-Prozess auf eigenem Port (Bereich ab 3200, pro Worker getrennt).
Zusicherungen sehen damit genau die Zeilen, die dieser Test geschrieben hat —
inklusive des Generator-Jobs, der selbst eine Zeile ist.
`fixtures/` wird nur kopiert, nie verändert. Seed plus Boot kosten ~0,2 s.

**Die zwei Zusicherungs-Helfer:**

- `api` — der Zugang zum Server dieses Tests (`support/api.ts`), an die
  Beispielkampagne gebunden: `api.get`/`api.send` für jeden Endpunkt und
  `api.fetch` für Statuscodes. `api` weiß nichts über Entitäten; ein Spec,
  der eine eigene Kampagne anlegt, baut sich seinen mit
  `apiFor(server.url, id)`.

  Was die Suite über eine Entität weiß, steht im **Modul der Entität** unter
  `support/`, als Funktionen, die `api` als erstes Argument nehmen. Die
  **Kampagne**, ein **Kapitel**, eine **Szene**, ein **NPC** und ein **Ort**
  sind je eine eigene Ressource (ADR #31) und antworten mit ihrem Typ aus
  `@grimoire/shared/<entität>` (alle Felder flach, `body`, `rev`):
  `getCampaign(api)`, `getChapter(api, id)`, `getScene(api, id)`,
  `getNpc(api, id)` bzw. `getLocation(api, id)`, dazu
  `chapterExists`/`sceneExists`/`npcExists`/`locationExists(api, id)`,
  `campaignPath(api)`/`chapterPath(api, id?)`/`scenePath(api, id?)`/
  `npcPath(api, id?)`/`locationPath(api, id?)` für rohe Aufrufe und der
  Schreibweg `patchCampaign(api, …)`/`patchChapter(api, id, …)`/
  `patchScene(api, id, …)`/`patchNpc(api, id, …)`/
  `patchLocation(api, id, { rev?, force?, …Felder })` — ohne `rev` holt er
  sich frisch ein Token und spielt damit den „zweiten Schreiber" — und
  `createNpc(api, { name, id?, body? })`, das `POST …/npcs`.

  Faden und Idee haben ihre eigenen Module: `getThreads(api, kapitel)`,
  `getThread(api, id)`, `createThread(api, { chapter, text })`,
  `patchThread(api, id, { rev?, …Felder })` und `threadPath(api, id?)`
  (`support/thread.ts`), `getIdeas(api)` und `ideaPath(api, id?)`
  (`support/idea.ts`). Die **Sessions** haben ihr eigenes Modul:
  `getRunningSession(api)` und `runningSessionId(api)` (die laufende aus
  `GET …/sessions?running=true` — `undefined`, wenn nichts läuft; der Filter
  antwortet dafür eine leere Liste), `getLastStartedSession(api)` (die erste
  der Liste), `getSession(api, id)`, `sessionExists(api, id)`,
  `listSessions(api)` und die Pfade `sessionPath(api, id?)`,
  `pausePath(api, session, id?)`, `logEntryPath(api, session, id?)` und
  `playedScenesPath(api, session)` für rohe Aufrufe (`support/session.ts`).
  Jede Behauptung über eine Session, eine Idee oder einen Faden liest ein
  **Feld** — `log`, `pauses`, `playedScenes`, `done` —, nie einen
  gerenderten Text. Eine Session-id, die die App vergibt, ist ein opaker Zufallsstring:
  kein Spec schreibt eine hin, sie kommt immer vom Server.
  `todaySessionId()` ist die datumsförmige id einer Session, die ein Spec
  **selbst seedet**.
- `db` — liest `grimoire.db` dieses Tests über den Treiber des Servers
  (`server/src/db/driver.ts`, keine zweite SQLite-Abhängigkeit). Nur für
  Behauptungen, die die API nicht machen kann — etwa Zeilenzahlen
  (`tests/seed.e2e.ts`).

Jede Schreibaktion der UI wird weiter doppelt geprüft: in der Oberfläche und
über die API.

Spec-Dateien heißen `*.e2e.ts`, damit `bun test` im Repo-Root sie nicht
einsammelt (Bun matcht `*.test.ts` und `*.spec.ts`).

## Stub-Fixtures anpassen

`fixtures/replies.ts` enthält die Modellantworten als **Objekte**, genau so,
wie das erzwungene Schema sie beschreibt: ein Szenen-Aufruf antwortet mit
allen Feldern der Szene (`body` eines davon, `trigger`/`location` ohne Wert
als `null`, die drei Listen immer da) neben `warnings`; ein NPC-Aufruf mit
allen Feldern des NPC
(`body` eines davon, ein fehlendes Feld als `null`, `quickstats` als Liste
von `{ key, value }`-Paaren mit String-Werten) neben `warnings`; ein
Orts-Aufruf mit allen Feldern des Orts neben `warnings`; die Gliederung ihr
eigenes Format mit den neuen NPCs und den neuen Orten als zwei eigenen
Listen (`npcs`, `locations`). Ein
String, der kein Objekt ist, reist unverändert — das ist eine Antwort, die ein
Test absichtlich unlesbar geschrieben hat. Der Stub serialisiert das Objekt als
JSON in den Message-Content.

Abgedeckt sind: der Szenen-Entwurf mit vorgeschlagenem NPC und Ort, das
Ergänzen einer Szene, eines NPC und eines Orts, der NPC-Lauf und je eine
bewusst ungültige Variante. Sie erfüllen die aktuelle
mechanische Validierung aus `server/src/generator.ts`.

Der Stub ist ein OpenAI-kompatibler Endpoint und **ignoriert**
`response_format`. Genau das ist der Wert dieses Pfades: der Lauf muss auch
dort funktionieren, wo das Schema nicht wirklich erzwungen wird — dafür ist
der tolerante Leser im Server (`parseJsonReply`) das Netz.

Keine Antwort enthält eine Adresse: die `id` ist alles, was das Modell über
die Adressierung entscheidet. Die inhaltlichen Regeln bleiben (Szene:
`status: draft`, nur bekannte Callouts, `location` ist eine id, Referenzen
existieren oder werden im selben Lauf vorgeschlagen; ein NPC *mit* Status,
ein Ort *ohne*; NPC-Lauf: kebab-`id`, kein `chapter`, Quickstats als
`{ key, value }`-Liste mit String-Werten; in jedem Text nennt jedes `[[id]]`
etwas aus der Kampagne oder einen Vorschlag desselben Laufs).

Wenn sich eine Validierungsregel ändert, ist diese Datei die Stelle, die
mitwandert. Die Specs behaupten die dort definierten Titel und ids.

Welche Antwort kommt, entscheidet ausschließlich der Prompt — der Stub hält
keinen Zustand und kann mehrere Worker parallel bedienen:

- ein Abschnitt „## Bestehender Ort" im Prompt → **Ergänzungs-Lauf eines
  Orts**. Der Ort steht dort als JSON-Block mit allen seinen Feldern — genau
  das Objekt, in das die Antwort gezwungen wird. Die Antwort spiegelt jedes
  Feld zurück und hängt genau einen neuen `## If:`-Abschnitt an `body`.
- ein Abschnitt „## Bestehender NPC" im Prompt → **Ergänzungs-Lauf eines
  NPC**. Der NPC steht dort als JSON-Block in seiner Antwortform (alle
  Felder, ein fehlendes als `null`, `quickstats` als Paare) — genau das
  Objekt, in das die Antwort gezwungen wird. Bei einem LEEREN NPC (angelegt
  und nicht gefüllt) werden `role`/`voice`/`motivation` gefüllt, `name` und
  `status` anders vorgeschlagen und ein Text geschrieben; bei einem gefüllten
  spiegelt die Antwort jedes Feld zurück und hängt genau einen neuen
  `## If:`-Abschnitt an `body`.
- ein Abschnitt „## Bestehende Szene" im Prompt → **Ergänzungs-Lauf einer
  Szene**. Die Szene steht dort als JSON-Block in ihrer Antwortform (alle
  Felder, ein fehlendes als `null`) — genau das Objekt, in das die Antwort
  gezwungen wird; der Stub liest sie mit `JSON.parse` und nicht aus einem
  Text. Die Antwort spiegelt jedes Feld zurück und hängt genau einen neuen
  `## If:`-Abschnitt an `body` — jeder bestehende Block unverändert.
  Diese Verzweigungen werden vor den Anlege-Läufen geprüft: ein
  Szenen-Ergänzungs-Lauf trägt auch eine `chapter:`-Zeile.
- der System-Prompt ist der **Gliederungs-Prompt** („System-Prompt:
  Gliederung") → der Gliederungs-Aufruf eines Szenen-Laufs. Die Antwort
  ist die Szenenliste samt den Listen `npcs` und `locations`; jede Szene
  zitiert den ersten und letzten Satz des
  Quelltextes **wörtlich**, damit der Ausschnitt-Schnitt des Servers wirklich
  greift (eine Fehlzuordnung wäre eine Warnung in jedem Spec).
- der Prompt trägt eine **„## Gliederung des Durchlaufs"** und eine
  `chapter:`-Zeile → ein **Szenen-Teil**; welche Szene, sagt die Markierung
  „← DIESE Szene" im Gliederungsblock
- der Prompt trägt die Gliederung, aber kein `chapter` → ein **NPC- oder
  Orts-Teil** (je nach System-Prompt), jeder in seiner eigenen Antwortform
- kein `chapter` und keine Gliederung → NPC-Lauf (ein Aufruf),
  `vorgegebene id: <id>` fixiert die id des NPC
- `E2E_SLOW` im Quelltext → der Stub antwortet **nie** (die Verbindung stirbt
  mit dem Server-Prozess, der gefragt hat). Das ist die einzige Möglichkeit,
  einen Job anzusehen, während er wirklich `running` ist — der Neustart-Fall
  aus der Job-Zeile.
- `E2E_INVALID` im Quelltext → Antwort, die die Validierung reißt (auch im
  Korrektur-Turn, der Lauf endet also in einem 422)
- `E2E_TRUNCATED` im Quelltext → `finish_reason: "length"`
- `E2E_UNKNOWN_REF` im Quelltext → die **erste** Antwort eines NPC- oder
  Ergänzen-Laufs nennt `[[der-fremde]]`, eine id, die es nicht gibt;
  der Korrektur-Turn (der Aufruf mit der vorigen Antwort als
  Assistant-Turn) bekommt die gute Antwort. Der Lauf kostet also genau eine
  Korrekturrunde und endet ohne diesen Verweis.
- `E2E_THREE_SCENES` im Quelltext → die Gliederung hat **drei** Szenen und
  keine Vorschläge — die Form, in der man Teile einzeln fertig werden,
  fehlschlagen und wiederholen sehen kann
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
- `E2E_DESCRIBE_ANYWAY` → die Gliederung beschreibt das Kapitel auch dann,
  wenn der Lauf in ein **bestehendes** geht — ein Modell, das die Regel des
  Prompts übergeht. Sonst trägt die Gliederung eine Beschreibung nur, wenn der
  Kontext die Zeile `neues Kapitel: ja` hat.
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
# (mit Inhalt: vorher GRIMOIRE_DATA=/tmp/grimoire-scratch \
#   bun server/src/cli.ts seed fixtures)
```

## Regel

**Wer einen kritischen Pfad berührt oder einen neuen schafft, erweitert diese
Suite im selben PR — sonst kein Merge** (`CLAUDE.md`, „Kritische Pfade"). Die
Pfade und die Specs stehen zueinander; die Nummer steht außerdem in der
Kopfzeile des jeweiligen Specs (die Spec-Namen tragen sie bewusst nicht — die
Suite hat keine Reihenfolge). Ein Pfad kann mehr als einen Spec haben, wenn
mehrere Schreibwege auf ihm liegen:

| Pfad (CLAUDE.md)   | Spec                                                           |
| ------------------ | -------------------------------------------------------------- |
| 1 Auto-Einstieg    | `tests/chapter-overview.e2e.ts` (eine Liste, Ort in der Metazeile, Reihenfolge samt 409, Status-Regler des Kapitels) |
| 2 Szene lesen      | `tests/scene-rendering.e2e.ts`                                 |
| 3 ⌘K-Suche         | `tests/search.e2e.ts`                                          |
| 4 Session-Zyklus   | `tests/session-cycle.e2e.ts`                                   |
| 5 Nachbereitung    | `tests/review.e2e.ts`, `tests/threads.e2e.ts`                  |
| 6 Generator        | `tests/generator.e2e.ts`, `tests/generator-pipeline.e2e.ts`, `tests/generator-restart.e2e.ts`, `tests/augment.e2e.ts`, `tests/campaign-knowledge.e2e.ts` |
| 7 Eigenschaften/409 | `tests/status-control.e2e.ts`, `tests/properties-form.e2e.ts`, `tests/chapter-overview.e2e.ts` (das aktive Kapitel) |
| 8 Mobil            | `tests/mobile.e2e.ts`                                          |
| 9 Eintrag bearbeiten | `tests/block-composer.e2e.ts`, `tests/entry-edit.e2e.ts`, `tests/chapter-overview.e2e.ts` („Kampagne bearbeiten") |
| 10 Kaltstart       | `tests/cold-start.e2e.ts`                                       |

Die Pfade 3, 4, 5 und 8 lesen Zeilen statt Texte:

- **Pfad 3** (`search.e2e.ts`): indexiert sind Kampagne, Kapitel, Szenen,
  NPCs, Orte und die Glossar-Begriffe. Jeder Treffer trägt `kind` + `id` und
  **kein** `path` — der Spec prüft das auf der Leitung und klickt ihn danach
  in der Palette: der Kampagnen-Treffer öffnet `/campaigns/beispiel`, die
  anderen `/campaigns/beispiel/chapters/<id>`,
  `/campaigns/beispiel/scenes/<id>`, `/campaigns/beispiel/npcs/<id>`,
  `/campaigns/beispiel/locations/<id>` bzw. — ein Glossar-Treffer mit `kind:
  "glossary-term"` und der `id` des Begriffs — `/campaigns/beispiel/glossary`.
  Sessions und Ideen sind nicht indexiert; ein eigener Test fragt nach Wörtern, die nur dort vorkommen, und
  erwartet keinen Treffer.
- **Pfad 4** (`session-cycle.e2e.ts`): die Schnellnotiz wird eine Log-**Zeile**
  mit `id`, `at`, `sceneId`, dem Text, wie der DM ihn getippt hat, und ihrem
  `rev` — und legt keine gespielte Szene an. „Nächste Szene" legt die
  **verlassene** Szene als gespielt an, wenn die Session eine Notiz in ihr
  hat, einmal je Session; ohne Notiz legt es nichts an, und das Beenden legt
  die offene Szene nicht an. Eine **Pause ist ein Intervall** in `pauses`
  und schreibt keine Log-Zeile — der Beweis ist die unveränderte Länge des
  Logs plus der Chip-Zustand `paused`. Ein eigener Test prüft die
  Ressourcen selbst: `?running=true` als Liste von einer oder keiner, die
  Liste neueste zuerst, die Session flach mit eingebetteten Kindern, deren
  Schreibzugriffe ihr `rev` nicht bewegen, 409 bei altem `rev` einer Pause
  und der Session, 409 `session_ended` für jedes neue Kind einer beendeten
  Session, `session_not_empty` beim Verwerfen, und 404 auf `…/session`,
  `…/session/start` und `…/log`. Eine Notiz in eine anderswo beendete
  Session zeigt den Satz dazu und lässt den Text im Feld; der fremde
  Schreibzugriff und das Enter laufen im selben `page.evaluate`, damit der
  Poll nicht dazwischenkommt. Dazu die Leseseite einer vergangenen
  Session (`/campaigns/beispiel/sessions/2026-01-15`): Log-Zeilen mit
  Szenen-Links auf `/campaigns/beispiel/scenes/<id>`, die geschlossene Pause
  mit ihrer Dauer, die gespielten Szenen — und die alte Eintrags-Adresse
  derselben Session als 404. Die Leseansicht einer Szene bietet wie jede
  Leseansicht „Session starten".
- **Pfad 5** (`review.e2e.ts`, `threads.e2e.ts`): die Review sichtet eine
  Log-Zeile mit `PATCH …/sessions/<id>/log/<log-id> { rev, reviewed }` und
  hakt eine Idee mit `PATCH …/ideas/<id> { rev, done }` ab, also liest der Spec das `reviewed` der getroffenen Log-Zeile und die
  abgehakte Idee samt ihrem neuen `rev` — und prüft, dass keine andere das
  Flag trägt. Eine Idee mit altem `rev` ist 409 mit der aktuellen Idee, ein
  `text` im `PATCH` eine 400, und `…/inbox` sowie `review/inbox-done`
  antworten 404. „Handlungsstrang übernehmen" wird ein Faden des Kapitels
  (`POST …/threads`, flach mit `chapter`); Text und `rev` des Kapitels
  bleiben gleich, und der schon vorhandene Faden auch. Abgehakt wird per `id`
  gegen das `rev` des Fadens (unbekannt: 404, alter Stand: 409 mit dem
  aktuellen Faden). `threads.e2e.ts` pflegt die Fäden in der Kapitelübersicht
  (Pfad 1) — anlegen, abhaken, umformulieren, löschen, die Konfliktzeile mit
  „Neu laden" —, zeigt, dass ein Faden-Write einen offenen Kapitel-Editor
  nicht in einen Konflikt treibt, und prüft die Ressource selbst: flache
  Antwort, 400 für ein unbekanntes Feld, 409 mit altem `rev` (auch beim
  `DELETE`) und 404 auf `…/chapters/<kapitel>/threads`.
  „NPC anlegen" auf einer `#npc`-Zeile ist `POST …/npcs { name, id, body }`:
  ein neuer NPC bekommt die Notiz als Text, ein leerer unter der Kennung wird
  gefüllt, und bei einem NPC mit Inhalt bleibt der Dialog mit dem
  Konflikt-Satz offen — nichts geschrieben, die Log-Zeile bleibt
  `reviewed: false`. Die Log-Zeile als Ressource: unbekannte id 404, alter
  `rev` 409 mit der aktuellen Zeile unter `logEntry`, `text` im `PATCH` 400,
  `review/seen` 404, und das `rev` der Session bleibt stehen. Eine anderswo
  geänderte Log-Zeile zeigt auf ihrer Karte den Satz dazu, schreibt nichts,
  und der nächste Klick gelingt — fremder Schreibzugriff und Klick im selben
  `page.evaluate`.
- **Pfad 8** (`mobile.e2e.ts`): der Ideen-Einwurf wird eine Idee am Ende;
  der Spec vergleicht alle Ideen samt `rev`, womit „die vorhandene Idee
  bleibt unberührt" und „nichts abgehakt" in einer Zusicherung stehen.

`tests/campaign-knowledge.e2e.ts` ist die Hälfte von Pfad 6, in der der DM
Kampagnenwissen und Glossar auf ihren Seiten pflegt: jeder Glossar-Begriff
und jedes Stück Kampagnenwissen ist eine eigene Ressource mit eigenem `rev`.
Der Spec prüft auf der Leitung die flache Antwort, 409 mit dem aktuellen
Stand, 400 für ein fremdes Feld und 404 auf den alten Adressen `…/glossary`
und `…/knowledge`, dazu die Glossar-Einleitung als Feld der Kampagne. Auf
den Seiten: anlegen, bearbeiten, löschen, der doppelte Begriff (409 mit
Satz), das Umsortieren des Kampagnenwissens über den eigenen Wächter der
Reihenfolge — kein `rev` einer Zeile bewegt sich — und zwei Zweitschreiber:
einer ändert die offene Zeile (Konfliktzeile mit „Neu laden" und „Trotzdem
speichern", das nur das geänderte Feld schreibt), einer die Reihenfolge
(Konfliktzeile, „Neu laden" holt sie). Ein Zweitschreiber an einer ANDEREN
Zeile ist kein Konflikt: der offene Begriff wird gespeichert, wo er getippt
wurde. Danach der Lauf: das Wissen steht im mitgeschickten Kontext (der Stub
echot den Prompt-Block), die Namens-Hinweise erscheinen, „Übernehmen" geht
trotzdem.

`tests/generator-restart.e2e.ts` ist die Neustart-Hälfte von Pfad 6 und
braucht darum, wie der Seed-Spec unten, zwei Server hintereinander auf
DEMSELBEN Datenverzeichnis: der erste startet einen Lauf bzw. bringt ihn zu
Ende, der zweite ist der Neustart. Ein **fertiger** Job ist danach vollständig
da (Ergebnis, `sceneEdits` je Szene und Feld) und wird mit dem bearbeiteten
Titel und Text übernommen; ein **laufender** steht als `failed` mit
„Server wurde während des Laufs neu gestartet — Job neu starten" statt als
endloser Spinner, und die früheren Adressen `GET …/generate/job` und
`POST …/generate/apply` antworten 404.

`tests/generator-pipeline.e2e.ts` ist die **Pipeline-Hälfte** von Pfad 6
die Pipeline: ein Lauf mit drei Szenen, von denen eine fehlschlägt — die anderen
zwei sind prüfbar und einzeln übernehmbar, während der defekte Teil seinen
Fehlertext und sein eigenes „Erneut versuchen" trägt; danach sind alle drei da
und „Rest übernehmen" räumt den Lauf ab. Dazu „Verwerfen" mitten im Lauf und
ein Neustart mitten im Lauf (zwei Server hintereinander, wie oben): fertige
Teile bleiben, der Teil in Flug wird `failed` und ist auf dem neuen Prozess
wieder startbar, weil die Gliederung mit der Zeile zurückkommt. Die Gliederung
selbst kommt in keiner Zusicherung vor — sie wird dem Nutzer nie gezeigt.

`tests/generator.e2e.ts` deckt zusätzlich den **Prüfzustand**
ab: vorgeschlagene Szene bearbeiten → Seite verlassen → zurück → beides ist
da (ein Feld und eine Zeile Text, am Job als `sceneEdits[<id>]`
nachgelesen), und das Übernehmen schreibt den bearbeiteten Titel UND den
bearbeiteten Text. Zwei Tests daneben halten die Trennung fest: eine
Änderung nur an den Feldern lässt den Text des Laufs Byte für Byte stehen,
eine Änderung nur am Text lässt jedes andere Feld des Laufs stehen. Jeder von
ihnen braucht einen eigenen Lauf — beide schreiben am Ende dieselbe Szene,
und ein zweites Übernehmen auf eine bestehende id ist ein 409.

Wer dort an die Textarea will, geht über den Umschalter: „Bearbeiten" öffnet
die zwei Bereiche „Eigenschaften" (`role="region"`) und „Text", und der
Text-Bereich startet auf den Blöcken — erst „Markdown" in der Gruppe
„Editiermodus" bringt die Textarea, deren Name „Text von scenes/&lt;id&gt;"
lautet. Gespeichert wird implizit (entprellt, auf Blur geflusht); das
Beobachtbare ist die stille Statuszeile.

Weiter im Prüfzustand: einen
vorgeschlagenen Eintrag entscheiden → Reload → die Entscheidung steht; eine
Szene einzeln übernehmen („Diesen übernehmen") → der Rest bleibt prüfbar und
die Fortschrittszeile sagt „1 von 3 übernommen" → „Rest übernehmen" schreibt
den Rest und der Job ist weg. Ein zweiter Spec zeigt die Lead-Entscheidung
dazu: „Rest verwerfen" nimmt nur den offenen Rest mit, das einzeln Übernommene
bleibt als Eintrag stehen. `tests/augment.e2e.ts` prüft dieselbe Persistenz
auf Block-Ebene — eine Block-Entscheidung überlebt den Reload.

`tests/augment.e2e.ts` ist die Ergänzungs-Hälfte von Pfad 6 („Mit KI
ergänzen"): derselbe Lauf auf eine Szene, einen NPC oder einen Ort, den es
schon gibt — jede auf ihrer eigenen Ressource (Job-Art `scene-augment`,
`npc-augment` bzw. `location-augment`, der Vorschlag als die Entität wie
gelesen neben ihr wie vorgeschlagen, flach).
Der Spec belegt: ein leerer NPC → ergänzen → Löcher gefüllt, während
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
darunter: `tests/seed.e2e.ts`, auf dem Seed-Werkzeug. Er belegt zweierlei —
dass eine frische Instanz **leer** startet (der Boot lädt nichts) und dass
`grimoire seed` die Fixtures vollständig einliest (Tree, Szenenkörper, NPC,
Session, Ideen, Glossar-Begriffe, `seeded: beispiel` auf stdout — jede über
ihren eigenen Endpoint gelesen), während ein
**zweiter** Lauf ablehnt, weil die Datenbank schon Kampagnen hält: gleiche
Zeilenzahlen, gleicher Inhalt. Er braucht eigene Boots und benutzt darum
`startGrimoireServer`/`seedCampaigns` direkt statt der `server`-Fixture.

Auf Pfad 7 teilen sich zwei Specs die Arbeit: `status-control.e2e.ts` deckt den
Status-Regler ab (ein Schlüssel, Konflikt über das Poll-Fenster; der Regler hat
keine Konflikt-Aktionen und meldet nur den veralteten Stand),
`properties-form.e2e.ts` den „Eigenschaften"-Dialog (alle Felder einer
Entitätsart, Chips/Referenzen/Select, Leeren löscht den Schlüssel, und der
deterministische 409: der Dialog schreibt gegen die Version, mit der seine
Bearbeitung begann, und beantwortet den Konflikt mit seinen zwei Aktionen —
„Neu laden" zeigt die aktuellen Werte, „Trotzdem speichern" schreibt nur die
Felder des Dialogs, eine gleichzeitige Textänderung übersteht es also und wird
über die API zurückgelesen). Der
Dialog berührt zusätzlich Pfad 2 (die Leseansicht zeigt die neuen Werte sofort)
und Pfad 8 (Formular bei 390px) — beides steht in demselben Spec.
`properties-form.e2e.ts` prüft dort auch den neuen Ort: `location` ändern
ist ein Feld der Szene, die Route bleibt `…/scenes/<id>`, die
Kapitelübersicht behält die Reihenfolge und nennt den neuen Ortsnamen, und
die Log-Zeilen der Session bleiben gültig (ihr `sceneId` nennt die Szene über
ihre id). Freitext in `location`
ist dort ein 400 mit `code: "location_not_an_id"` — die Gegenprobe steht in
`scene-rendering.e2e.ts`. Und weil Status und Typ seit ADR #25
`CHECK`-Constraints ihrer Spalten sind, hält ein Test im selben Spec die Regel
direkt am Schreibweg fest: ein `status` außerhalb der geschlossenen Liste ist
ein 400 mit `code: "status_not_allowed"` samt `kind`, `value` und `allowed`,
und die Szene bleibt unverändert — auch die Zeilenversion. Ein veralteter
`rev` am `PATCH` einer Szene ist 409 mit der Szene, ein Feld, das sie nicht
hat, eine 400, die es nennt — `POST` wie `PATCH` (`scene-rendering.e2e.ts`).

Auf Pfad 9 teilen sich zwei Specs die zwei Oberflächen von „Bearbeiten", die
sich EINEN Entwurf teilen: `block-composer.e2e.ts` deckt den
Block-Composer ab — Standardmodus, eine Karte pro Block, Anlegen/Verschieben,
Kinder eines `## If:`-Abschnitts, unbekannte Konstrukte als Roh-Block, die
Save-Sperre bei einem `##` in einem If-Kind (Hinweis an der Karte, „Speichern"
aus, Eintrag unverändert), der 409 mit offenem Blockformular und die Bedienung
bei 390px. `entry-edit.e2e.ts` deckt
den „Markdown"-Fallback ab: die Textarea, ihre „Vorschau" (die es nur dort
gibt), die Kinds mit und ohne Editor und die Verlustpfade (Navigation,
fehlgeschlagener Refetch). Dazu die beiden Konflikt-Antworten in je einem
Test — derselbe Aufbau, ein fremder Status-Write neben dem offenen Editor:
„Neu laden" verwirft den Entwurf und zeigt gespeicherten Text samt geändertem
Status — auf derselben Oberfläche, die Antwort auf einen Konflikt schiebt
niemanden von der Textarea in den Composer —, „Trotzdem speichern" schreibt
den Text und lässt den fremden Status stehen. Ein Test belegt Felder und Text in EINER Anfrage direkt am
Schreibweg der Szene — ein Schritt der Zeilenversion, und kein Feld dabei ist
400 `nothing_to_write` —, weil keine Oberfläche der App heute beides in einem
Speichern schickt. Kapitel und Kampagne sind eigene Ressourcen (ADR #31):
ein Test liest beide flach (alle Felder nebeneinander, ohne `kind`, `path`
und `properties`), schickt einen alten `rev` (409 mit dem aktuellen Stand,
nichts geschrieben) und ein Feld, das die Entität nicht hat (400, die es
nennt). Einen allgemeinen Endpunkt gibt es nicht: jede Adresse, die früher
`…/entries/*` bildete — das Kapitel, `campaign`, die Listen, NPC, Ort und
Szene —, antwortet 404, keine Umleitung, kein Alias. Genau das hält der Spec
an EINER Stelle fest (GET und PATCH). Der Text eines Kapitels wird auf
seiner Leseansicht `/campaigns/:id/chapters/<id>` bearbeitet wie der einer
Szene — gespeichert, gerendert, Titel und Status unverändert — und ein
Zweitschreiber führt zur Konfliktzeile, deren „Neu laden" den gespeicherten
Stand übernimmt. Ein Glossar-Begriff ist eine eigene Ressource, die die
Glossar-Seite zeigt, was derselbe Spec belegt. Jeder Test dort betritt den
Editor über `openMarkdownEditor` — erst „Bearbeiten", dann der Umschalter „Markdown" —,
weil „Bearbeiten" allein im Composer landet. Ein Test dort deckt
zusätzlich den neuen Ort ab: eine Szene, deren `location` sich geändert hat,
bleibt unter ihrer Route und wird dort bearbeitet und gespeichert.

Pfad 10 (`cold-start.e2e.ts`) ist der einzige Pfad, der OHNE Seed läuft:
`test.use({ seed: { skip: true } })` startet den Server auf einem leeren
Datenverzeichnis, das Seed-Werkzeug läuft nie — genau das, was eine frische
Installation ist. Der Spec legt darum alles selbst an (Kampagne →
Kapitel → Szene → Text → Session; die neue Szene öffnet sich im Editor
unter `/campaigns/:id/scenes/<id>`, und ein Kapitelwechsel im
Eigenschaften-Dialog hängt sie ans Ende des Zielkapitels) und baut seinen `api`-Helfer mit
`apiFor(server.url, id)`, weil die Kampagnen-id erst zur Laufzeit existiert.
Dazu die beiden Listen-Einstiege („NPC/Ort anlegen", die Listen auf
`/campaigns/:id/npcs` und `/campaigns/:id/locations`) mit der
Slug-Kollision — 409 mit Vorschlag, nichts geschrieben, der Vorschlag als ein
Klick; für den NPC auch auf der Leitung samt dem 400 für ein unbekanntes
Feld —, die selbst gesetzte Kennung am Stift der Vorschauzeile (ADR #21: der
Anlege-Dialog ist der einzige Ort dafür — ungültige Kennung blockiert
„Anlegen", leeres Feld leitet wieder aus dem Namen ab) und dieselben Listen
bei 390px, womit der Spec auch auf Pfad 8 liegt.

Beide lesen nach jedem Speichern die Szene über die API zurück, und der
Composer parst und serialisiert den Textkörper: „kein Byte Diff außer dem bearbeiteten Block" ist
darum die eigentliche Zusicherung, nicht ein `toContain` auf dem neuen Satz.

Deutsche UI-Strings in Zusicherungen kommen aus den Komponenten, nicht aus dem
Gedächtnis: bei einer Textänderung in der App wandert der Spec mit.

Ein Spec deckt auch spätere Scheiben auf seinem Pfad ab, nicht nur die Scheibe,
die ihn angelegt hat: `tests/chapter-overview.e2e.ts` prüft zusätzlich den Ortsnamen in der
Metazeile, die Szenen-Reihenfolge mitsamt Konflikt (und dass der `PATCH`
einer Szene deren Wächter nicht bewegt), die Zeile, die auf
`/campaigns/:id/scenes/<id>` öffnet,
die Topbar-Navigation und den Dialog „Kampagne bearbeiten" (Name,
Beschreibung und Text über `PATCH /campaigns/:id`, samt Konfliktzeile, deren
„Trotzdem speichern" nur die geänderten Felder schreibt),
`tests/review.e2e.ts` den Szenentitel im Quellchip, und
`tests/search.e2e.ts` die Frische-Zusicherung des Cutovers: was die
APP gerade geschrieben hat, findet ⌘K sofort — der Index wandert in derselben
Transaktion mit, es gibt keinen Watcher mehr, auf den zu warten wäre.

## Das Kapitel als eigene Ressource

Zwei Pfade tragen das Kapitel als eigene Ressource.

- **Pfad 6** (`generator.e2e.ts`): „Neues Kapitel" → **Seite verlassen** →
  zurück → „Übernehmen". Die Navigation ist der Kern des Tests, nicht Deko:
  der Prüfschritt ist persistent, also ist genau das der Normalfall. Titel
  und id des neuen Kapitels liegen am Job
  (`generate_jobs.new_chapter_title`, beim **Start** geschrieben), und der
  Spec prüft sie am Kapitel (`getChapter(api, id)`) UND in der Übersicht. Die Gliederung
  beschreibt das neue Kapitel (der Stub antwortet mit einer Beschreibung,
  sobald der Kontext `neues Kapitel: ja` trägt): „Entwürfe prüfen“ zeigt sie
  als „Beschreibung des Kapitels“, und das Kapitel hat sie danach als
  Text. Ein Lauf in ein bestehendes Kapitel mit `E2E_DESCRIBE_ANYWAY` zeigt,
  dass eine trotzdem gelieferte Beschreibung den Text dieses Kapitels nicht
  erreicht.
  Zu beachten: ein Bulk-„Übernehmen" lässt **unentschiedene** vorgeschlagene
  Einträge offen (Regel des Prüfschritts), der Prüfschritt bleibt stehen und
  meldet „1 von 3 übernommen" — das Kapitel schreibt schon der erste Accept.
- **Pfad 1** (`chapter-overview.e2e.ts`): ein Kapitel ist dort bearbeitbar, wo es gelesen
  wird — „Kapitel-Eigenschaften" (Titel/Status, der Dialog des Kapitels),
  „Kapitel bearbeiten" (der Kapiteltext, den die Übersicht zeigt, inkl. 409
  gegen einen zweiten Schreiber) und das **Status-Bedienelement** in der
  Kapitelzeile. Jeder Wert ist **ein** `PATCH …/chapters/<id> { rev, status }`;
  „Aktiv" macht das Kapitel zum aktiven, der Server setzt das bisher aktive
  im selben Vorgang auf „Geplant", und laut Baum ist genau ein Kapitel aktiv.
  Ein Zweitschreiber zwischen dem Öffnen des Menüs und der Wahl ergibt die
  leise Meldung ohne Konflikt-Aktionen (Pfad 7), die nächste Wahl gelingt.
  Den Text von Kapitel und Kampagne zeigt die
  Übersicht ganz und gerendert, auf vier Zeilen begrenzt: „Mehr anzeigen“
  steht nur bei einem längeren Text da (der Spec schreibt dafür einen langen
  Text über die API), öffnet und schließt ihn, und ein Verweis im
  abgeschnittenen Teil öffnet ihn, sobald er den Tastatur-Fokus bekommt.

Zwei Fallen für neue Specs auf diesen Pfaden:

- **Namen matchen als Teilstring.** „Kapitel bearbeiten" enthält
  „Bearbeiten", und in der Kapitelübersicht steht beides auf einer Seite. Wer
  die Aktion des KAMPAGNENKOPFS meint, schreibt
  `getByRole("button", { name: "Bearbeiten", exact: true })`.
- **Die Felder der Dialoge über die Rolle ansprechen.** Der
  Eigenschaften-Dialog schreibt die Pflichtmarkierung in das Label, der
  zugängliche Name ist also „Titel · nötig" — `getByRole("textbox", { name: … })`
  ist dort robuster als `getByLabel`.
