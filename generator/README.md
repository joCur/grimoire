# Generator

Pipeline: Quelltext (EN) → LLM → Szenen-Drafts (DE) → Review-Vorschau → Platte.

## Antwortformate (Issue #107)

**Jede Antwort ist ein JSON-Objekt, und jedes Objekt ist per Schema
erzwungen.** Das ist der ganze Vertrag: der Provider schickt das Schema mit
und die Schnittstelle garantiert die Form, bevor der Server sie liest.

* **Claude**: das Schema reist als Tool mit, `tool_choice` erzwingt den
  Aufruf; die Antwort ist der Tool-Input.
* **OpenAI-kompatibel**: `response_format: { type: "json_schema", …, strict:
  true }`, mit **einem** Rückfall auf `json_object`, wenn der Endpoint mit 400
  antwortet. Gemerkt (einmal je Prozess, damit die Erkennung einmal bezahlt
  wird) wird der Rückfall nur, wenn der Fehlertext das Format nennt
  (`response_format`, `json_schema`, `schema`) oder der einfache Versuch
  gelingt — ein 400 aus anderem Grund (zu langer Prompt, falsche Modell-id)
  fliegt unverändert nach oben, statt die erzwungene Form dauerhaft
  abzuschalten.

**Dokument-Antworten — der Normalfall.** Szenen-Teil, Eintrags-Teil
(NPC/Ort), NPC-Lauf und Ergänzen-Lauf antworten mit dem Objekt, das die
gespeicherte Zeile **spiegelt**: die Frontmatter-Felder unter `properties`,
der ganze Fließtext als **ein** String unter `body`, die Hinweise für den DM
unter `warnings`.

```json
{
  "properties": {
    "id": "night-watch-quay",
    "title": "Nachtwache am Kai",
    "type": "planned",
    "status": "draft"
  },
  "body": "## Flow\n\nDie Wache murrt: „Wer nachts hier steht, hat was zu verbergen.“\n",
  "warnings": ["Der Quelltext nennt keinen DC — DC 13 gesetzt."]
}
```

`properties` ist **je Art** getypt, und zwar aus **derselben** Feldliste, aus
der der Eigenschaften-Dialog gebaut wird (`shared/src/property-fields.ts`) —
ein Modell kann also genau die Felder schreiben, die der DM auch bearbeiten
kann, und keins mehr. Der **Frontmatter-Block ist Sache des Servers**: er
setzt ihn aus `properties` zusammen (`renderRaw`, derselbe Renderer wie bei
jeder geschriebenen Datei), weshalb `quickstats: { wis: "+2" }` gequotet ist,
weil der Renderer quotet — nicht weil das Modell daran gedacht hat.

Die Schemata stehen **einmal** in `shared/src/document-schema.ts`, gebaut aus
der Feldliste und den Konstanten, die die Validierung liest. Für den
Ergänzen-Lauf gibt es denselben Bau im Modus `augment`: eine bestehende Szene
behält den Status, den der DM ihr gegeben hat, während eine **neue** Szene nur
`draft` sein kann.

Drei Eigenheiten des **strict mode** (der OpenAI-Pfad schickt `strict: true`,
und ein abgelehntes Schema ist ein dauerhafter Rückfall für den ganzen
Prozess):

* kein `pattern`, kein `format`, keine `min*`/`max*`-Grenzen — was das Schema
  nicht sagen kann, steht in einer `description` und wird dort geprüft, wo es
  immer geprüft wurde (kebab-`id`, bekannte Callouts, auflösbare Referenzen,
  die NPC-Formatregeln),
* **alle** Felder stehen in `required`; ein wirklich optionales Feld ist
  stattdessen `null`-fähig, und der Server liest `null` als „nicht
  angegeben“ und lässt den Schlüssel weg,
* eine freie Schlüssel/Wert-Abbildung (`quickstats`) lässt sich gar nicht
  ausdrücken, also reist sie als **Liste** von `{ key, value }` und der Server
  faltet sie zurück in die Mapping-Form des Format-Vertrags.

