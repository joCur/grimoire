# Grimoire — Datenmodell & Konventionen

Grimoire speichert eine Kampagne in einer SQLite-Datenbank
(`GRIMOIRE_DATA/grimoire.db`). Alles darin ist ein **Eintrag**: eine
Kampagne, ein Kapitel, eine Szene, ein NPC, ein Ort, eine Session. Jeder
Eintrag besteht aus **Eigenschaften** — den Feldern, die die App im
Eigenschaften-Dialog zeigt (Titel, Status, Ort, …) — und einem **Text** in
Markdown. Dazu kommen drei Listen ohne Text: die **Ideen**, das **Glossar**
und das **Kampagnenwissen**.

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
| Session | `sessions/<id>` |
| Ideen | `inbox` |
| Glossar | `glossary` |

Die `id` entsteht beim Anlegen aus dem getippten Namen, nach genau einer
Regel (`@grimoire/shared/slug`), und bleibt dann, wie sie ist. Umbenennen ist
ein eigener Vorgang: „id ändern" im Eigenschaften-Dialog zeigt vorher, welche
Einträge die id verwenden, und zieht sie überall mit.

Die Adresse einer Szene enthält ihren **Ort**. Die Kapitelübersicht gruppiert
Szenen nach Ort; Szenen ohne Ort stehen unter „Ohne Ort". Ändert der DM den
Ort einer Szene, ändert sich ihre Adresse — die alte bleibt auflösbar, der
Server antwortet mit der aktuellen und die App ersetzt die URL.

Kampagnenwissen (`/<kampagne>/knowledge`) und Glossar (`/<kampagne>/glossary`)
sind Listen, die der Generator als Kontext bekommt; sie werden auf ihren
eigenen Seiten gepflegt und über `GET/PUT /api/:campaign/knowledge` bzw.
`/glossary` gelesen und geschrieben.

## Eigenschaften

