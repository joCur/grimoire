# Eine Ressource und ein Typ je Entität

## Entscheidung

Jede Entität der Datenbank ist eine eigene Ressource mit eigenem Typ, eigenem
zod-Modul als einziger Quelle und eigener App-Route. Einen allgemeinen
Endpunkt über mehrere Entitäten gibt es weder in der API noch in der App.

### URL-Schema

Jeder kampagnenabhängige Pfad hängt unter der Kampagne — in der API
`/api/campaigns/:id/…`, in der App `/campaigns/:id/…`. Die Mehrzahl
`campaigns` gilt auch für die einzelne Kampagne (`GET /api/campaigns/:id`).
Kampagnenlos sind `/api/campaigns`, `/api/settings` und `/settings`.
URL-Segmente sind der englische Plural der Entität. Eine URL, die nichts
benennt, antwortet 404, ohne Umleitung und ohne Alias.

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

Die API-Pfade stehen unter `/api`.

### Leitung

- Jede Ressource antwortet mit ihrem eigenen Typ, etwa
  `Location { id, name, chapter?, roll20Page?, atmosphere?, body, rev }`: alle
  Felder nebeneinander, `body` eingeschlossen, wo die Entität einen hat. Es
  gibt kein `kind`, kein `path`, keinen gemeinsamen Basistyp und keine
  Vereinigung mehrerer Entitäten; welche gemeint ist, steht in der URL.
  Feldnamen sind gewöhnliche Bezeichner (`roll20Page`).
- **Keine Sammelbegriffe.** Jedes Feld ist ein Feld seiner Entität, `body`
  eingeschlossen. Typen, Code und Doku beschreiben jede Entität mit ihren
  eigenen Feldern; es gibt keine Hälften einer Entität und keine gemeinsame
  Form, die mehrere Entitäten vertritt.
- **Wo gemischt wird, nennt der Treffer seine Entität.** Ein Suchtreffer ist
  `{ kind, id, title }`: die Suche ist wirklich gemischt, deshalb trägt der
  Treffer `kind`, und die App öffnet daraus die Route der Entität.
  `[[id]]`-Verweise lösen gegen die Ressourcen auf.
- **Zeitpunkte schreibt der Client als Epochen-Wert.** Gespeichert ist ein
  Zeitpunkt als zonenlose Lokalzeit des Servers (`decisions/constraints`);
  nur der Server weiß, zu welcher Uhr sie gehört. Er liefert darum die
  Epochen-Lesung daneben (`startedMs`, `toMs` …), und ein Schreibzugriff nennt
  einen Zeitpunkt in genau dieser Form.

### Schlüssel und Verschachtelung

- **Stabile Schlüssel.** Jede Entität hat eine stabile `id`, und über sie —
  nie über ihre Position und nie über einen änderbaren Text — nennen URL,
  Leitung und Verweise sie. Setzt der DM die id nicht selbst (Faden, Idee,
  Glossar-Begriff, Kampagnenwissen), vergibt der Server beim Anlegen eine
  opake. Ein Text, der je Kampagne nur einmal stehen darf (der Begriff eines
  Glossar-Begriffs), ist ein Feld mit eindeutigem Index, kein Schlüssel.
- **Flach oder verschachtelt.** Eine Entität, die zwischen Eltern wandern
  kann, liegt flach unter der Kampagne, und ihr Elternteil ist ein Feld: eine
  Szene unter `…/scenes/:id`, ein Faden unter `…/threads/:id`, jeweils mit
  `chapter`. Ihre ids sind je Kampagne eindeutig, ihre URL ändert sich nicht,
  wenn sie wandert, und die Liste filtert nach dem Elternteil
  (`…/threads?chapter=<id>`). Eine Entität, die ohne ihren Elternteil nicht
  existiert und nie wandert, hängt unter ihm: Pause, Log-Zeile und gespielte
  Szene unter ihrer Session. Gelesen wird ein solches Kind eingebettet in
  seinem Elternteil; geschrieben wird es nur über seine eigene Ressource, und
  ein Schreibzugriff auf den Elternteil schreibt es nicht.

### Übergänge sind Änderungen an Ressourcen

Ein Zustand ist ein Feld: ein Wechsel ist ein `PATCH` darauf, ein Anfang ein
`POST`, ein Verwerfen ein `DELETE`. Aktions-Endpunkte gibt es nicht.