Warum nicht das Dokument selbst? Genau das war der Zwischenschritt dieses
Tickets — die Antwort IST die Markdown-Datei — und er hat die JSON-Maskierung
gegen **Frontmatter-Parsen** getauscht: Code-Zaun drumherum, ein Satz davor,
ein Abschiedssatz danach, zwei waagerechte Linien, die wie ein
Frontmatter-Block aussehen. Diese Hälfte kann keine API garantieren, also
musste sie hier von Hand toleriert werden — und jeder Fehlgriff war eine
Korrekturrunde oder stiller Datenverlust. Ein erzwungenes Objekt kann das
alles nicht: den `body` maskiert der **Transport**, und deshalb übersteht der
PO-Fall vom 15.09. (ein `„…“`, dessen schließendes Zeichen das ASCII-`"` war) die
Übertragung Zeichen für Zeichen.

**Der tolerante Leser** bleibt als Netz für Endpoints, die das Feld annehmen
und ignorieren (`parseJsonReply` in `server/src/document-reply.ts`, von allen
Antworten benutzt): der ganze Text, dann ein ```json-Zaun, dann die Spanne von
der ersten `{` bis zur letzten `}` — und **eine** deterministische Reparatur
(`jsonrepair`, exakt gepinnt) für Komma am Ende oder einfache
Anführungszeichen. Danach wird **normal validiert**: die Reparatur lockert das
Parsen, nie die Regeln. Ein reparierter Lauf trägt die Warnung „Antwort musste
repariert werden“, damit ein Provider, der jedes Mal geflickt werden muss,
sichtbar ist. Fließtext ohne Objekt wird *nicht* repariert: `jsonrepair` würde
einen Satz in einen JSON-String verwandeln, und der Lauf scheiterte dann mit
einer Meldung über die falsche Sache.

Die **Korrekturrunde** nennt das Schema, in dem korrigiert werden soll
(`buildCorrectionMessage`), damit das Modell in der Form bleibt, die es
bekommen hat. Sonst wird nichts nachkorrigiert: keine Typografie-Heuristik,
kein stilles Ersetzen.

**Die Gliederung** ist das vierte Schema (`shared/src/outline-schema.ts`) und
das einzige, das kein Dokument beschreibt: ein kleines, flaches Objekt aus
Szenenliste und neuen Einträgen. Die **semantischen** Prüfungen bleiben auch
dort, wo sie sind: ein Schema kann nicht sagen „diese id kommt im ganzen
Durchlauf nur einmal vor“, „dieser `refs`-Eintrag ist eine Szene DIESER
Gliederung“ oder „das Kapitel kommt aus dem Kontext“.

**Die Few-Shots sind Antworten**, keine Dateien: `example-output.json`,
`npc-example-output.json`, `location-example-output.json` und
`outline-example-output.json` zeigen genau das Objekt, in das der jeweilige
Aufruf gezwungen wird — derselbe Beispielinhalt wie vorher, nur in der Form,
die das Modell auch liefern soll.

## Ablauf eines Szenen-Laufs (Pipeline, Issue #102)

Ein Szenen-Lauf ist nicht **ein** Aufruf, sondern `1 + N (+ Vorschläge)`:

1. **Gliederung** (ein Aufruf, `outline-system-prompt.md` +
   `outline-example-output.json`): kleines JSON, per Schema erzwungen (siehe
   „Antwortformate“) — mit der Szenenliste: `id`,
   `title`, `type`, `location`, Querverweise (`refs`) — und der Liste neuer
   Figuren/Orte (`entries`). Jede Szene nennt zusätzlich den **ersten und
   letzten Satz ihres Quelltext-Abschnitts wörtlich** (`sourceExcerpt`); der
   Server schneidet den Abschnitt damit aus dem Quelltext. Findet er die
   Zitate nicht wörtlich wieder (Whitespace wird normalisiert, sonst nichts),
   bekommt die Szene den **ganzen** Quelltext und der Lauf eine Warnung —
   teurer, aber nie falsch. Validierung und Korrektur-Turns gelten für diesen
   Schritt allein.

   **Obergrenze:** höchstens 12 Szenen und 12 neue Einträge je Lauf
   (`MAX_OUTLINE_SCENES` / `MAX_OUTLINE_ENTRIES`). Jeder Teil ist ein
   Provider-Aufruf, also entscheidet die Gliederung, was ein Lauf kostet;
   darüber ist die Antwort ein Validierungsfehler und damit ein
   Korrektur-Turn, der um Zusammenfassen bittet — kein fehlgeschlagener Lauf.

   Die Gliederung ist ein **rein systeminterner** Schritt zur Fehlerreduktion.
   Sie wird dem Nutzer nie angezeigt und nie zum Bearbeiten angeboten (PO,
   15.09.) — interessant ist nur das Ergebnis je Szene/NPC/Ort. Der Server
   speichert sie auf der Job-Zeile, weil „Erneut versuchen“ und ein Neustart
   sie brauchen.

2. **Szenen** (je Szene ein Aufruf, Parallelität 3): `system-prompt.md` im
   Modus „genau eine Szene aus der Gliederung“ (`scene-single-output.md`
   tauscht nur das Ausgabeformat — alle Regeln bleiben wörtlich dieselben) +
   Gliederung + der geschnittene Quelltext-Abschnitt. Ausgabe: genau ein
   Szenendokument, roh. Validierung, Korrektur-Turns und Namensprüfung **je
   Szene**; ein fehlgeschlagener Teil blockiert die anderen nicht.

3. **Vorschläge** (je neuem Eintrag ein Aufruf): `npc-system-prompt.md` bzw.
   `location-system-prompt.md`, mit der Gliederung und den Abschnitten der
   Szenen, die den Eintrag referenzieren. Dedupliziert über die id.

Was das dem DM bringt: ein Formfehler kostet nur den betroffenen Teil, fertige
Szenen sind sofort prüfbar und übernehmbar, und ein defekter Teil lässt sich
einzeln wiederholen (`POST …/generate/job/:id/parts/:key/retry`). Das
Job-Modell dazu steht in `docs/DECISIONS.md` #10.

**Prompt-Caching:** Der konstante Teil des Prompts — System-Prompt,
Kampagnenwissen, Glossar, Kontextlisten, Few-Shot, Gliederung — steht bei
jedem Aufruf **zuerst** und wird beim Claude-Provider mit
`cache_control: ephemeral` markiert (System-Prompt und konstanter Block je
eine Marke); OpenAI-kompatible Endpoints cachen denselben Prefix implizit. Nur
der variable Rest wechselt je Teil: **welche Szene dieser Aufruf schreibt**
(„## Diese Szene schreibst du jetzt“), der Ausschnitt, der bestehende Eintrag,
die Anweisung. Der Gliederungs-Block selbst ist für jeden Teil eines Laufs
**byteweise identisch** — deshalb steht die Zuweisung nicht darin.

Die Anzeige „~N Tokens · M Aufrufe“ summiert über alle Teile, die Gliederung
eingeschlossen.

**Ein Aufruf bleiben** (PO-Entscheid): der Ergänzen-Lauf (#36) und die
NPC-Generierung (#21) — je ein Eintrag, nichts zu zerlegen.

## Ablauf pro Aufruf

Gilt für jeden EINZELNEN Provider-Aufruf — den Gliederungs-Aufruf, jeden
Szenen-Aufruf, jeden Eintrags-Aufruf und die beiden Ein-Aufruf-Läufe:

1. Server sammelt Kontext: alle npc-/location-ids + Namen, Kapitel-id,
   **Kampagnenwissen** und Glossar (beides aus der Datenbank —
   `campaign_knowledge` bzw. `glossary`).
2. Prompt = `system-prompt.md` + `example-output.json` (Few-Shot-Ziel)
   + Kampagnenwissen + Glossar + Kontext + Quelltext.
3. LLM antwortet — mit dem **Dokument-Objekt** (Szene, NPC, Ort, Ergänzung)
   bzw. mit dem **Gliederungs-Objekt**, je per Schema erzwungen; siehe
   „Antwortformate“ oben.
4. Server validiert mechanisch (das Schema deckt die Form ab, hier steht der
   Inhalt):
   - `properties` nur bekannte Felder, kebab-`id`? `type`/`status` gültig?
     `status == draft`?
     Stubs: NPC-Status gültig (Normalfall `alive`), Orte ohne status-Key.
   - alle `npcs`-/`location`-Referenzen existieren ODER liegen als Stub bei?
   - nur bekannte Callout-Typen?
   Fehler gehen als Korrektur-Turn zurück ans LLM (konfigurierbar
   über LLM_CORRECTION_TURNS, 0–2, Default 1),
   nicht an den Nutzer. Ausnahme: eine vom Modell abgeschnittene Antwort
   (finish_reason/stop_reason) bricht sofort ab — Korrektur-Turns können
   ein Token-Limit nicht heilen, sie kosten nur.
5. Server prüft den fertigen Draft gegen die **Namenskonventionen** des
   Kampagnenwissens (Wortgrenzen, Groß/Klein-unabhängig, keine Heuristik)
   und legt Treffer als `namingHints` ins Job-Ergebnis.
6. App zeigt Review-Vorschau: Szenen editierbar, Stubs einzeln
   annehmen/ablehnen, Namens-Hinweise dezent daneben (kein Blocker).
   Erst „Übernehmen“ schreibt auf die Platte.

## Kampagnenwissen (Issue #53)

Gepflegt auf `/settings` je Kampagne, drei Arten: Namenskonvention
(`Alt → Neu`), Fakt, Stilregel. Der Prompt stellt sie **vor** das Glossar,
unter einer bindenden Überschrift:

```
## Kampagnenwissen — immer anwenden, auch wenn das Quellmaterial anders lautet

