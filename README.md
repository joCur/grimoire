# Grimoire — Datenmodell & Konventionen

Grimoire speichert eine Kampagne in einer SQLite-Datenbank
(`GRIMOIRE_DATA/grimoire.db`). Ein **Eintrag** ist eine Kampagne, ein
Kapitel, eine Szene, ein NPC oder ein Ort. Jeder Eintrag besteht aus
**Eigenschaften** — seinen strukturierten Feldern (Titel, Status, Ort, …) —
und einem **Text** in Markdown.

Ein **Faden** — ein Handlungsstrang, den ein Kapitel trägt —, eine
**Idee**, ein **Glossar-Begriff** und das **Kampagnenwissen** — jede
Namenskonvention, jeder Fakt, jede Stilregel für sich — haben keinen Text; jeder ist seine eigene Ressource mit
seinen eigenen Feldern (ADR #31). Dazu kommen die **Sessions**: Zeilen mit
ihren Listen, ohne Adresse, auf ihren eigenen Endpoints.

Die Speicherform steht genau einmal in `server/src/db/schema.ts`; dieses
README beschreibt, was in den Feldern stehen darf und was der Text
enthalten kann. Alle Feldnamen sind Englisch (stabil, maschinenlesbar), alle
Inhalte Deutsch.

Grundprinzip: **Das Format degradiert, es validiert nicht.** Eine unbekannte
Überschrift oder ein unbekannter Callout im Text wird als normaler Text
gezeigt; nichts bricht.

## Ressourcen

Jede Entität ist ihre eigene **Ressource** mit ihrem eigenen Typ aus genau
einem zod-Schema in `shared/src/<entität>.ts` (ADR #31). Die URL nennt die
Entität und ihre `id`; eine Antwort trägt alle Felder der Entität
nebeneinander, `body` eingeschlossen, ohne `kind`, ohne `path`:

| Entität | Lesen/Ändern | Anlegen/Liste | App-Route |
| ------- | ------------ | ------------- | --------- |
| Kampagne | `GET/PATCH /api/campaigns/<kampagne>` | `POST /api/campaigns` | `/campaigns/<kampagne>` |
| Kapitel | `GET/PATCH /api/campaigns/<kampagne>/chapters/<id>` | `GET/POST /api/campaigns/<kampagne>/chapters` | `/campaigns/<kampagne>/chapters/<id>` |
| Szene | `GET/PATCH /api/campaigns/<kampagne>/scenes/<id>` | `GET/POST /api/campaigns/<kampagne>/scenes` | `/campaigns/<kampagne>/scenes/<id>` |
| NPC | `GET/PATCH /api/campaigns/<kampagne>/npcs/<id>` | `GET/POST /api/campaigns/<kampagne>/npcs` | `/campaigns/<kampagne>/npcs/<id>` |
| Ort | `GET/PATCH /api/campaigns/<kampagne>/locations/<id>` | `GET/POST /api/campaigns/<kampagne>/locations` | `/campaigns/<kampagne>/locations/<id>` |
| Faden | `GET/PATCH/DELETE /api/campaigns/<kampagne>/threads/<id>` | `GET/POST /api/campaigns/<kampagne>/threads` | in der Kapitelübersicht `/campaigns/<kampagne>` |
| Idee | `GET/PATCH /api/campaigns/<kampagne>/ideas/<id>` | `GET/POST /api/campaigns/<kampagne>/ideas` | in der Nachbereitung und auf der Mobil-Startfläche |
| Glossar-Begriff | `GET/PATCH/DELETE /api/campaigns/<kampagne>/glossary-terms/<id>` | `GET/POST /api/campaigns/<kampagne>/glossary-terms` | auf der Glossar-Seite `/campaigns/<kampagne>/glossary` |
| Kampagnenwissen | `GET/PATCH/DELETE /api/campaigns/<kampagne>/knowledge-items/<id>` | `GET/POST /api/campaigns/<kampagne>/knowledge-items` | auf der Wissens-Seite `/campaigns/<kampagne>/knowledge` |

Die Kapitelübersicht bleibt `/campaigns/<kampagne>`; die Liste der Kampagnen
(`GET /api/campaigns`) antwortet mit ihrer eigenen Form, dem Namen neben der
jüngsten Session.

Die `id` entsteht beim Anlegen aus dem getippten Namen, nach genau einer
Regel (`@grimoire/shared/slug`), und steht damit fest: sie ist der
Referenz-Schlüssel in URLs, Links und `[[id]]`-Referenzen und ändert sich
danach nie mehr (ADR #21). Der Eigenschaften-Dialog zeigt sie, bietet aber
keine Änderung.

Die Kapitelübersicht ist eine durchgehende Liste der Szenen eines Kapitels
in der **Reihenfolge, die der DM setzt** (ADR #27); der Ort steht mit
seinem Namen in der Metazeile der einzelnen Szene — hat eine Szene keinen,
fehlt dort schlicht der Ortsteil —, Eventualszenen stehen als eigener Block
am Ende. Diese Reihenfolge ist **kein Feld** — sie ist
eine Aussage des Kapitels über seine Szenen, nicht einer Szene über sich
selbst, und steht deshalb in keiner Feldtabelle dieses Dokuments. Gepflegt
wird sie über Hoch/Runter in der Kapitelübersicht; eine neue Szene landet am
Ende ihres Kapitels. Die Szenen eines Generator-Laufs behalten dabei die
Reihenfolge seiner Gliederung, auch wenn sie einzeln und durcheinander
übernommen werden (ADR #27).

**Sessions** antworten auf ihren eigenen Endpoints:

| Lesen | Schreiben |
| ----- | --------- |
| `GET …/session[?includeEnded=1]` (die laufende, sonst `null`), `GET …/sessions`, `GET …/sessions/<id>` | `POST …/session/start`, `/end`, `/pause`, `/continue`, `/discard`, `POST …/log`, `PATCH …/sessions/<id>` |

Glossar-Begriffe und Kampagnenwissen bekommt der Generator als Kontext; beide
werden auf ihren eigenen Seiten gepflegt.

Alles Kampagnenabhängige hängt unter der Kampagne — in der API
`/api/campaigns/<kampagne>/…`, in der App `/campaigns/<kampagne>/…` (ADR #22).
Kampagnenlos bleiben `/api/campaigns`, `/api/settings` und `/settings`.

## Felder

Was eine Ansicht als Daten braucht, ist ein Feld einer Entität oder eine
Zeile einer Liste, nie ein Abschnitt, der über seine Überschrift gefunden
wird (ADR #29).

Geschrieben wird jede Entität mit `PATCH` auf ihrer Ressource und
`{ rev, force?, …Teilmenge der Felder }`: nur die genannten Felder ändern
sich, `null` löscht ein optionales Feld, und ein Feld, das die Entität nicht
kennt, oder ein Wert der falschen Form ist eine 400, die das Feld nennt. Ein
veralteter `rev` ist 409 mit dem aktuellen Stand der Ressource.

### Kampagne

Die Kampagne ist ihre eigene Ressource mit ihrem eigenen Typ (`Campaign`, aus
dem zod-Schema in `shared/src/campaign.ts`, ADR #31). `GET
/api/campaigns/<kampagne>` antwortet mit ihr:

```json
{
  "id": "beispiel",
  "name": "Der Leuchtturm von Salzhafen",
  "description": "Eine Küstenkampagne um einen erloschenen Leuchtturm, …",
  "body": "\nKampagnenweite Notizen: …",
  "glossaryIntro": "",
  "rev": 1
}
```

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil, der Schlüssel in jeder URL |
| `name` | Anzeigename in der UI; fehlt er, ist der Anzeigename die id |
| `description` | Kurzbeschreibung, eine Zeile; optional |
| `body` | Markdown der Kampagne: freier Notizraum für Kampagnenweites |
| `glossaryIntro` | Markdown über den Glossar-Begriffen, das zu keinem Begriff gehört; leer, wenn es keines gibt |
| `rev` | Zeilenversion, der Wächter jedes Schreibzugriffs |

Geschrieben wird mit `PATCH /api/campaigns/<kampagne>` und `{ rev, force?,
…Teilmenge von name, description, body, glossaryIntro }` — `null` löscht die
Beschreibung, ein veralteter `rev` ist 409 mit der aktuellen Kampagne.
`glossaryIntro` wird gespeichert wie `body`. Die Reihenfolge des
Kampagnenwissens hat ihren eigenen Wächter an der Kampagne (siehe
Kampagnenwissen); ein Schreibzugriff auf die Kampagne bewegt ihn nicht.
`POST /api/campaigns { name, description?, id? }` legt eine Kampagne an und
antwortet mit ihr: die `id` entsteht aus dem Namen, wenn die Anfrage keine
setzt, und eine vergebene ist eine 409 `slug_taken` mit Vorschlag. Die
Fixture ist die Kampagne ohne `rev`.

Der Kopf der Kapitelübersicht zeigt den Text unter der Kurzbeschreibung:
ganz und gerendert, auf wenige Zeilen begrenzt und aufklappbar. Ohne Text
steht dort nichts.

### Kapitel

Ein Kapitel ist seine eigene Ressource mit seinem eigenen Typ (`Chapter`, aus
dem zod-Schema in `shared/src/chapter.ts`, ADR #31). `GET
/api/campaigns/<kampagne>/chapters/<id>` antwortet mit ihm:

```json
{
  "id": "01-salzhafen",
  "title": "Kapitel 1: Der Leuchtturm von Salzhafen",
  "status": "active",
  "body": "Herausfinden, warum das Leuchtfeuer seit drei Nächten erloschen ist.\n",
  "rev": 1
}
```

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil; das Feld `chapter` einer Szene, eines NPC und eines Orts nennt es |
| `title` | Anzeigename; ohne eigenen Titel zeigt das Kapitel seine id |
| `status` | `planned`, `active` oder `done`; optional |
| `body` | Markdown des Kapitels: worum es geht und was die Gruppe erreichen soll |
| `rev` | Zeilenversion, der Wächter jedes Schreibzugriffs |

`active` markiert das **eine** Kapitel, das die Session-Ansicht öffnet: je
Kampagne ist höchstens ein Kapitel aktiv. Aktiviert wird mit `PATCH
…/chapters/<id> { rev, status: "active" }` oder mit `POST …/chapters` und
`status: "active"`; der Server setzt das bisher aktive Kapitel im selben
Vorgang auf `planned`, und dessen `rev` bewegt sich mit. Die API schreibt nur
diese drei Werte (400 `status_not_allowed` sonst), und die Spalte selbst
lässt keinen anderen zu — `status` ist ein `CHECK`-Constraint (DECISIONS
#25), kein degradierendes Freitextfeld. `null` löscht den Status.

Geschrieben wird mit `PATCH …/chapters/<id>` und `{ rev, force?, …Teilmenge
von title, status, body }`; ein veralteter `rev` ist 409 mit dem aktuellen
Kapitel. Weder die Szenenreihenfolge noch ein Faden des Kapitels bewegt sich
dabei — jede hat ihren eigenen Wächter. `POST …/chapters { title, id?,
status?, body? }` legt ein Kapitel an und antwortet mit ihm: die `id` entsteht
aus dem Titel, wenn die Anfrage keine setzt, der Status ist `planned`, wenn
sie keinen nennt, und das Kapitel steht am Ende der Kampagne. Der `body` aus
„Kapitel anlegen“ wird der Text so, wie er getippt wurde — getrimmt, mit
einem abschließenden Zeilenumbruch, ohne Überschrift davor. Eine vergebene
`id` ist eine 409 `slug_taken` mit Vorschlag. Die Fixture ist das Kapitel
ohne `rev`; ein Lauf „Neues Kapitel“ legt sein Kapitel als `planned` mit der
Beschreibung aus seiner Gliederung als `body` an (siehe Generator).

Die Kapitelübersicht zeigt den Text unter dem Titel, ganz und gerendert wie
jeder Text, auf wenige Zeilen begrenzt und aufklappbar; ob und welche
Überschriften er hat, ändert daran nichts (ADR #29).

Die **Fäden** — die Handlungsstränge, die das Kapitel trägt — sind weder
Text noch Feld des Kapitels, sondern jeder seine eigene Ressource, die ihr
Kapitel nennt (siehe Faden). Ein `## Offene Fäden` im Text eines älteren
Kapitels bleibt freier Text; nichts liest ihn als Faden.

### Szene

Eine Szene ist ihre eigene Ressource mit ihrem eigenen Typ (`Scene`, aus dem
zod-Schema in `shared/src/scene.ts`, ADR #31). Sie liegt flach unter ihrer
Kampagne: ihre `id` ist je Kampagne eindeutig, und ihr Kapitel ist ein Feld,
das sich ändern kann.

| Lesen/Ändern | Anlegen/Liste | App-Route |
| ------------ | ------------- | --------- |
| `GET/PATCH /api/campaigns/<kampagne>/scenes/<id>` | `GET/POST /api/campaigns/<kampagne>/scenes` | `/campaigns/<kampagne>/scenes/<id>` |

`GET` antwortet mit der Szene selbst — ohne `kind`, ohne `path`, alle Felder
nebeneinander:

```json
{
  "id": "lighthouse-arrival",
  "title": "Ankunft am Leuchtturm",
  "type": "planned",
  "chapter": "01-salzhafen",
  "location": "leuchtturm",
  "npcs": ["jorna"],
  "handouts": ["Karte von Salzhafen"],
  "tags": ["social", "travel"],
  "status": "ready",
  "body": "\n## Flow\n\n…",
  "rev": 1
}
```

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil, wird referenziert (`scenesPlayed`, `sceneId` einer Log-Zeile, `[[id]]`) |
| `title` | Anzeigename, frei änderbar; ohne eigenen Titel zeigt die Szene ihre id |
| `type` | `planned` oder `contingency` (Eventualszene) |
| `trigger` | nur bei `contingency`: wann feuert sie? Freitext; optional |
| `chapter` | Kapitel-id; immer gesetzt, muss existieren |
| `location` | Orts-id, wo die Szene spielt; optional, muss existieren |
| `npcs` | Liste von NPC-ids in ihrer Reihenfolge; jede muss existieren |
| `handouts` | Namen der Roll20-Handouts, nur Verweis |
| `tags` | frei; empfohlen: `combat`, `social`, `stealth`, `travel` |
| `status` | `draft`, `ready`, `played` oder `dropped`; immer gesetzt |
| `body` | Markdown der Szene |
| `rev` | Zeilenversion, der Wächter jedes Schreibzugriffs |

Ein optionales Feld ohne Wert fehlt in der Antwort; die drei Listen stehen
immer da, leer, wenn die Szene nichts nennt. Geschrieben wird mit `PATCH
…/scenes/<id>` und `{ rev, force?, …Teilmenge der Felder }` — `null` löscht
`trigger` oder `location`, ein Feld, das eine Szene nicht hat, oder ein Wert
der falschen Form ist eine 400, die das Feld nennt, ein `status` außerhalb
der vier eine 400 `status_not_allowed`, ein `type` außerhalb der zwei eine
400 `scene_type_not_allowed`. Das Kapitel lässt sich wechseln, aber nicht
leeren (400 `chapter_required`); wechselt eine Szene das Kapitel, landet sie
am Ende des Zielkapitels. Ein veralteter `rev` ist 409 mit der aktuellen
Szene. Wo sie in ihrem Kapitel steht, ist kein Feld der Szene, sondern die
Szenenreihenfolge des Kapitels (siehe Schreibregeln).

`POST …/scenes { title, chapter, id? }` legt eine Szene an und antwortet mit
ihr: die `id` entsteht aus dem Titel, wenn die Anfrage keine setzt, das
Kapitel muss existieren, und die Szene steht als `draft` am Ende ihres
Kapitels. Eine vergebene `id` ist eine 409 `slug_taken` mit Vorschlag.
Fixture und Generator-Vorschlag sind die Szene ohne `rev`. Ergänzen hängt an
der Szene: `POST …/scenes/<id>/augment` startet den Lauf, `POST
…/scenes/<id>/augment/apply` übernimmt ihn.

### NPC

Ein NPC ist seine eigene Ressource mit seinem eigenen Typ (`Npc`, aus dem
zod-Schema in `shared/src/npc.ts`, ADR #31):

| Lesen/Ändern | Anlegen/Liste | App-Route |
| ------------ | ------------- | --------- |
| `GET/PATCH /api/campaigns/<kampagne>/npcs/<id>` | `GET/POST /api/campaigns/<kampagne>/npcs` | `/campaigns/<kampagne>/npcs/<id>` |

`GET` antwortet mit dem NPC selbst — ohne `kind`, ohne `path`, alle Felder
nebeneinander:

```json
{
  "id": "jorna",
  "name": "Hafenmeisterin Jorna",
  "role": "Auftraggeberin, Hafenmeisterin von Salzhafen",
  "chapter": "01-salzhafen",
  "status": "alive",
  "statblock": "Roll20: Jorna",
  "quickstats": { "insight": 2, "passive-perception": 12 },
  "voice": "knapp, wetterrau, duzt jeden",
  "appearance": "Ölmantel, graue Flechte, fehlender kleiner Finger links",
  "motivation": "Das Leuchtfeuer muss wieder brennen, …",
  "body": "\n## Weiß\n\n…",
  "rev": 4
}
```

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil, wird referenziert |
| `name` | Anzeigename, Pflicht; ohne eigenen Namen zeigt der NPC seine id |
| `role` | Einzeiler; optional |
| `chapter` | Kapitel-id, wo eingeführt; optional, muss existieren |
| `status` | `alive`, `dead`, `missing` oder `unknown`; immer gesetzt |
| `statblock` | Verweis auf das Roll20-Sheet (`"Roll20: <Sheet-Name>"`), keine Kopie; optional |
| `quickstats` | Kurzwerte, frei — nur was am Tisch sozial gebraucht wird (`{ "insight": "+2" }`); optional |
| `voice` | wie klingt er/sie; optional |
| `appearance` | ein bis zwei Merkmale; optional |
| `motivation` | was die Figur will, ein bis drei Sätze — zeigen NPC-Karte und Vorschau (Beschriftung „Will“); optional |
| `body` | Markdown des NPC |
| `rev` | Zeilenversion, der Wächter jedes Schreibzugriffs |

Ein optionales Feld ohne Wert fehlt in der Antwort. Geschrieben wird mit
`PATCH …/npcs/<id>` und `{ rev, force?, …Teilmenge der Felder }` — `null`
löscht ein optionales Feld, ein Feld, das ein NPC nicht hat (etwa
`atmosphere`), oder ein Wert der falschen Form ist eine 400, die das Feld
nennt, ein `status` außerhalb der vier eine 400 `status_not_allowed`; ein
veralteter `rev` ist 409 mit dem aktuellen NPC.

`POST …/npcs { name, id?, body? }` legt einen NPC an und antwortet mit ihm:
die `id` entsteht aus dem Namen, wenn die Anfrage keine setzt, `body` ist
sein Text, und `status` ist `unknown`. Ein NPC, der unter der `id` schon
besteht und nichts hält als seine id, wird mit Name und Text gefüllt; einer
mit Inhalt ist eine 409 `slug_taken` mit Vorschlag, und nichts wird
geschrieben. Fixture und Generator-Vorschlag sind der NPC ohne `rev`.
Ergänzen hängt am NPC: `POST …/npcs/<id>/augment` startet den Lauf, `POST
…/npcs/<id>/augment/apply` übernimmt ihn.

`motivation` wird auf der Bearbeiten-Fläche gepflegt, neben dem Markdown,
nicht im Eigenschaften-Dialog. Ein `[[id]]` darin erscheint bei der Anzeige
als aktueller Name, wie im Text — eine Anzeige, keine Referenz.

Text-Abschnitte frei; empfohlen: `## Weiß` (`[!secret]`-Callouts),
`## Beziehungen` (je Gegenpart eine Zeile; einen Gegenpart verlinkt `[[id]]`
wie überall im Text). Keine Überschrift hat für die App eine Bedeutung.

Kleinst-NPCs bekommen keinen NPC, bis sie wiederkehren. Bis dahin: Zeile
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

`atmosphere` wird wie `motivation` beim NPC auf der Bearbeiten-Fläche
gepflegt, neben dem Markdown, und ein `[[id]]` darin erscheint als Name. Ohne `atmosphere`
zeigt die Ort-Karte die Roll20-Seite.

Text-Abschnitte frei; empfohlen: `## Beim ersten Betreten` (mit
`[!readaloud]`), `## Wer ist hier` (Figuren am Ort, mit id als `[[id]]`).

### Faden

Ein Faden ist ein Handlungsstrang, den ein Kapitel trägt, und seine eigene
Ressource mit seinem eigenen Typ (`Thread`, aus dem zod-Schema in
`shared/src/thread.ts`, ADR #31). Er liegt flach unter der Kampagne, sein
Kapitel ist ein Feld: `GET /api/campaigns/<kampagne>/threads/<id>` antwortet
mit ihm.

```json
{
  "id": "wer-bezahlt-die-schmuggler",
  "chapter": "01-salzhafen",
  "text": "Wer bezahlt die Schmuggler?",
  "done": false,
  "rev": 1
}
```

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil und opak, vergibt der Server beim Anlegen |
| `chapter` | Kapitel-id, Pflicht; muss existieren (400 `chapter_unknown` sonst) |
| `text` | der Handlungsstrang, eine Zeile |
| `done` | abgehakt oder offen |
| `rev` | Zeilenversion, der Wächter jedes Schreibzugriffs |

- `GET …/threads` antwortet mit allen Fäden der Kampagne, `GET
  …/threads?chapter=<kapitel>` mit denen eines Kapitels — in der Reihenfolge,
  in der sie angelegt wurden. Umsortiert wird nichts.
- `POST …/threads { chapter, text }` legt einen offenen Faden am Ende an und
  antwortet mit ihm (201); er trägt **kein** `rev`, denn ein neuer Faden
  überschreibt nichts. Der Text ist eine Zeile: getrimmt, Zeilenumbrüche
  werden zu Leerzeichen, leer ist 400.
- Abhaken, Wiederöffnen, Umformulieren und der Wechsel des Kapitels sind
  `PATCH …/threads/<id> { rev, force?, …Teilmenge von chapter, text, done }`;
  gelöscht wird mit `DELETE …/threads/<id> { rev }` (204). Ein veralteter
  `rev` ist 409 mit dem aktuellen Faden unter `thread`, eine unbekannte id
  404, ein Feld, das ein Faden nicht hat, eine 400, die es nennt.
- Kein Schreibzugriff auf einen Faden berührt Text oder `rev` seines
  Kapitels, und ein Kapitel-Write bewegt keinen Faden. Gepflegt werden die
  Fäden in der Kapitelübersicht unter dem Text des Kapitels: anlegen,
  abhaken, umformulieren, löschen. Die Nachbereitung legt sie an
  („Als Handlungsstrang übernehmen").

### Idee

Eine Idee ist ein Einfall, den der DM unterwegs einwirft, und ihre eigene
Ressource mit ihrem eigenen Typ (`Idea`, aus dem zod-Schema in
`shared/src/idea.ts`, ADR #31). `GET /api/campaigns/<kampagne>/ideas/<id>`
antwortet mit ihr:

```json
{
  "id": "dorfschmied",
  "text": "Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug #thread",
  "done": false,
  "rev": 1
}
```

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil und opak, vergibt der Server beim Anlegen |
| `text` | die Idee, wie sie getippt wurde, Hashtags eingeschlossen; eine Zeile |
| `done` | abgehakt oder offen |
| `rev` | Zeilenversion, der Wächter jedes Schreibzugriffs |

- `GET …/ideas` antwortet mit allen Ideen in der Reihenfolge, in der sie
  eingeworfen wurden, abgehakte eingeschlossen; keine Ideen sind eine leere
  Liste (200).
- `POST …/ideas { text }` legt eine offene Idee am Ende an und antwortet mit
  ihr (201), ohne `rev`.
- Abhaken ist `PATCH …/ideas/<id> { rev, force?, done }`. Der Text einer Idee
  wird einmal geschrieben: `done` ist das einzige Feld, das ein `PATCH` trägt,
  jedes andere — `text` eingeschlossen — ist eine 400, die es nennt. Ein
  veralteter `rev` ist 409 mit der aktuellen Idee unter `idea`, eine
  unbekannte id 404.

### Glossar-Begriff

Ein Glossar-Begriff ist ein Begriff des Quellmaterials und die Schreibweise
dieser Kampagne, seine eigene Ressource mit seinem eigenen Typ
(`GlossaryTerm`, aus dem zod-Schema in `shared/src/glossary-term.ts`,
ADR #31). `GET /api/campaigns/<kampagne>/glossary-terms/<id>` antwortet mit
ihm:

```json
{
  "id": "lighthouse-keeper",
  "term": "lighthouse keeper",
  "explanation": "Leuchtturmwärter",
  "rev": 1
}
```

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil und opak, vergibt der Server beim Anlegen |
| `term` | der Begriff, wie das Quellmaterial ihn schreibt; je Kampagne einmal |
| `explanation` | wie diese Kampagne ihn sagt; darf mehrere Zeilen haben |
| `rev` | Zeilenversion, der Wächter jedes Schreibzugriffs |

- `GET …/glossary-terms` antwortet mit allen Begriffen in der Reihenfolge, in
  der sie angelegt wurden; umsortiert wird nichts. Die Glossar-Seite zeigt sie
  alphabetisch.
- `POST …/glossary-terms { term, explanation? }` legt einen Begriff am Ende an
  und antwortet mit ihm (201), ohne `rev`. `term` wird getrimmt, leer ist 400.
  Einen Begriff, den das Glossar schon hat, beantwortet der Server mit 409
  `glossary_term_taken` und schreibt nichts — auch beim Umformulieren.
- Geändert wird mit `PATCH …/glossary-terms/<id> { rev, force?, …Teilmenge
  von term, explanation }`, gelöscht mit `DELETE …/glossary-terms/<id>
  { rev }` (204). Ein veralteter `rev` ist 409 mit dem aktuellen Begriff unter
  `glossaryTerm`, eine unbekannte id 404, ein Feld, das ein Begriff nicht
  hat, eine 400, die es nennt.
- Die Suche findet jeden Begriff; der Treffer nennt sich mit `kind:
  "glossary-term"` und seiner `id` und öffnet die Glossar-Seite. Der Text über
  den Begriffen ist kein Begriff, sondern das Feld `glossaryIntro` der
  Kampagne.

### Kampagnenwissen

Das Kampagnenwissen sind die Namenskonventionen, Fakten und Stilregeln, die
der Generator verbindlich anwendet, auch wenn das Quellmaterial etwas anderes
sagt. Jedes Stück davon ist seine eigene Ressource mit seinem eigenen Typ
(`KnowledgeItem`, aus dem zod-Schema in `shared/src/knowledge-item.ts`,
ADR #31). `GET /api/campaigns/<kampagne>/knowledge-items/<id>` antwortet mit
ihm:

```json
{
  "id": "7c1f…",
  "kind": "naming",
  "from": "Salt Harbour",
  "to": "Salzhafen",
  "text": "",
  "rev": 1
}
```

| Feld | Bedeutung |
| ---- | --------- |
| `id` | stabil und opak, vergibt der Server beim Anlegen |
| `kind` | `naming` (Namenskonvention), `fact` (Fakt) oder `style` (Stilregel) |
| `from` / `to` | bei `naming`: die Schreibweise des Quellmaterials und die dieser Kampagne; sonst leer |
| `text` | bei `fact` und `style`: der Satz; sonst leer |
| `rev` | Zeilenversion, der Wächter jedes Schreibzugriffs |

- `GET …/knowledge-items` antwortet mit allem Kampagnenwissen in seiner
  Reihenfolge — der Reihenfolge im Prompt.
- `POST …/knowledge-items { kind, from?, to?, text? }` legt ein Stück am Ende
  an und antwortet mit ihm (201), ohne `rev`; ein weggelassenes Feld ist leer.
  Eine halbe Namenskonvention wird gespeichert, der Prompt überspringt sie.
- Geändert wird mit `PATCH …/knowledge-items/<id> { rev, force?, …Teilmenge
  der Felder }`, gelöscht mit `DELETE …/knowledge-items/<id> { rev }` (204).
  Jedes Textfeld ist eine Zeile (400 sonst). Ein veralteter `rev` ist 409 mit
  dem aktuellen Stand unter `knowledgeItem`, eine unbekannte id 404.
- Die **Reihenfolge** setzt der DM (Hoch/Runter auf der Wissens-Seite). Sie
  ist kein Feld eines Stücks, sondern hat ihren eigenen Schreibweg: `GET`/`PUT
  /api/campaigns/<kampagne>/knowledge-item-order` mit `{ items, rev }`, wobei
  `items` jede id des Kampagnenwissens genau einmal nennt (400 sonst). Das
  `rev` ist der Wächter der Reihenfolge an der Kampagne; ein alter Stand ist
  409 mit der aktuellen Reihenfolge unter `knowledgeItemOrder`. Weder das
  `rev` eines Stücks noch das der Kampagne bewegt sich dabei. Anlegen und
  Löschen ändern die Reihenfolge mit und bewegen ihren Wächter.

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

`location:` verlangt eine id in Slug-Form (400 sonst). Jede Szene gehört zu
einem Kapitel; `chapter:` lässt sich nicht leeren.

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
`fixtures/beispiel/scenes/lighthouse-arrival.json`.)

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

Ideen werden eingeworfen und danach nur noch abgehakt, sessionunabhängig und
mit denselben Hashtags wie das Log. Jede ist ihre eigene Ressource (siehe
Idee); die Nachbereitung zeigt die offenen zusammen mit dem Log.

## Nachbereitung

- „Als Handlungsstrang übernehmen" legt einen Faden des aktiven Kapitels an
  (`POST …/threads { chapter, text }`); Text und `rev` des Kapitels bleiben
  unberührt. Gepflegt werden die Fäden in der Kapitelübersicht: abhaken,
  umformulieren, löschen, von Hand ergänzen.
- „NPC anlegen" legt den NPC über `POST …/npcs { name, id, body }` an, mit
  `status: unknown` (die Log-Zeile sagt nichts über seinen Zustand); sein
  Text ist genau der Log-Text, ohne Überschrift. Ein NPC, der unter der id
  nichts hält als seine id, wird gefüllt. Hält er schon etwas, ist das eine
  409 mit Vorschlag: nichts wird geschrieben, die Nachbereitung zeigt den
  Konflikt, und die Log-Zeile bleibt offen.
- „Idee abhaken" setzt `done` an der Idee (`PATCH …/ideas/<id> { rev, done }`),
  damit sie nicht in jeder künftigen Nachbereitung wieder auftaucht.

## Schreibregeln

- Geschrieben wird ausschließlich über die API (jeder Endpoint ist an seiner
  Route dokumentiert, im Modul seiner Ressource
  `server/src/routes/<ressource>.ts`): Log, Nachbereitung,
  Generator-Entwürfe — und für jede Entität ihr eigener `PATCH` auf ihrer
  Ressource, der jede Teilmenge ihrer Felder, `body` eingeschlossen, in einem
  Zug schreibt (ADR #23, ADR #31); Faden, Idee, Glossar-Begriff und
  Kampagnenwissen eingeschlossen, die keinen `body` haben. Keine Liste wird
  als Ganzes getauscht.
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
  Kapitels; passt es nicht, ist das 409. Geschrieben wird nur die
  Reihenfolge: weder `scenes.rev` noch `chapters.rev` bewegen sich, damit ein
  offener Szenen- oder Kapitel-Editor durch ein Umsortieren nicht in einen
  Konflikt läuft (ADR #27). Dieselbe Bauart hat die Reihenfolge des
  Kampagnenwissens (`PUT …/knowledge-item-order { items, rev }`, siehe
  Kampagnenwissen).
- Das Log ist append-only (ADR #4). Eine Idee wird einmal geschrieben und
  danach nur noch abgehakt.

## Generator

Siehe `generator/README.md`. Kurzfassung: Quelltext (EN) rein →
vorgeschlagene Szenen (DE, dieses Format) raus, immer `status: draft`, immer
mit „Entwürfe prüfen" vor dem Übernehmen.

Ein Szenen-Lauf ist eine **Pipeline**: ein Gliederungs-Aufruf legt die
Szenen und ihre ids fest, danach wird jede Szene und jeder neue NPC und Ort
einzeln geschrieben. Ein Formfehler kostet nur den betroffenen Teil, fertige
Szenen sind sofort prüfbar, und ein defekter Teil lässt sich einzeln
wiederholen. Die Gliederung ist ein systeminterner Schritt — sie wird nie
angezeigt. Legt der Lauf sein Kapitel neu an, beschreibt die Gliederung es aus
dem Quellmaterial; „Entwürfe prüfen“ zeigt diese Beschreibung, und das
Übernehmen legt das Kapitel mit ihr als Text an. Den Text eines bestehenden
Kapitels ändert kein Lauf.

**Jeder** Aufruf antwortet mit einem JSON-Objekt, dessen Schema der Server
über die Provider-API **erzwingt**. Ein Szenen-, NPC- oder Orts-Aufruf
(Anlegen wie Ergänzen) liefert die Szene, den NPC bzw. den Ort ohne `rev`,
alle Felder nebeneinander, dazu die Hinweise für den DM unter `warnings`;
eine neue Szene ist dabei immer `draft`, und `quickstats` eines NPC reist als
Liste von Paaren `{ key, value }`. Szene, NPC und Ort leiten ihr Schema
selbst aus ihrem zod-Schema ab (`z.toJSONSchema`, ADR #31), und was das
Modell über ihre Felder wissen muss, steht in ihrem Prompt
(`generator/system-prompt.md`, `generator/npc-system-prompt.md`,
`generator/location-system-prompt.md`). Ein Job listet die vorgeschlagenen
Szenen unter `result.scenes`, die NPCs unter `result.npcs` und die Orte unter
`result.locations`; ein NPC-Lauf trägt seinen einen NPC unter
`npcResult.npc`. Änderungen des DM an einem Vorschlag liegen je Szene unter
`sceneEdits` und je NPC unter `npcEdits`. Details in `generator/README.md`.

Die mechanische Prüfung liest die Felder und den Text, aber keine
Überschrift (ADR #29): die Abschnitte eines Vorschlags sind die Empfehlung
der Prompts. Jedes `[[id]]` in einem erzeugten Text nennt einen NPC, einen
Ort oder eine Szene der Kampagne oder einen Vorschlag desselben Laufs, sonst geht
die Antwort als Korrektur-Turn zurück. Im Ergänzen-Lauf gilt das für die
Verweise, die der Vorschlag neu bringt; was im bestehenden Text schon steht,
bleibt dem DM. Ein `[[id]]` im Code zählt wie überall nicht als Verweis.

## Fixtures

Die Beispielkampagne liegt als JSON unter `fixtures/beispiel/`, ein Objekt je
Datei, genau in der Form, die die API spricht. Jede Entität mit eigener
Ressource liegt in ihrem eigenen Verzeichnis, jede Datei genau das Objekt,
das ihre Ressource liefert, ohne `rev` (ADR #31): die Kampagne unter
`fixtures/beispiel/campaigns/<id>.json`, ein Kapitel unter
`fixtures/beispiel/chapters/<id>.json`, eine Szene unter
`fixtures/beispiel/scenes/<id>.json`, ein NPC unter
`fixtures/beispiel/npcs/<id>.json`, ein Ort unter
`fixtures/beispiel/locations/<id>.json`, ein Faden unter
`fixtures/beispiel/threads/<id>.json`, eine Idee unter
`fixtures/beispiel/ideas/<id>.json`, ein Glossar-Begriff unter
`fixtures/beispiel/glossary-terms/<id>.json` und ein Stück Kampagnenwissen
unter `fixtures/beispiel/knowledge-items/<id>.json`. Eine Session trägt ihre
Listen strukturiert, als Zeilen mit ihren Spalten, unter `kind: "session"`:
eine Log-Zeile ist `{ at, sceneId?, text, reviewed? }`. Eine Markdown-Zeile steht in keiner
davon. Sie ist die Referenz für Callouts und die einzige
Quelle für Tests und E2E; die Bodies werden deshalb nie umformatiert.

`grimoire seed <dir>` ist das Dev-/E2E-Werkzeug dazu: es liest
`<dir>/<kampagne>/*.json` samt den Verzeichnissen `campaigns/`, `chapters/`,
`scenes/`, `npcs/`, `locations/`, `threads/`, `ideas/`, `glossary-terms/` und
`knowledge-items/` darunter und
schreibt die Einträge über die Store-Schicht in eine Datenbank. Der Server
selbst seedet nichts — eine frische Instanz startet leer.
