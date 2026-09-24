# Grimoire — Datenmodell & Konventionen

Grimoire speichert eine Kampagne in einer SQLite-Datenbank
(`GRIMOIRE_DATA/grimoire.db`). Ein **Eintrag** ist eine Kampagne, ein
Kapitel, eine Szene, ein NPC oder ein Ort. Jeder Eintrag besteht aus
**Eigenschaften** — seinen strukturierten Feldern (Titel, Status, Ort, …) —
und einem **Text** in Markdown.

Dazu kommen fünf **Listen**, die keine Einträge sind und keinen Text haben
(ADR #26): die **Sessions**, die **Ideen**, das **Glossar**, das
**Kampagnenwissen** und die **offenen Fäden** eines Kapitels. Sie sind
Tabellen, werden als Listen gepflegt und haben keine Adresse — jede antwortet
auf ihren eigenen Endpoints.

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

Ein **Ort** hat keine Adresse: er ist seine eigene Ressource unter
`/api/campaigns/<kampagne>/locations/<id>`, in der App
`/campaigns/<kampagne>/locations/<id>` (ADR #31, siehe „Ort“ unten).

Die `id` entsteht beim Anlegen aus dem getippten Namen, nach genau einer
Regel (`@grimoire/shared/slug`), und steht damit fest: sie ist der
Referenz-Schlüssel in Adressen, Links und `[[id]]`-Referenzen und ändert sich
danach nie mehr (ADR #21). Der Eigenschaften-Dialog zeigt sie, bietet aber
keine Änderung.

Die Adresse einer Szene enthält ihren **Ort**. Ändert der DM den Ort einer
Szene, ändert sich ihre Adresse — die alte bleibt auflösbar, der Server
antwortet mit der aktuellen und die App ersetzt die URL.

Gegliedert wird die Kapitelübersicht davon nicht. Sie ist eine durchgehende
Liste in der **Reihenfolge, die der DM setzt** (ADR #27); der Ort steht mit
seinem Namen in der Metazeile der einzelnen Szene — hat eine Szene keinen,
fehlt dort schlicht der Ortsteil —, Eventualszenen stehen als eigener Block
am Ende. Diese Reihenfolge ist **keine Eigenschaft** — sie ist
eine Aussage des Kapitels über seine Szenen, nicht einer Szene über sich
selbst, und steht deshalb in keiner Feldtabelle dieses Dokuments. Gepflegt
wird sie über Hoch/Runter in der Kapitelübersicht; eine neue Szene landet am
Ende ihres Kapitels. Die Szenen eines Generator-Laufs behalten dabei die
Reihenfolge seiner Gliederung, auch wenn sie einzeln und durcheinander
übernommen werden (ADR #27).

**Sessions, Ideen, Glossar, Kampagnenwissen und offene Fäden haben keine
Adresse** — sie sind Tabellen, die als Listen gepflegt werden, und antworten
auf ihren eigenen Endpoints (ADR #26):

| Liste | Lesen | Schreiben |
| ----- | ----- | --------- |
| Session | `GET …/session[?includeEnded=1]` (die laufende, sonst `null`), `GET …/sessions`, `GET …/sessions/<id>` | `POST …/session/start`, `/end`, `/pause`, `/continue`, `/discard`, `POST …/log`, `PATCH …/sessions/<id>` |
| Ideen | `GET …/inbox` | `POST …/inbox`, `POST …/review/inbox-done` |
| Glossar | `GET …/glossary` | `PUT …/glossary` |
| Kampagnenwissen | `GET …/knowledge` | `PUT …/knowledge` |
| Offene Fäden (je Kapitel) | `GET …/chapters/<kapitel>/threads` | `POST …/chapters/<kapitel>/threads`, `PATCH …/threads/<id>`, `DELETE …/threads/<id>` |

Glossar und Kampagnenwissen bekommt der Generator als Kontext; beide werden
auf ihren eigenen Seiten gepflegt. Die Segmente `sessions`, `inbox` und
`glossary` bleiben trotzdem **reserviert**, damit kein Kapitel eine dieser ids
belegt und mit dem Pfad seiner Liste kollidiert. Die Fäden liegen unter
`…/chapters/<kapitel>/threads`, außerhalb der Eintrags-Pfade, und reservieren
nichts.

Alles Kampagnenabhängige hängt unter der Kampagne — in der API
`/api/campaigns/<kampagne>/…`, in der App `/campaigns/<kampagne>/…` (ADR #22).
Die Adresse steht dabei im Pfad: `GET
/api/campaigns/beispiel/entries/01-salzhafen/leuchtturm/ankunft-leuchtturm`
liest diesen Eintrag, `GET /api/campaigns/beispiel` den Kampagnen-Eintrag.
Kampagnenlos bleiben `/api/campaigns`, `/api/settings` und `/settings`.

## Eigenschaften

Die Eigenschaften eines Eintrags sind seine strukturierten Felder — alle
außer dem Text (`body`). Jede Entität hat ihren eigenen Typ aus genau
einem zod-Schema (ADR #31). Der **Ort** ist seine eigene Ressource mit seinen
eigenen Feldern (siehe „Ort“ unten); bei Kampagne, Kapitel, Szene und NPC
reisen die Felder gesammelt unter `properties`. Die App zeigt sie im
Eigenschaften-Dialog — das Prosa-Feld `motivation` (NPC) stattdessen auf der
Bearbeiten-Fläche des Eintrags, neben seinem Text —, und `PATCH
/api/campaigns/<kampagne>/entries/<adresse>` ändert genau die Felder, die der
DM angefasst hat; `null` löscht ein optionales Feld. Ein Feld, das die
Entität nicht kennt, legt die API nicht an (400).

Was eine Ansicht als Daten braucht, ist eine Eigenschaft oder eine Zeile einer
Liste, nie ein Abschnitt, der über seine Überschrift gefunden wird (ADR #29).

### Kampagne

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil |
| `name` | Anzeigename in der UI; fehlt er, ist der Anzeigename die id |
| `description` | Kurzbeschreibung, eine Zeile |

Der Text ist freier Notizraum für Kampagnenweites. Der Kopf der
Kapitelübersicht zeigt ihn unter der Kurzbeschreibung: ganz und gerendert, auf
wenige Zeilen begrenzt und aufklappbar. Ohne Text steht dort nichts.

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

Der Text ist die Beschreibung des Kapitels — worum es geht und was die Gruppe
erreichen soll. Die Kapitelübersicht zeigt ihn unter dem Titel, ganz und
gerendert wie jeder Text, auf wenige Zeilen begrenzt und aufklappbar; ob und
welche Überschriften er hat, ändert daran nichts (ADR #29). Die Beschreibung
aus „Kapitel anlegen“ wird der Text so, wie sie getippt wurde, ohne Überschrift
davor; ein Lauf „Neues Kapitel“ legt sein Kapitel mit der Beschreibung aus
seiner Gliederung an (siehe Generator).

Die **offenen Fäden** — die Handlungsstränge, die das Kapitel trägt — sind
kein Text, sondern eine **Liste am Kapitel** (ADR #29). Eine Zeile ist
`{ id, text, done }`: `id` ist eine opake, stabile Kennung, `text` eine Zeile,
`done` das Häkchen. Jeder Endpoint der Liste antwortet mit der ganzen Liste in
ihrer Reihenfolge und ihrem eigenen Wächter-Token:
`{ entries: [{ id, text, done }], rev }`. Das `rev` ist `chapters.threads_rev`
— nicht das `rev` des Kapitel-Eintrags: ein Schreibzugriff auf die Liste
ändert weder den Kapiteltext noch dessen Wächter, und ein Kapitel-Write bewegt
die Liste nicht.

- Anhängen (`POST …/threads { text }`) setzt die Zeile ans Ende und trägt
  **kein** `rev` — es kann nichts überschreiben, wie eine Idee oder eine
  Log-Zeile.
- Abhaken, Wiederöffnen, Umformulieren (`PATCH …/threads/<id> { rev, text?,
  done? }`) und Löschen (`DELETE …/threads/<id> { rev }`) benennen die Zeile
  per `id` und tragen das `rev` der Liste. Ein veraltetes ist 409
  `rev_conflict` mit der aktuellen Liste unter `threads`; eine `id`, die die
  Liste nicht hält, ist 404.
- Ein `## Offene Fäden` im Text eines älteren Kapitels bleibt freier Text;
  nichts liest ihn als Liste.

### Szene

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil, wird referenziert (`scenes_played`, Log) |
| `title` | Anzeigename, frei änderbar |
| `type` | `planned` oder `contingency` (Eventualszene) |
| `trigger` | nur bei `contingency`: wann feuert sie? Freitext |
| `chapter` | Kapitel-id; muss existieren |
| `location` | Orts-id; bestimmt die Adresse der Szene |
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
| `motivation` | was die Figur will, ein bis drei Sätze — zeigen NPC-Karte und Vorschau (Beschriftung „Will“) |

`motivation` wird auf der Bearbeiten-Fläche des Eintrags gepflegt, nicht im
Eigenschaften-Dialog. Ein `[[id]]` darin erscheint bei der Anzeige als
aktueller Name, wie im Text — eine Anzeige, keine Referenz.

Text-Abschnitte frei; empfohlen: `## Weiß` (`[!secret]`-Callouts),
`## Beziehungen` (je Gegenpart eine Zeile; einen Gegenpart verlinkt `[[id]]`
wie überall im Text). Keine Überschrift hat für die App eine Bedeutung.

Kleinst-NPCs bekommen keinen Eintrag, bis sie wiederkehren. Bis dahin: Zeile
im Szenentext oder `#npc`-Notiz im Log.

### Ort

Ein Ort ist seine eigene Ressource mit seinem eigenen Typ (`Location`, aus
dem zod-Schema in `shared/src/location.ts`, ADR #31):

| Lesen/Ändern | Anlegen/Liste | App-Route |
| ------------ | ------------- | --------- |
| `GET/PATCH /api/campaigns/<kampagne>/locations/<id>` | `GET/POST /api/campaigns/<kampagne>/locations` | `/campaigns/<kampagne>/locations/<id>`, Liste `/campaigns/<kampagne>/locations` |

`GET` antwortet mit dem Ort selbst — ohne `kind`, ohne `path`, alle Felder
nebeneinander:

```json
{
  "id": "leuchtturm",
  "name": "Der Leuchtturm von Salzhafen",
  "chapter": "01-salzhafen",
  "roll20Page": "Leuchtturm",
  "atmosphere": "Verlassen in Eile, nicht im Kampf.",
  "body": "\n## Beim ersten Betreten\n\n…",
  "rev": 3
}
```

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil, wird referenziert |
| `name` | Anzeigename, Pflicht; ohne eigenen Namen zeigt der Ort seine id |
| `chapter` | Kapitel-id, optional; muss existieren |
| `roll20Page` | Verweis auf die Roll20-Seite, keine Karten-Kopie; optional |
| `atmosphere` | was der Ort über sich verrät, ein bis drei Sätze — zeigen Ort-Karte und Vorschau; optional |
| `body` | Markdown des Orts |
| `rev` | Zeilenversion, der Wächter jedes Schreibzugriffs |

Ein optionales Feld ohne Wert fehlt in der Antwort. Geschrieben wird mit
`PATCH …/locations/<id>` und `{ rev, force?, …Teilmenge von name, chapter,
roll20Page, atmosphere, body }` — `null` löscht ein optionales Feld, ein Feld,
das ein Ort nicht hat (etwa `status`), oder ein Wert der falschen Form ist
eine 400, die das Feld nennt; ein veralteter `rev` ist 409 mit dem aktuellen
Ort. `POST …/locations` legt einen Ort an und antwortet mit ihm. Fixture und
Generator-Vorschlag sind der Ort ohne `rev`. Ergänzen hängt am Ort: `POST
…/locations/<id>/augment` startet den Lauf, `POST …/locations/<id>/augment/apply`
übernimmt ihn.

`atmosphere` wird wie `motivation` auf der Bearbeiten-Fläche gepflegt, neben
dem Markdown, und ein `[[id]]` darin erscheint als Name. Ohne `atmosphere`
zeigt die Ort-Karte die Roll20-Seite.

Text-Abschnitte frei; empfohlen: `## Beim ersten Betreten` (mit
`[!readaloud]`), `## Wer ist hier` (Figuren am Ort, mit id als `[[id]]`).

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

`location:` verlangt eine id in Slug-Form (400 sonst) — sie ist zugleich das
mittlere Segment der Szenen-Adresse. Jede Szene gehört zu einem Kapitel;
`chapter:` lässt sich nicht leeren.

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
- Überfahren oder Tastatur-Fokus zeigt eine kurze **Vorschau** des Ziels
  (Art, Status und die Zeilen der Kompakt-Karte); ein `[[id]]` in deren
  Auszug steht dort — wie auf den NPC- und Ort-Karten — als Name. Auf
  Touch-Geräten gibt es keine Vorschau.
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

- „Als Handlungsstrang übernehmen" hängt eine Zeile an die offenen Fäden des
  aktiven Kapitels an (`POST …/chapters/<kapitel>/threads`); Text und `rev`
  des Kapitels bleiben unberührt. Gepflegt wird die Liste in der
  Kapitelübersicht: abhaken, umformulieren, löschen, von Hand ergänzen.
- „NPC anlegen" erzeugt den NPC `npcs/<id>` mit `status: unknown` (die
  Log-Zeile sagt nichts über seinen Zustand); sein Text ist genau der
  Log-Text, ohne Überschrift. Ohne Text bleibt er leer, und ein NPC ohne Name
  und Text gilt weiter als leer — ein späteres Anlegen derselben id füllt
  ihn. Hat die id schon einen Eintrag mit Inhalt, verweist die App auf ihn
  und ändert nichts; ein leerer Eintrag wird gefüllt.
- „Idee abhaken" setzt `done` auf der genannten Zeile (`POST
  …/review/inbox-done { id }`) — die eine Ausnahme vom Append-only der Ideen,
  damit sie nicht in jeder künftigen Nachbereitung wieder auftauchen.

## Schreibregeln

- Geschrieben wird ausschließlich über die API (jeder Endpoint ist in
  `server/src/routes/api.ts` an seiner Route dokumentiert): Log, Ideen,
  Nachbereitung, Generator-Entwürfe — und für einen Eintrag der eine
  Schreibweg `PATCH /api/campaigns/<kampagne>/entries/<adresse>`, der
  Eigenschaften, Text oder beides in einem Zug schreibt (ADR #23).
  Glossar, Kampagnenwissen, Ideen und offene Fäden sind Listen und werden
  über ihre eigenen Endpoints gepflegt; einen Text nehmen sie nicht an.
- Konfliktschutz: jeder Schreibzugriff trägt die Zeilenversion `rev` mit, die
  der Lesevorgang geliefert hat. Passt sie nicht mehr, antwortet der Server
  409 und die App sagt „Inzwischen geändert — neu laden" statt still zu
  überschreiben.
- Die **Szenenreihenfolge** eines Kapitels hat ihren eigenen Schreibweg und
  ihren eigenen Wächter: `PUT
  /api/campaigns/<kampagne>/chapters/<kapitel>/scene-order` mit
  `{ scenes, rev }`, wobei `scenes` die vollständige Liste der Szenen-ids
  dieses Kapitels ist (sonst 400). Das `rev` ist `scene_order_rev`, das der
  Kapitel-Knoten mitliefert — nicht der `rev` einer Szene und nicht der des
  Kapitel-Eintrags; passt es nicht, ist das 409. Geschrieben wird nur die
  Reihenfolge: weder `scenes.rev` noch `chapters.rev` bewegen sich, damit ein
  offener Szenen- oder Kapitel-Editor durch ein Umsortieren nicht in einen
  Konflikt läuft (ADR #27). Dieselbe Bauart haben die Wächter der übrigen
  Listen (`glossaryRev`, `inboxRev`, `knowledgeRev`, `chapters.threads_rev`).
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
angezeigt. Legt der Lauf sein Kapitel neu an, beschreibt die Gliederung es aus
dem Quellmaterial; „Entwürfe prüfen“ zeigt diese Beschreibung, und das
Übernehmen legt das Kapitel mit ihr als Text an. Den Text eines bestehenden
Kapitels ändert kein Lauf.

**Jeder** Aufruf antwortet mit einem JSON-Objekt, dessen Schema der Server
über die Provider-API **erzwingt**. Ein Orts-Aufruf (Anlegen wie Ergänzen)
liefert den Ort ohne `rev`, alle Felder nebeneinander, dazu die Hinweise für
den DM unter `warnings`; der Ort leitet sein Schema selbst aus seinem
zod-Schema ab (`z.toJSONSchema`, ADR #31), und was das Modell über seine
Felder wissen muss, steht im Orts-Prompt (`generator/location-system-prompt.md`).
Ein Job listet die vorgeschlagenen Orte unter `result.locations`. Ein Aufruf für Szene, NPC oder
eine ihrer Ergänzungen liefert die Eigenschaften von Szene bzw. NPC getypt unter
`properties`, den Text als einen String unter `body` und `warnings`; dieses
Paar ist der **Entwurf** — im Prüfschritt, in den Änderungen des DM und beim
Übernehmen (ADR #24), nie ein Markdown-Text mit Eigenschaften davor. Die
Schemata von Szene und NPC liegen als lesbares JSON in `shared/schema/`;
Details in `generator/README.md`.

Die mechanische Prüfung liest Eigenschaften und Text, aber keine
Überschrift (ADR #29): die Abschnitte eines Entwurfs sind die Empfehlung der
Prompts. Jedes `[[id]]` in einem erzeugten Text nennt einen Eintrag der
Kampagne (NPC, Ort, Szene) oder einen Vorschlag desselben Laufs, sonst geht
die Antwort als Korrektur-Turn zurück. Im Ergänzen-Lauf gilt das für die
Verweise, die der Vorschlag neu bringt; was im bestehenden Text schon steht,
bleibt dem DM. Ein `[[id]]` im Code zählt wie überall nicht als Verweis.

## Fixtures

Die Beispielkampagne liegt als JSON unter `fixtures/beispiel/` — ein Eintrag
je Datei, genau in der Form, die die API spricht: `kind`, die
strukturierten Felder und der Text als ein String unter `body`. Ein Ort
liegt in einer eigenen Datei unter `fixtures/beispiel/locations/<id>.json`,
genau als das Objekt, das `GET …/locations/<id>` liefert, ohne `rev` (ADR
#31); Kampagne, Kapitel, Szene und NPC tragen ihre Felder unter
`properties`. Ideen, Glossar
und Sessions tragen ihre Listen ebenso strukturiert,
als Zeilen mit ihren Spalten, und ein Kapitel seine offenen Fäden unter
`threads`: eine Log-Zeile ist `{ at, sceneId?, text, reviewed? }`, eine Idee
wie ein Faden `{ text, done? }`. Eine Markdown-Zeile steht in keiner davon.
Sie ist die Referenz für Callouts und die einzige Quelle für Tests und E2E;
die Bodies werden deshalb nie umformatiert.

`grimoire seed <dir>` ist das Dev-/E2E-Werkzeug dazu: es liest `<dir>/<kampagne>/*.json` samt `<dir>/<kampagne>/locations/*.json` und
schreibt die Einträge über die Store-Schicht in eine Datenbank. Der Server
selbst seedet nichts — eine frische Instanz startet leer.