- Namenskonvention: schreibe „Salt Harbour“ immer als „Salzhafen“.
- Fakt: Der Leuchtturm ist seit zwei Wintern unbesetzt.
- Stilregel: Keine Würfelwerte im Read-Aloud-Text.
```

`[[slug]]`-Referenzen in Einträgen werden vorher aufgelöst (der Modell-Text
soll Namen enthalten, keine Slugs). Ohne Einträge fehlt der Abschnitt ganz —
der Prompt sieht dann genauso aus wie vorher.

## Deutsche Orthografie (Issue #93)

Alle System-Prompts (`system-prompt.md`, `npc-system-prompt.md`,
`location-system-prompt.md`, `augment-system-prompt.md` und seit #102
`outline-system-prompt.md`) tragen **dieselbe**
Regel „Deutsche Orthografie“: jeder echte Text — Fließtext, Read-Alouds,
Callouts, `## If:`-Bedingungen, Überschriften, `warnings` und jeder
Frontmatter-Wert, der Text ist (`title`, `name`, `role`, `voice`,
`appearance`, `trigger`, `goal`, `statblock` …) — nutzt ä/ö/ü/ß, niemals die
ASCII-Ersatzschreibung ae/oe/ue/ss. **Einzige Ausnahme**: `id`-Werte (und
`location`, das eine id ist), die bleiben kebab-case ASCII; Eigennamen aus
dem Quelltext bleiben unverändert.

