# Grimoire — Datenmodell & Konventionen

Grimoire speichert eine Kampagne in einer SQLite-Datenbank
(`GRIMOIRE_DATA/grimoire.db`). Ein **Eintrag** ist eine Kampagne, ein
Kapitel, eine Szene, ein NPC oder ein Ort. Jeder Eintrag besteht aus
**Eigenschaften** — den Feldern, die die App im Eigenschaften-Dialog zeigt
(Titel, Status, Ort, …) — und einem **Text** in Markdown.

Dazu kommen vier **Listen**, die keine Einträge sind und keinen Text haben
(ADR #26): die **Sessions**, die **Ideen**, das **Glossar** und das
**Kampagnenwissen**. Sie sind Tabellen, werden als Listen gepflegt und haben
keine Adresse — jede antwortet auf ihren eigenen Endpoints.

Die Speicherform steht genau einmal in `server/src/db/schema.ts`; dieses
README beschreibt, was in den Feldern stehen darf und was der Text
enthalten kann. Alle Feldnamen sind Englisch (stabil, maschinenlesbar), alle
Inhalte Deutsch.

Grundprinzip: **Das Format degradiert, es validiert nicht.** Eine unbekannte
Überschrift oder ein unbekannter Callout im Text wird als normaler Text
gezeigt; nichts bricht.

## Adressen

Jeder Eintrag hat eine **Adresse** — die Kennung, unter der API und URL ihn
ansprechen. Sie setzt sich aus der Art des Eintrags und seiner `id`
zusammen und steht genau einmal in `server/src/store/paths.ts`:

| Eintrag | Adresse |
| ------- | ------- |
| Kampagne | `campaign` |
| Kapitel | `<kapitel-id>` |
| Szene | `<kapitel-id>/<orts-id>/<szenen-id>` — ohne Ort: `<kapitel-id>/<szenen-id>` |
| NPC | `npcs/<id>` |
| Ort | `locations/<id>` |

Die `id` entsteht beim Anlegen aus dem getippten Namen, nach genau einer
Regel (`@grimoire/shared/slug`), und steht damit fest: sie ist der
Referenz-Schlüssel in Adressen, Links und `[[id]]`-Referenzen und ändert sich
danach nie mehr (ADR #21). Der Eigenschaften-Dialog zeigt sie, bietet aber
keine Änderung.

Die Adresse einer Szene enthält ihren **Ort**. Die Kapitelübersicht gruppiert
Szenen nach Ort; Szenen ohne Ort stehen unter „Ohne Ort". Ändert der DM den
Ort einer Szene, ändert sich ihre Adresse — die alte bleibt auflösbar, der
Server antwortet mit der aktuellen und die App ersetzt die URL.

**Sessions, Ideen und Glossar haben keine Adresse** — sie sind Tabellen, die
als Listen gepflegt werden, und antworten auf ihren eigenen Endpoints
(ADR #26):

| Liste | Lesen | Schreiben |
| ----- | ----- | --------- |
| Session | `GET …/session[?includeEnded=1]` (die laufende, sonst `null`), `GET …/sessions`, `GET …/sessions/<id>` | `POST …/session/start`, `/end`, `/pause`, `/continue`, `/discard`, `POST …/log`, `PATCH …/sessions/<id>` |
| Ideen | `GET …/inbox` | `POST …/inbox`, `POST …/review/inbox-done` |
| Glossar | `GET …/glossary` | `PUT …/glossary` |
| Kampagnenwissen | `GET …/knowledge` | `PUT …/knowledge` |

Glossar und Kampagnenwissen bekommt der Generator als Kontext; beide werden
auf ihren eigenen Seiten gepflegt. Die Segmente `sessions`, `inbox` und
`glossary` bleiben trotzdem **reserviert**, damit kein Kapitel eine dieser ids
belegt und mit dem Pfad seiner Liste kollidiert.

Alles Kampagnenabhängige hängt unter der Kampagne — in der API
`/api/campaigns/<kampagne>/…`, in der App `/campaigns/<kampagne>/…` (ADR #22).
Die Adresse steht dabei im Pfad: `GET
/api/campaigns/beispiel/entries/01-salzhafen/leuchtturm/ankunft-leuchtturm`
liest diesen Eintrag, `GET /api/campaigns/beispiel` den Kampagnen-Eintrag.
Kampagnenlos bleiben `/api/campaigns`, `/api/settings` und `/settings`.

## Eigenschaften

Die Eigenschaften eines Eintrags sind seine strukturierten Felder. Sie
heißen auf der Leitung `properties`; die App zeigt sie im
Eigenschaften-Dialog, und `PATCH /api/campaigns/<kampagne>/entries/<adresse>`
ändert genau die Felder, die der DM angefasst hat. Felder, die ein Eintrag
mitbringt und die seine Art nicht kennt, bleiben erhalten und lassen sich
ändern oder löschen; neue legt die API nicht an (400).

### Kampagne

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil |
| `name` | Anzeigename in der UI; fehlt er, ist der Anzeigename die id |
| `description` | Kurzbeschreibung, eine Zeile |

Der Text ist freier Notizraum für Kampagnenweites.

### Kapitel

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil; erstes Segment jeder Szenen-Adresse |
| `title` | Anzeigename |
| `status` | `planned`, `active` oder `done` |

`active` markiert das **eine** Kapitel, das die Session-Ansicht öffnet: der
Server setzt es in einem Vorgang und stellt das bisher aktive Kapitel zurück
auf `planned`. Die API schreibt nur diese drei Werte (400 sonst), und die
Spalte selbst lässt keinen anderen zu — `status` ist ein `CHECK`-Constraint
(DECISIONS #25), kein degradierendes Freitextfeld.

Im Text liegen das Kapitelziel (Abschnitt `## Ziel des Kapitels`) und die
Handlungsstränge (`## Offene Fäden`, Checkliste), die die Nachbereitung
befüllt.

### Szene

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil, wird referenziert (`scenes_played`, Log) |
| `title` | Anzeigename, frei änderbar |
| `type` | `planned` oder `contingency` (Eventualszene) |
| `trigger` | nur bei `contingency`: wann feuert sie? Freitext |
| `chapter` | Kapitel-id; muss existieren |
| `location` | Orts-id; bestimmt Gruppe und Adresse der Szene |
| `npcs` | Liste von NPC-ids |
| `handouts` | Namen der Roll20-Handouts, nur Verweis |
| `tags` | frei; empfohlen: `combat`, `social`, `stealth`, `travel` |
| `status` | `draft`, `ready`, `played`, `dropped` |

### NPC

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil, wird referenziert |
| `name` | Anzeigename |
| `role` | Einzeiler |
| `chapter` | Kapitel-id, wo eingeführt |
| `status` | `alive`, `dead`, `missing`, `unknown` |
| `statblock` | Verweis auf das Roll20-Sheet (`"Roll20: <Sheet-Name>"`), keine Kopie |
| `quickstats` | Kurzwerte, frei — nur was am Tisch sozial gebraucht wird (`{ wis: +2, insight: +2 }`) |
| `voice` | wie klingt er/sie |
| `appearance` | ein bis zwei Merkmale |

Text-Abschnitte: `## Will` (Motivation), `## Weiß` (`[!secret]`-Callouts),
`## Beziehungen` (freier Text; einen Gegenpart verlinkt `[[id]]` wie überall
im Text), `## Notizen` (befüllt die Nachbereitung mit „NPC-Stub anlegen" —
nicht von Hand pflegen).

Kleinst-NPCs bekommen keinen Eintrag, bis sie wiederkehren. Bis dahin: Zeile
im Szenentext oder `#npc`-Notiz im Log.

### Ort

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil, wird referenziert |
| `name` | Anzeigename |
| `chapter` | Kapitel-id |
| `roll20-page` | Verweis auf die Roll20-Seite, keine Karten-Kopie |

Text-Abschnitte frei; empfohlen: `## Beim ersten Betreten` (mit
`[!readaloud]`), `## Atmosphäre`, `## Wer ist hier`.

### Session

Eine Session ist **kein Eintrag**, sondern eine Zeile mit ihren Listen
(ADR #26); die App verwaltet sie, der DM schreibt nur ins Log. So antwortet
sie:

| Feld | Bedeutung |
| ---- | --------- |
| `id` | opake Zufalls-id (UUID); Reihenfolge und Datum kommen aus `started` |
| `started` | Start, sekundengenau, zonenlose Lokalzeit (`yyyy-mm-ddTHH:MM:SS`) |
| `startedMs` | dieselbe Zeit als Epochen-Wert, gelesen in der Zeitzone des Servers |
| `ended` / `endedMs` | gesetzt bei „Session beenden" |
| `pauses` | Liste `{ from, fromMs, to?, toMs? }`; ein Eintrag ohne `to` ist die laufende Pause — die Uhr steht |
| `log` | Liste `{ id, at, sceneId?, text, reviewed }`, append-only |
| `scenesPlayed` | Szenen-ids in Spielreihenfolge, automatisch gepflegt |
| `rev` | Wächter-Token für `PATCH …/sessions/<id>` |

- Eine Log-Zeile sind **Spalten**, keine Markdown-Zeile: Zeitstempel und
  Szenen-Kontext setzt die App, die Hashtags stehen im Text. `id` ist die
  stabile Kennung der Zeile — der Kurzhash (erste 8 Hex-Zeichen von SHA-256)
  ihrer kanonischen Zeile `- HH:MM (szenen-id) Text` —, und `POST
  …/review/seen` benennt eine Zeile damit.
- Pause und „Weiter" schreiben **keine** Log-Zeile: eine Pause ist ein
  Eintrag in `pauses` und sonst nichts — die Markierung im Log war dieselbe
  Pause ein zweites Mal.
- `PATCH …/sessions/<id>` ändert nur `started`, `ended` und `pauses` — die
  von Hand korrigierbaren Zeiten. Log und `scenesPlayed` wachsen über ihre
  eigenen Endpoints.
- Der freie Text der Session (`## Threads`, in der Nachbereitung befüllt)
  bleibt am Kapitel bzw. an der Zeile und ist kein Teil dieser Antwort.
- Timer = (`ended` ?? jetzt) − `started` − Summe der geschlossenen Pausen.
  Den Epochen-Wert der zonenlosen Zeitstempel liefert der Server; der Client
  rechnet nur noch mit Zahlen und hält keinen laufenden Zustand.

## Referenzen zeigen auf vorhandene Einträge

Eine Referenz nennt einen Eintrag, den es gibt. Wer in `npcs:` einer Szene,
in `location:`, in `chapter:`, in einer Schnellnotiz oder in
`scenes_played:` etwas einträgt, das keinen Eintrag hat, bekommt 400 mit dem
Hinweis, den Eintrag zuerst anzulegen — es entsteht nichts nebenbei.
Einträge entstehen über „Neu anlegen" und über das Übernehmen eines
Generator-Vorschlags, sonst nirgends.

`location:` verlangt eine id in Slug-Form (400 sonst) — sie ist zugleich die
Gruppe der Szene. Jede Szene gehört zu einem Kapitel; `chapter:` lässt sich
nicht leeren.

Eine Nennung im **Text** ist keine Referenz in diesem Sinn: `[[id]]` und was
unter `## Beziehungen` steht bleiben sichtbarer Text. Ein `[[id]]`, zu dem
es keinen Eintrag gibt, wird als Text angezeigt — kein Fehler, kein neuer
Eintrag. Ein leerer Eintrag ist übrigens normal: angelegt und noch nicht
gefüllt, er erscheint als dünne Karte und lässt sich jederzeit füllen.

## Text

Der Text eines Eintrags ist Markdown. Was der Renderer versteht — und was der
Generator produzieren muss:

### Abschnitte (H2)

| Überschrift | Bedeutung |
| ----------- | --------- |
| `## Flow` | Standardablauf, wenn nichts Besonderes passiert |
| `## If: <Bedingung>` | Verzweigung; Bedingung ist Freitext (Deutsch), wird einklappbar gerendert |
| alles andere | normaler Abschnitt, keine Sonderbehandlung |

### Callouts (Obsidian-Syntax)

| Callout | Bedeutung / Rendering |
| ------- | --------------------- |
| `> [!readaloud]` | Vorlesetext — groß, serifig, Copy-Button für den Roll20-Chat |
| `> [!check]` | Würfelmechanik (DCs, Contested Checks) — farblich auffällig |
| `> [!secret]` | Info, die die Spieler NICHT haben |
| `> [!outcome]` | Konsequenz über die Szene hinaus — Kandidat für einen Handlungsstrang |
| `> [!loot]` | Beute / Gegenstände |
| `> [!note]` | Freitext-Marginal des DM |

### Tabellen (GFM-Pipe-Tabellen)

Das einzige aus GFM übernommene Konstrukt — für Zufallstabellen und
Begegnungslisten, die als Prosa unlesbar wären. Syntax: **Kopfzeile**,
**Trennzeile** aus `|---|` (eine Zelle je Spalte) und **Rand-Pipes** links und
rechts in jeder Zeile. Tabellen gelten in jedem Text, in **jedem Callout** und
in `## If:`-Abschnitten.

```markdown
> [!note] Zufallsbegegnung an der Bucht
>
> | W6 | Was die Brandung anschwemmt |
> | --- | --- |
> | 1–2 | Ein leeres Fass mit fremdem Brandzeichen |
> | 3–4 | Ein Ruder, frisch gekerbt |
> | 5–6 | Eine Laterne, das Glas rußgeschwärzt |
```

(Im Callout steht die Tabelle unter demselben `>`-Block wie der Text — siehe
die Szene „Ankunft am Leuchtturm",
`fixtures/beispiel/scene-lighthouse-arrival.json`.)

- **Nur Tabellen.** Kein Durchgestrichen (`~~x~~`), **keine Aufgabenlisten**,
  keine Auto-Links, keine Fußnoten. `- [x]` bleibt bewusst normaler
  Listentext: es ist die Abhak-Syntax der Ideen, kein Kontrollkästchen.
- **Degradation wie überall**: Eine Zeile mit Pipes ohne gültige Trennzeile
  ist keine Tabelle, sondern Text.
- **Anzeige**: Die Tabelle scrollt in einem eigenen Container; auf dem Handy
  scrollt die Tabelle, nie die Seite.
- **Block-Composer**: Eine Tabelle ist kein eigener Blocktyp, sondern Teil des
  Text- bzw. Callout-Blocks; sie wird als Markdown bearbeitet.

### Referenzen im Fließtext: `[[id]]`

`[[jorna]]` im Text ist eine Referenz auf einen Eintrag. Sie gilt in jedem
Text (Szene, NPC, Ort, Kapitel, Kampagne) und in jedem Callout.

- **Gespeichert wird immer die id**, nie der Name. Den aktuellen Anzeigenamen
  setzt erst die Anzeige ein — ändert ein Eintrag seinen Titel, stimmt der
  Text überall, ohne dass ein Eintrag angefasst wird.
- Referenzierbar sind **NPC, Ort und Szene**. Kollidieren ids über Arten
  hinweg, gewinnt **NPC > Ort > Szene**. Kapitel sind nicht referenzierbar.
- In den Klammern steht **nur die id** in kebab-case (`[[alte-mole]]`); es
  gibt **keinen Anzeigetext** (`[[jorna|Jorna]]` ist normaler Text). Endungen
  stehen außerhalb: `[[jorna]]s Boot` → „Jornas Boot".
- **Code ist keine Prosa**: In Code-Blöcken und in `` `[[jorna]]` `` bleibt die
  Schreibweise wörtlich stehen — nicht aufgelöst und nicht indexiert.
- In der Kopfzeile eines `## If:`-Zweigs erscheint der aufgelöste **Name als
  Text** (kein Link): der Klick faltet den Zweig.
- **Degradation**: Eine id, die kein Eintrag hat, bleibt als `[[id]]` sichtbar
  stehen — kein Fehler, und sie wird lebendig, sobald der Eintrag existiert.
- Klick: in der Leseansicht ein Link zum Eintrag, in der Session-Ansicht
  öffnet er die Detail-Schublade, ohne die Session zu verlassen.
- Namen als normaler Text sind weiterhin erlaubt — sie bleiben aber stehen,
  wenn ein Eintrag seinen Titel ändert.

### Hashtags im Log

`#thread` offener Faden · `#npc` improvisierter NPC · `#loot` Beute ·
`#decision` Spieler-Entscheidung · `#date` In-Game-Datum (z. B. `#date Tag 4`)

`#pc` Notiz zu einem Spielercharakter. Ein optionaler zweiter Tag benennt den
Charakter (`#pc #kaela`); die Namen sind frei, es gibt keinen PC-Eintrag und
nichts zu pflegen. Die Nachbereitung sammelt solche Zeilen im Abschnitt
„Spielercharaktere", gruppiert nach dem zweiten Tag (ohne zweiten Tag:
„Allgemein"). `#pc` gewinnt gegen die übrigen Tags: die Zeile wird nicht als
Handlungsstrang oder NPC angeboten, sondern nur abgehakt („Erledigt") oder
offen gelassen („Behalten") — PC-Notizen sind Erinnerungen für den Tisch,
kein Kampagneninhalt.

## Ideen

Die Ideen-Liste ist append-only und sessionunabhängig, mit denselben Hashtags
wie das Log. Eine Idee ist eine Zeile `{ id, text, done }`; `GET …/inbox`
antwortet mit der Liste und ihrem eigenen Wächter-Token `rev`. Die
Nachbereitung zeigt sie zusammen mit dem Log.

## Nachbereitung

- „Als Handlungsstrang übernehmen" hängt `- [ ] <Text>` unter `## Offene
  Fäden` im Text des aktiven Kapitels an (der Abschnitt wird angelegt, wenn
  er fehlt).
- „NPC-Stub anlegen" erzeugt den NPC `npcs/<id>` mit `status: alive` (wer am
  Tisch auftaucht, lebt) und dem Log-Text unter `## Notizen`. Existiert die
  id, meldet die App den Konflikt statt zu überschreiben.
- „Idee abhaken" setzt `done` auf der genannten Zeile (`POST
  …/review/inbox-done { id }`) — die eine Ausnahme vom Append-only der Ideen,
  damit sie nicht in jeder künftigen Nachbereitung wieder auftauchen.

## Schreibregeln

- Geschrieben wird ausschließlich über die API (jeder Endpoint ist in
  `server/src/routes/api.ts` an seiner Route dokumentiert): Log, Ideen,
  Nachbereitung, Generator-Entwürfe — und für einen Eintrag der eine
  Schreibweg `PATCH /api/campaigns/<kampagne>/entries/<adresse>`, der
  Eigenschaften, Text oder beides in einem Zug schreibt (ADR #23).
  Glossar, Kampagnenwissen und Ideen sind Listen und werden über ihre
  eigenen Endpoints gepflegt; einen Text nehmen sie nicht an.
- Konfliktschutz: jeder Schreibzugriff trägt die Zeilenversion `rev` mit, die
  der Lesevorgang geliefert hat. Passt sie nicht mehr, antwortet der Server
  409 und die App sagt „Inzwischen geändert — neu laden" statt still zu
  überschreiben.
- Log und Ideen sind append-only (ADR #4); die eine Ausnahme ist das Abhaken
  erledigter Ideen.

## Generator

Siehe `generator/README.md`. Kurzfassung: Quelltext (EN) rein → Szenen als
Entwürfe (DE, dieses Format) raus, immer `status: draft`, immer mit
„Entwürfe prüfen" vor dem Übernehmen.

Ein Szenen-Lauf ist eine **Pipeline**: ein Gliederungs-Aufruf legt die
Szenen und ihre ids fest, danach wird jede Szene und jeder neue Eintrag
einzeln geschrieben. Ein Formfehler kostet nur den betroffenen Teil, fertige
Szenen sind sofort prüfbar, und ein defekter Teil lässt sich einzeln
wiederholen. Die Gliederung ist ein systeminterner Schritt — sie wird nie
angezeigt.

**Jeder** Aufruf antwortet mit einem JSON-Objekt, dessen Schema der Server
über die Provider-API **erzwingt**. Ein Eintrags-Aufruf (Szene, NPC, Ort,
Ergänzung) liefert das Objekt, das den gespeicherten Eintrag spiegelt: die
Eigenschaften unter `properties` — je Art getypt aus derselben Feldliste, aus
der der Eigenschaften-Dialog gebaut wird —, den Text als einen String unter
`body` und die Hinweise für den DM unter `warnings`. Dieses Paar aus
Eigenschaften und Text ist der **Entwurf** — im Prüfschritt, in den
Änderungen des DM und beim Übernehmen (ADR #24); ein Entwurf ist nie ein
Markdown-Text mit Eigenschaften davor. Die Schemata liegen als lesbares JSON
in `shared/schema/`; Details in `generator/README.md`.

## Fixtures

Die Beispielkampagne liegt als JSON unter `fixtures/beispiel/` — ein Eintrag
je Datei, genau in der Form, die die API spricht: `kind`, die
strukturierten Felder unter `properties` und der Text als ein String unter
`body`. Ideen, Glossar und Sessions tragen ihre Listen ebenso strukturiert,
als Zeilen mit ihren Spalten: eine Log-Zeile ist
`{ at, sceneId?, text, reviewed? }`, eine Idee `{ text, done? }`. Eine
Markdown-Zeile steht in keiner von beiden.
Sie ist die Referenz für Callouts und die einzige Quelle für Tests und E2E;
die Bodies werden deshalb nie umformatiert.

`grimoire seed <dir>` ist das Dev-/E2E-Werkzeug dazu: es liest `<dir>/<kampagne>/*.json` und
schreibt die Einträge über die Store-Schicht in eine Datenbank. Der Server
selbst seedet nichts — eine frische Instanz startet leer.