Die Eigenschaften eines Eintrags sind seine strukturierten Felder. Sie
heißen auf der Leitung `properties`; die App zeigt sie im
Eigenschaften-Dialog, und `PATCH /properties` ändert genau die Felder, die
der DM angefasst hat. Felder, die der Import mitgebracht hat und die kein
Eintrag kennt, bleiben erhalten und lassen sich ändern oder löschen; neue legt
die API nicht an (400).

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
auf `planned`. Die API schreibt nur diese drei Werte (400 sonst); ein bereits
gespeicherter anderer Wert wird weiterhin unverändert angezeigt — das Format
degradiert wie überall.

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
`## Beziehungen` (Liste `- <npc-id>: <Freitext>`), `## Notizen` (befüllt die
Nachbereitung mit „NPC-Stub anlegen" — nicht von Hand pflegen).

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

Sessions verwaltet die App; der DM schreibt nur ins Log.

| Feld | Bedeutung |
| ---- | --------- |
| `id` | opake Zufalls-id (UUID); Reihenfolge und Datum kommen aus `started` |
| `started` | Start, sekundengenau, zonenlose Lokalzeit (`yyyy-mm-ddTHH:MM:SS`) |
| `ended` | gesetzt bei „Session beenden" |
| `pauses` | Liste `{from, to}`; ein Eintrag ohne `to` ist die laufende Pause — die Uhr steht |
| `scenes_played` | Szenen-ids, automatisch gepflegt |
| `reviewed` | Kurzhashes (erste 8 Hex-Zeichen von SHA-256) der gesichteten Log-Zeilen |

- `## Log` ist append-only: `- HH:MM (scene-id) Text #hashtags`. Zeitstempel
  und Szenen-Kontext setzt die App. Pause und „Weiter" schreiben die Zeilen
  `— Pause` und `— Weiter` — das Log bleibt die lesbare Chronik des Abends.
- `## Threads`: Checkliste offener Fäden, in der Nachbereitung befüllt.
- Timer = (`ended` ?? jetzt) − `started` − Summe der Pausen. Den Epochen-Wert
  der zonenlosen Zeitstempel liefert der Server; der Client hält keinen
  laufenden Zustand.
- `reviewed` hasht die **rohe** Log-Zeile, damit `## Log` strikt append-only
  bleibt.

## Referenzieren legt an

Wer eine id referenziert, legt sie an. Trägt der DM in `npcs:` einer Szene,
in `location:` oder in `## Beziehungen` eine id ein, die es noch nicht gibt,
entsteht im selben Schreibvorgang ein leerer Eintrag (id, Name = id, Status
Default). Ein referenzierter Eintrag ist damit nie „fehlt", höchstens leer;
leere Einträge erscheinen als dünne Karten und sind normal befüllbar.

`location:` verlangt eine id in Slug-Form (400 sonst) — sie ist zugleich die
Gruppe der Szene. `chapter:` legt nichts an: ein unbekanntes Kapitel ist 400,
bei Szene, NPC und Ort gleich.

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
die Szene „Ankunft am Leuchtturm" in `examples/`.)

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
  setzt erst die Anzeige ein — nach einer Umbenennung stimmt der Text überall,
  ohne dass ein Eintrag angefasst wird.
- Referenzierbar sind **NPC, Ort und Szene**. Kollidieren ids über Arten
  hinweg, gewinnt **NPC > Ort > Szene**. Kapitel sind nicht referenzierbar.
- In den Klammern steht **nur die id** in kebab-case (`[[alte-mole]]`); es
  gibt **keinen Anzeigetext** (`[[jorna|Jorna]]` ist normaler Text). Endungen
  stehen außerhalb: `[[jorna]]s Boot` → „Jornas Boot".
- **Code ist keine Prosa**: In Code-Blöcken und in `` `[[jorna]]` `` bleibt die
  Schreibweise wörtlich stehen — nicht aufgelöst, nicht indexiert, von einer
  Umbenennung nicht angefasst.
- In der Kopfzeile eines `## If:`-Zweigs erscheint der aufgelöste **Name als
  Text** (kein Link): der Klick faltet den Zweig.
- **Degradation**: Eine id, die kein Eintrag hat, bleibt als `[[id]]` sichtbar
  stehen — kein Fehler, und sie wird lebendig, sobald der Eintrag existiert.
- Klick: in der Leseansicht ein Link zum Eintrag, in der Session-Ansicht
  öffnet er die Detail-Schublade, ohne die Session zu verlassen.
- Namen als normaler Text sind weiterhin erlaubt — sie wandern bei einer
  Umbenennung nur nicht mit.

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

Die Ideen-Liste (`inbox`) ist append-only und sessionunabhängig, mit denselben
Hashtags wie das Log. Die Nachbereitung zeigt sie zusammen mit dem Log.

## Nachbereitung

- „Als Handlungsstrang übernehmen" hängt `- [ ] <Text>` unter `## Offene
  Fäden` im Text des aktiven Kapitels an (der Abschnitt wird angelegt, wenn
  er fehlt).
- „NPC-Stub anlegen" erzeugt den NPC `npcs/<id>` mit `status: alive` (wer am
  Tisch auftaucht, lebt) und dem Log-Text unter `## Notizen`. Existiert die
  id, meldet die App den Konflikt statt zu überschreiben.
- Erledigte Ideen werden zu `- [x] …` — die eine Ausnahme vom Append-only der
  Ideen, damit sie nicht in jeder künftigen Nachbereitung wieder auftauchen.

## Schreibregeln

- Geschrieben wird ausschließlich über die API (`server/src/server.ts` führt
  die Endpoints auf): Log, Ideen, `PATCH /properties`, Text-Edits,
  Nachbereitung, Generator-Entwürfe, Umbenennen.
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
`body` und die Hinweise für den DM unter `warnings`. Den
Eigenschaften-Block schreibt der Server selbst. Die Schemata liegen als
lesbares JSON in `shared/schema/`; Details in `generator/README.md`.

## Anhang: `grimoire seed`

`grimoire seed [dir]` ist ein Dev-/E2E-Werkzeug (siehe `docs/DEPLOYMENT.md`
Abschnitt 2b): es liest einen Markdown-Baum ein und schreibt daraus Einträge
in eine Datenbank. Referenz und einzige Quelle für Tests und E2E ist die
committete Beispielkampagne unter `examples/`; sie wird deshalb nie
umformatiert. Der Server selbst liest keinen Baum — eine frische Instanz
startet leer.

Im Baum stehen die Eigenschaften eines Eintrags als YAML-Block (`---` …
`---`) über dem Text, mit denselben Feldnamen wie oben:

```
<kampagnen-id>/
  _campaign.md              # optional; fehlt es, heißt die Kampagne wie der Ordner
  <kapitel-id>/
    _chapter.md
    <orts-id>/              # setzt `location`, wenn die Szene keines nennt
      <szene>.md
  npcs/<id>.md
  locations/<id>.md
  sessions/<id>.md
  inbox.md
  glossary.md
```

Die `id` im YAML-Block gewinnt gegen den Dateinamen. Was der Import nicht
versteht, übernimmt er nicht und nennt es im Bericht auf stdout — die Datei
bleibt unverändert im Baum.