**Seit #107 gehören die Anführungszeichen dazu**, als **ein** identischer Satz
in derselben Regel: deutsche typografische Anführungszeichen `„…“`
(U+201E/U+201C), einfache `‚…‘`, Apostroph `’` — nie das ASCII-`"` und nie `'`
als Apostroph. Die Mischform — U+201E geöffnet, mit dem ASCII-Zeichen
geschlossen — stand vorher durchgehend in unseren Prompts, Few-Shots,
Beispieldateien **und im UI-Katalog**, und das Modell hat sie imitiert; alle
vier sind umgestellt (nur die Anführungszeichen, sonst nichts). Zwei Tests halten es so: `app/src/i18n/i18n.test.ts` über die
Katalog-WERTE (im Quelltext ist das schließende ASCII-Zeichen nicht vom
String-Begrenzer zu unterscheiden) und `server/test/typography.test.ts` über
Prompts, Few-Shots und `examples/`.

Die Regel steht in den drei Create-Prompts unter „## Regeln“ und im
Ergänzen-Prompt in der Ergänzungsregel — also genau **einmal** in jedem
zusammengesetzten Prompt, auch im Ergänzen-Modus, der von den Create-Prompts
nur „## Ziel-Format der Datei“ einschneidet (`formatContract` in
`server/src/generator-augment.ts`). Der Server korrigiert nichts nach: es
gibt keine Heuristik und kein stilles Ersetzen, die Regel wirkt allein im
Prompt.

## Tabellen (Issue #96)