- Eine Idee abhaken ist `PATCH …/ideas/:id { rev, done }`.
- Welches Kapitel aktiv ist, sagt sein `status` (`decisions/scene-order`).
- Eine Session startet mit `POST …/sessions`, endet mit
  `PATCH …/sessions/:id { rev, endedMs }` und wird verworfen mit `DELETE`.
  Eine Pause beginnt mit `POST …/pauses` und endet mit
  `PATCH …/pauses/:id { rev, toMs }`. Welche Session läuft, sagt ein Filter
  der Liste (`…/sessions?running=true`, eine oder keine), kein eigener
  Endpunkt; die Liste steht neueste zuerst.
- Ein Generator-Lauf beginnt mit `POST …/generator-jobs { kind, … }` oder auf
  der Ressource, die er ergänzt; geprüft, übernommen, wiederholt und
  verworfen wird er auf seiner eigenen Ressource (`decisions/generator`).

### Reihenfolge

Wo der DM eine Reihenfolge setzt, schreibt sie ein eigener Endpunkt mit
eigenem Wächter an dem, dem die Reihenfolge gehört, und kein `rev` einer
Entität bewegt sich dabei: die Szenen eines Kapitels
(`…/chapters/:id/scene-order`, `decisions/scene-order`) und das
Kampagnenwissen einer Kampagne (`PUT …/knowledge-item-order { items, rev }`,
Wächter `campaigns.knowledge_item_order_rev`). Ein alter Stand ist 409 mit der
aktuellen Reihenfolge. Wo die Reihenfolge alle Zeilen einer Kampagne nennt,
bewegt auch Anlegen und Löschen ihren Wächter, denn beide ändern, was sie
aufzählt. Wo die App nicht sortiert, gilt die Reihenfolge des Anlegens, und
es gibt keinen Reihenfolge-Endpunkt (Faden, Idee, Glossar-Begriff).

### Eine Quelle je Entität: ihr zod-Schema

Das Schema jeder Entität ist ein zod-Schema in `shared/src/<entität>.ts`. Aus
ihm kommen der TypeScript-Typ (`z.infer`), die Prüfung von `PATCH`, `POST` und
Seed und das Antwort-Schema des Generators (`decisions/generator`). Keine
dieser Formen wird von Hand nachgebaut: jede Entität leitet ihre Formen selbst
und ausdrücklich mit der API von zod ab (`omit`, `extend`, `partial`,
`nullable`, `z.toJSONSchema`). Ein gemeinsames Modul, das über die Felder
beliebiger Entitäten läuft, gibt es nicht. Die Speicherform beschreibt
`server/src/db/schema.ts`; beide werden synchron gehalten.

### Server und App

- **Server:** Das Domänenmodul einer Entität (`server/src/store/<entität>.ts`)
  rendert, liest, schreibt und übernimmt sie getypt. Routen greifen nie
  direkt per SQL zu. Ein Routen-Modul je Ressource
  (`server/src/routes/<ressource>.ts`) dokumentiert seine Endpunkte mit einem
  Kommentar je Route.
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
    Topbar, Seitenkontext, Live-Drawer —, steht nur ein Verteiler: er ordnet
    eine id oder einen Treffer ihrer Entität zu; Beschriftung, Link und
    Vorschau kommen aus deren Slice.
  - Kein Barrel: Aufrufer importieren die konkrete Datei (`@/npc/NpcCard`).

## Warum

Die Datenbank hält jede Entität in ihrer eigenen Tabelle mit eigenen
Spalten. Ein gemeinsamer Endpunkt mit einer untypisierten Abbildung der
Felder verliert diese Typisierung auf dem Weg zur Leitung: die zulässigen
Schlüssel brauchen dann eine eigene Liste, ihre Formen eine eigene
Beschreibung, die Generator-Schemata eine dritte Fassung, und Store wie App
verzweigen an jeder Stelle darüber, welche Entität gemeint ist.

zod liefert Typ, Prüfung und JSON-Schema aus einer Beschreibung, in der
Sprache des übrigen Codes; die Formen können nicht auseinanderlaufen, weil es
nur eine gibt (`decisions/dependencies`).

Stünde die Kampagnen-id als erstes Segment, kollidierte sie mit jedem
kampagnenlosen Pfad — `/:campaign` träfe auch `/settings` — und erzwänge
Sonderfälle an mehreren Stellen der App, die mit jedem neuen kampagnenlosen
Pfad mitwüchsen. Mit dem Präfix ist die Kollision ausgeschlossen statt
abgefangen, und Erweiterungen haben ein Muster.

## Folgen

- Ein neues Feld ist eine Zeile im Schema seiner Entität und eine in ihren
  Formularfeldern, dazu seine Spalte samt Migration. Typ, Prüfung und
  Generator-Schema folgen.
- Für die Schreibwege gilt `decisions/writes`, für die Fixtures
  `decisions/data-shape`.