Dieselbe Mechanik wie bei der Orthografie-Regel: **eine identische Regel
„Tabellen“** in allen System-Prompts, die Dokumente schreiben — **nicht** im
Gliederungs-Prompt, der überhaupt kein Dokument ausgibt (keine Callouts, kein
Frontmatter, keine Tabellen; die Orthografie-Regel steht dort trotzdem, weil
Titel, Einzeiler und `warnings` Text sind) — in den drei Create-Prompts unter
„## Regeln“, im Ergänzen-Prompt in der Ergänzungsregel, also genau **einmal**
in jedem zusammengesetzten Prompt (`formatContract` in
`server/src/generator-augment.ts` schneidet aus den Create-Prompts nur
„## Ziel-Format der Datei“ heraus).

Inhalt der Regel: Tabellen aus dem Quellmaterial — Zufallstabellen,
Begegnungs- und Würfellisten — werden als gültige GFM-Pipe-Tabelle
ausgegeben (Kopfzeile, `|---|`-Trennzeile, Rand-Pipes) und stehen im
passenden Callout, in jeder Zeile mit dessen `>`. **Sonst nichts aus GFM**:
Durchgestrichen, Aufgabenlisten, Fußnoten und Auto-Links bleiben normaler
Text — der Renderer kennt sie nicht (`app/src/markdown/remark-table.ts`).

Der Szenen-Few-Shot (`example-output.json`) zeigt eine kleine W6-Tabelle in
einem `[!note]`-Callout, damit das Modell die Form im Callout sieht und nicht
nur beschrieben bekommt. Der Server validiert Tabellen nicht: eine kaputte
Trennzeile ist keine Tabelle, sondern Text — Degradation statt Fehler.

## NPC-Generator

Gleiche Pipeline, eigener Endpoint (`POST /api/:campaign/generate/npc`)
und eigene Prompt-Assets (`npc-system-prompt.md`, `npc-example-output.json`
— Few-Shot ist die Format-Referenz `examples/beispiel/npcs/fenn.md`).
Zielformat: NPC-Entität aus README.md; Beziehungen nur auf existierende
ids, Quickstats als gequotete Strings (das Plus überlebt YAML),
status alive als Normalfall. Ein Generator-Job pro Kampagne, egal ob
Szenen oder NPC.

## Provider

Abstraktion in `server/src/llm-provider.ts`, Auswahl per Env-Var
`LLM_PROVIDER` — keine Code-Änderung nötig:

- `claude` (Default): Claude API direkt (`ANTHROPIC_API_KEY`, optional
  `CLAUDE_MODEL`).
- `openrouter`: OpenRouter als Modell-Router (`OPENROUTER_API_KEY` +
  `LLM_MODEL`, z. B. `anthropic/claude-sonnet-5`) — ein Key, viele
  Modelle, damit lässt sich vergleichen, ohne die Konfiguration umzubauen.
- `openai`: derselbe Transport für **jeden** OpenAI-kompatiblen Endpoint
  (`LLM_BASE_URL` + `LLM_MODEL`, `LLM_API_KEY` nur falls verlangt).
- `lmstudio`: lokal ohne Key (`LMSTUDIO_URL`, `LMSTUDIO_MODEL`).

Die drei OpenAI-kompatiblen Fälle teilen eine Klasse
(`OpenAICompatProvider`); sie unterscheiden sich nur in Base-URL, Modell und
Auth-Header. Fehlende Pflicht-Variablen und ein unbekannter
`LLM_PROVIDER`-Wert werden nicht verschluckt: `POST /api/:campaign/generate`
antwortet `503` mit der Meldung im Klartext. Vollständige Variablen-Tabelle:
docs/DEPLOYMENT.md Abschnitt 2.

## Keine Adressen im Modell-Reply (Issue #100)

Das Modell vergibt keine Pfade mehr. Es liefert **Dokumente**, und der
Server bildet die Adresse:

* Szenen: `<kapitel>/<id>` — Kapitel aus dem Kontext des Laufs, `id` aus
  dem Frontmatter. Die **Gruppe** kommt aus `location`, also lautet die
  gespeicherte Adresse `<kapitel>/<location>/<id>` (ohne `location`:
  Kapitelebene).
* Vorgeschlagene Einträge: ein gemeinsames Array `entries` mit
  `kind: "npc" | "location"`; die `id` steht im Frontmatter des Eintrags,
  adressiert wird als `npcs/<id>` bzw. `locations/<id>`.
* NPC-Lauf und Ergänzen-Lauf: ein Objekt ohne `path`; beim Ergänzen steht
  die Zieladresse ohnehin serverseitig fest.

Der Prüfschritt adressiert die Teile eines Laufs weiterhin über die vom
Server gebildete Adresse (`GenerateResult.scenes[].path` = `<kapitel>/<id>`);
beim Übernehmen kann die tatsächlich geschriebene Adresse davon abweichen,
wenn die Szene eine `location` nennt — genau dafür meldet die Antwort
`written: { <prüfschritt-adresse>: <geschriebene adresse> }`.
