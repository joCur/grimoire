# Generator

Pipeline: Quelltext (EN) → LLM → Szenen-Drafts (DE) → Review-Vorschau → Platte.

## Antwortformate

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

**Szenen-Antworten.** Szenen-Teil und das Ergänzen einer Szene antworten mit
dem Objekt, das die gespeicherte Szene **spiegelt**: die Eigenschaften unter
`properties`, den ganzen Text als **ein** String unter `body`, die Hinweise
für den DM unter `warnings`. NPC und Ort antworten als sie selbst, siehe
unten.

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

**NPC- und Orts-Antworten.** NPC und Ort sind jeweils ihre eigene Ressource
mit eigenem Typ (ADR #31). NPC-Teil, NPC-Lauf und NPC-Ergänzung antworten mit
dem NPC selbst ohne `rev`, Orts-Teil und Orts-Ergänzung mit dem Ort selbst
ohne `rev` — alle Felder nebeneinander, `body` eines davon — und daneben
`warnings`. Beim NPC reist `quickstats` als **Liste** von
`{ "key": …, "value": … }`, der Wert immer ein String:

```json
{
  "id": "grella",
  "name": "Grella",
  "role": "Schmugglerin mit eigenen Plänen",
  "chapter": null,
  "status": "alive",
  "statblock": null,
  "quickstats": [{ "key": "insight", "value": "+3" }],
  "voice": null,
  "appearance": null,
  "motivation": "Die Route durch die Nordbucht für sich allein.",
  "body": "## Weiß\n\n> [!secret] …\n",
  "warnings": []
}
```

Ein Ort:

```json
{
  "id": "alte-mole",
  "name": "Die alte Mole",
  "chapter": null,
  "roll20Page": "Mole",
  "atmosphere": "Salz in der Luft, Möwen über dem Schlick.",
  "body": "## Beim ersten Betreten\n\n> [!readaloud] …\n",
  "warnings": []
}
```

Die Felder sind **je Entität** getypt — ein Modell kann genau die Felder
schreiben, die der DM auch bearbeiten kann, und keins mehr. Nichts setzt aus
einer Antwort einen Markdown-Text zusammen und nichts liest einen zurück,
also kann auf diesem Weg auch nichts an einem Wert verloren gehen. Bei der
Szene bleibt der **Entwurf** das Paar aus Eigenschaften und `body` von der
Antwort bis in die Zeile (ADR #24). Ein vorgeschlagener NPC ist der NPC ohne
`rev` (`NpcProposal`), ein vorgeschlagener Ort der Ort ohne `rev`
(`LocationProposal`); ein Job listet sie unter `result.npcs` bzw.
`result.locations`, getrennt von den Szenen, und Prüfen, Entscheiden und
Übernehmen laufen für sie über ihre `id`. Ändert der DM einen
vorgeschlagenen NPC im Review, liegt die Änderung als `npcEdits[<id>]` neben
dem Vorschlag und wird beim Übernehmen darübergelegt.

Die Antwort-Schemata von NPC und Ort haben **genau eine Quelle**: ihr
zod-Schema (`shared/src/npc.ts`, `shared/src/location.ts`). Daraus leitet
jede Entität ihre Generator-Form selbst ab, mit der API von zod
(`npcReplySchema`, `locationReplySchema`: die Entität ohne `rev`, die
optionalen Felder `null`-fähig statt optional, beim NPC `quickstats` als
Liste von Paaren, dazu `warnings`, nichts Zusätzliches erlaubt), und
`npcReplyRequest` in `server/src/npc-reply.ts` bzw. `locationReplyRequest` in
`server/src/location-reply.ts` gibt sie per `z.toJSONSchema` an den Provider
— je Lauf unter eigenem Namen (`npc`, `augmented_npc`, `location`,
`augmented_location`). Das Schema trägt keine `description`: was das Modell
über die Felder wissen muss (die id-Regel, welche Kapitel-id `chapter`
nennen darf, was `motivation` oder `atmosphere` ist, die Form von
`quickstats`, `body` und `warnings`), steht im Prompt der Entität unter
„## Die Felder des NPC“ bzw. „## Die Felder des Orts“, und der Ergänzen-Lauf
bekommt genau diesen Abschnitt mit. Die Szene lädt ihre Schemata als
**lesbares JSON** aus `shared/schema/`, eines je Lauf (`scene.schema.json`,
`augmented-scene.schema.json`), dazu `outline.schema.json`;
`shared/test/entry-schema.test.ts` prüft deren
Schlüssel und Wertelisten gegen die Feldliste
(`shared/src/property-fields.ts`) und für **jedes** Schema, abgeleitet oder
geladen, die Regeln des strict mode. Der Unterschied zwischen den Läufen
steht in den Schemata selbst: eine bestehende Szene behält den Status, den
der DM ihr gegeben hat, während eine **neue** Szene nur `draft` sein kann.

**Die Prompts zeigen genau dieses Objekt.** Der Formatabschnitt jedes
Create-Prompts — „## Eigenschaften und Text des Eintrags“ bei der Szene,
„## Die Felder des NPC“ beim NPC, „## Die Felder des Orts“ beim Ort — führt
ein ```json-Beispiel des Antwort-Objekts: die Felder in derselben Reihenfolge
wie das Schema der Entität (ein Feld ohne Quelle als `null`) — bei der Szene
unter `properties`, bei NPC und Ort nebeneinander —, `body` als **ein**
String — dessen
Aufbau, `## Flow`, `## If:`, die sechs Callouts und `[[id]]`-Verweise, steht
als Beschreibung dieses Strings darunter — und `warnings` als Liste von
Strings. Prompt, Schema und Few-Shot zeigen damit Feld für Feld dieselbe
Form.

Drei Eigenheiten des **strict mode** (der OpenAI-Pfad schickt `strict: true`,
und ein abgelehntes Schema ist ein dauerhafter Rückfall für den ganzen
Prozess):

* kein `pattern`, kein `format`, keine `min*`/`max*`-Grenzen — was das Schema
  nicht sagen kann, steht in einer `description` (bei der Szene) bzw. im
  Prompt der Entität (bei NPC und Ort) und wird dort geprüft, wo es immer
  geprüft wurde
  (kebab-`id`, bekannte Callouts, auflösbare Referenzen),
* **alle** Felder stehen in `required`; ein wirklich optionales Feld ist
  stattdessen `null`-fähig, und der Server liest `null` als „nicht
  angegeben“ und lässt den Schlüssel weg,
* eine freie Schlüssel/Wert-Abbildung (`quickstats`) lässt sich gar nicht
  ausdrücken, also reist sie als **Liste** von `{ key, value }`, und
  `npcFromReply` faltet sie zurück in die Kurzwerte des NPC.

Warum nicht den Eintrag als **einen** Markdown-Text als Antwort? Weil damit
die JSON-Maskierung gegen **Text-Parsen** getauscht wäre: Code-Zaun drumherum,
ein Satz davor, ein Abschiedssatz danach, zwei waagerechte Linien, die wie
Eigenschaften aussehen. Diese Hälfte kann keine API garantieren, sie
müsste also von Hand toleriert werden — und jeder Fehlgriff ist eine
Korrekturrunde oder stiller Datenverlust. Ein erzwungenes Objekt kann das
alles nicht: den `body` maskiert der **Transport**, und deshalb übersteht ein
`„…“`, dessen schließendes Zeichen das ASCII-`"` ist, die Übertragung Zeichen
für Zeichen.

**Der tolerante Leser** bleibt als Netz für Endpoints, die das Feld annehmen
und ignorieren (`parseJsonReply` in `server/src/entry-reply.ts`, von allen
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

**Die Gliederung** hat ihr eigenes Schema (`shared/schema/outline.schema.json`) und
das einzige, das keine Entität beschreibt: ein kleines, flaches Objekt aus
der Szenenliste, der Liste neuer NPCs (`npcs`), der Liste neuer Orte
(`locations`) und, für ein neues Kapitel, dessen Beschreibung.
Die **semantischen** Prüfungen bleiben auch
dort, wo sie sind: ein Schema kann nicht sagen „diese id kommt im ganzen
Durchlauf nur einmal vor“, „dieser `refs`-Eintrag ist eine Szene DIESER
Gliederung“ oder „das Kapitel kommt aus dem Kontext“.

**Die Few-Shots sind Antworten**: `example-output.json`,
`npc-example-output.json`, `location-example-output.json` und
`outline-example-output.json` zeigen genau das Objekt, in das der jeweilige
Aufruf gezwungen wird — derselbe Beispielinhalt wie vorher, nur in der Form,
die das Modell auch liefern soll.

## Ablauf eines Szenen-Laufs (Pipeline)

Ein Szenen-Lauf ist nicht **ein** Aufruf, sondern `1 + N (+ Vorschläge)`:

1. **Gliederung** (ein Aufruf, `outline-system-prompt.md` +
   `outline-example-output.json`): kleines JSON, per Schema erzwungen (siehe
   „Antwortformate“) — mit der Szenenliste: `id`,
   `title`, `type`, `location`, Querverweise (`refs`) — und je einer Liste
   neuer NPCs (`npcs`) und neuer Orte (`locations`), jeder Eintrag darin
   `{ id, name, summary }`. Jede Szene nennt zusätzlich den **ersten und
   letzten Satz ihres Quelltext-Abschnitts wörtlich** (`sourceExcerpt`); der
   Server schneidet den Abschnitt damit aus dem Quelltext. Findet er die
   Zitate nicht wörtlich wieder (Whitespace wird normalisiert, sonst nichts),
   bekommt die Szene den **ganzen** Quelltext und der Lauf eine Warnung —
   teurer, aber nie falsch. Validierung und Korrektur-Turns gelten für diesen
   Schritt allein.

   **Neues Kapitel:** Legt der Lauf sein Kapitel neu an („Neues Kapitel“),
   trägt der Kontext des Gliederungs-Aufrufs die Zeile `neues Kapitel: ja`,
   und die Gliederung beschreibt das Kapitel unter `chapterDescription` —
   ein bis drei Sätze aus dem Quelltext, worum es geht und was die Gruppe
   erreichen soll. „Entwürfe prüfen“ zeigt sie als „Beschreibung des
   Kapitels“, und das Übernehmen legt das Kapitel mit ihr als Text an. Für ein
   bestehendes Kapitel ist das Feld `null`, und was dort trotzdem steht,
   verwirft die Validierung: den Text eines bestehenden Kapitels erreicht
   kein Lauf. Eine fehlende Beschreibung kostet keinen Korrektur-Turn — das
   Kapitel beginnt dann mit leerem Text.

   **Obergrenze:** höchstens 12 Szenen und zusammen 12 neue NPCs und Orte je
   Lauf (`MAX_OUTLINE_SCENES` / `MAX_OUTLINE_PROPOSALS`). Jeder Teil ist ein
   Provider-Aufruf, also entscheidet die Gliederung, was ein Lauf kostet;
   darüber ist die Antwort ein Validierungsfehler und damit ein
   Korrektur-Turn, der um Zusammenfassen bittet — kein fehlgeschlagener Lauf.

   Die Gliederung ist ein **rein systeminterner** Schritt zur Fehlerreduktion.
   Sie wird dem Nutzer nie angezeigt und nie zum Bearbeiten angeboten (PO,
   15.09.) — interessant ist nur das Ergebnis je Szene/NPC/Ort und die
   Beschreibung eines neuen Kapitels. Der Server
   speichert sie auf der Job-Zeile, weil „Erneut versuchen“ und ein Neustart
   sie brauchen.

2. **Szenen** (je Szene ein Aufruf, Parallelität 3): `system-prompt.md` im
   Modus „genau eine Szene aus der Gliederung“ (`scene-single-output.md`
   tauscht nur das Ausgabeformat — alle Regeln bleiben wörtlich dieselben) +
   Gliederung + der geschnittene Quelltext-Abschnitt. Ausgabe: genau ein
   Szenen-Objekt. Validierung, Korrektur-Turns und Namensprüfung **je
   Szene**; ein fehlgeschlagener Teil blockiert die anderen nicht.

3. **Vorschläge** (je neuem NPC und je neuem Ort ein Aufruf):
   `npc-system-prompt.md` bzw. `location-system-prompt.md`, mit der
   Gliederung und den Abschnitten der Szenen, die den NPC nennen bzw. am Ort
   spielen. Dedupliziert über die id.

Was das dem DM bringt: ein Formfehler kostet nur den betroffenen Teil, fertige
Szenen sind sofort prüfbar und übernehmbar, und ein defekter Teil lässt sich
einzeln wiederholen (`POST …/generate/job/:id/parts/:key/retry`). Das
Job-Modell dazu steht in `docs/DECISIONS.md` (ADR #10).

**Prompt-Caching:** Der konstante Teil des Prompts — System-Prompt,
Kampagnenwissen, Glossar, Kontextlisten, Few-Shot, Gliederung — steht bei
jedem Aufruf **zuerst** und wird beim Claude-Provider mit
`cache_control: ephemeral` markiert (System-Prompt und konstanter Block je
eine Marke); OpenAI-kompatible Endpoints cachen denselben Prefix implizit. Nur
der variable Rest wechselt je Teil: **welche Szene dieser Aufruf schreibt**
(„## Diese Szene schreibst du jetzt“), der Ausschnitt, die bestehende Szene,
der bestehende NPC oder Ort, die Anweisung. Der Gliederungs-Block selbst ist für jeden Teil eines Laufs
**byteweise identisch** — deshalb steht die Zuweisung nicht darin.

Die Anzeige „~N Tokens · M Aufrufe“ summiert über alle Teile, die Gliederung
eingeschlossen.

**Ein Aufruf bleiben** (PO-Entscheid): die Ergänzen-Läufe und die
NPC-Generierung — je eine Szene, ein NPC oder ein Ort, nichts zu zerlegen.

## Ablauf pro Aufruf

Gilt für jeden EINZELNEN Provider-Aufruf — den Gliederungs-Aufruf, jeden
Szenen-Aufruf, jeden NPC- und Orts-Aufruf und die Ein-Aufruf-Läufe:

1. Server sammelt Kontext: alle npc-/location-ids + Namen, Kapitel-id,
   **Kampagnenwissen** und Glossar (beides aus der Datenbank —
   `campaign_knowledge` bzw. `glossary`).
2. Prompt = `system-prompt.md` + `example-output.json` (Few-Shot-Ziel)
   + Kampagnenwissen + Glossar + Kontext + Quelltext.
3. LLM antwortet — mit dem **Objekt der Entität** (Szene, NPC, Ort, Ergänzung)
   bzw. mit dem **Gliederungs-Objekt**, je per Schema erzwungen; siehe
   „Antwortformate“ oben.
4. Server validiert mechanisch (das Schema deckt die Form ab, hier steht der
   Inhalt):
   - nur bekannte Eigenschaften, kebab-`id`? `type`/`status` gültig?
     `status == draft`?
     NPC: `status` einer der vier Werte (Normalfall `alive`), das Schema
     erzwingt ihn; ein Ort hat kein `status`-Feld, sein Schema kennt keins.
   - alle `npcs`-/`location`-Referenzen existieren ODER liegen als Vorschlag
     desselben Laufs bei?
   - jedes `[[id]]` im Text nennt einen NPC, Ort oder eine Szene der
     Kampagne oder einen Vorschlag desselben Laufs (Gliederung, im NPC-Lauf
     der NPC selbst)? Im Ergänzen-Lauf zählen nur Verweise, die der
     Vorschlag neu bringt; `[[id]]` in Code ist kein Verweis.
   - nur bekannte Callout-Typen?
   Keine Prüfung sucht eine Überschrift (ADR #29): `## Weiß`,
   `## Beziehungen` & Co. sind Empfehlungen der Prompts, freier Text.
   Fehler gehen als Korrektur-Turn zurück ans LLM (konfigurierbar
   über LLM_CORRECTION_TURNS, 0–2, Default 1),
   nicht an den Nutzer. Ausnahme: eine vom Modell abgeschnittene Antwort
   (finish_reason/stop_reason) bricht sofort ab — Korrektur-Turns können
   ein Token-Limit nicht heilen, sie kosten nur.
5. Server prüft den fertigen Draft gegen die **Namenskonventionen** des
   Kampagnenwissens (Wortgrenzen, Groß/Klein-unabhängig, keine Heuristik)
   und legt Treffer als `namingHints` ins Job-Ergebnis.
6. App zeigt Review-Vorschau: Szenen editierbar, vorgeschlagene NPCs und
   Orte einzeln annehmen/ablehnen, Namens-Hinweise dezent daneben (kein
   Blocker).
   Erst „Übernehmen“ schreibt in die Datenbank.

## Kampagnenwissen

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

## Deutsche Orthografie

Alle System-Prompts (`system-prompt.md`, `npc-system-prompt.md`,
`location-system-prompt.md`, `augment-system-prompt.md`,
`location-augment-system-prompt.md` und `outline-system-prompt.md`) tragen
**dieselbe**
Regel „Deutsche Orthografie“: jeder echte Text — Fließtext, Read-Alouds,
Callouts, `## If:`-Bedingungen, Überschriften, `warnings` und jeder
Eigenschafts-Wert, der Text ist (`title`, `name`, `role`, `voice`,
`appearance`, `trigger`, `goal`, `statblock` …) — nutzt ä/ö/ü/ß als genau
diese Zeichen. **Einzige Ausnahme**: `id`-Werte (und
`location`, das eine id ist), die bleiben kebab-case ASCII; Eigennamen aus
dem Quelltext bleiben unverändert.

**Die Anführungszeichen gehören dazu**, als **ein** identischer Satz
in derselben Regel: deutsche typografische Anführungszeichen `„…“`
(U+201E/U+201C), einfache `‚…‘`, als Apostroph `’`. Die Mischform — U+201E
geöffnet, mit dem ASCII-Zeichen geschlossen — stand vorher durchgehend in
unseren Prompts, Few-Shots, Beispielen **und im UI-Katalog**, und das Modell
hat sie imitiert; alle vier sind umgestellt (nur die Anführungszeichen).
Zwei Tests halten es so: `app/src/i18n/i18n.test.ts` über die Katalog-WERTE
(im Quelltext ist das schließende ASCII-Zeichen vom String-Begrenzer
ununterscheidbar) und `server/test/typography.test.ts` über Prompts,
Few-Shots und `examples/`.

Die Regel steht in den drei Create-Prompts unter „## Regeln“ und im
Ergänzen-Prompt in der Ergänzungsregel — also genau **einmal** in jedem
zusammengesetzten Prompt, auch im Ergänzen-Modus, der von den Create-Prompts
nur den Formatabschnitt einschneidet (`formatContract` in
`server/src/generator-augment.ts`; beim NPC „## Die Felder des NPC“ aus
`npc-system-prompt.md` unter den NPC-Ergänzen-Prompt
`npc-augment-system-prompt.md`, `server/src/npc-augment.ts`, beim Ort
„## Die Felder des Orts“ aus `location-system-prompt.md` unter den
Ort-Ergänzen-Prompt `location-augment-system-prompt.md`,
`server/src/location-augment.ts`). Der Server korrigiert nichts nach: es
gibt keine Heuristik und kein stilles Ersetzen, die Regel wirkt allein im
Prompt.

## Tabellen

Dieselbe Mechanik wie bei der Orthografie-Regel: **eine identische Regel
„Tabellen“** in allen System-Prompts, die Einträge schreiben — der
Gliederungs-Prompt trägt sie nicht, weil er allein die Gliederung ausgibt
(die Orthografie-Regel steht dort trotzdem, weil Titel, Einzeiler und
`warnings` Text sind) — in den drei Create-Prompts unter
„## Regeln“, im Ergänzen-Prompt in der Ergänzungsregel, also genau **einmal**
in jedem zusammengesetzten Prompt (`formatContract` in
`server/src/generator-augment.ts` schneidet aus den Create-Prompts nur den
Formatabschnitt heraus).

Inhalt der Regel: Tabellen aus dem Quellmaterial — Zufallstabellen,
Begegnungs- und Würfellisten — werden als gültige GFM-Pipe-Tabelle
ausgegeben (Kopfzeile, `|---|`-Trennzeile, Rand-Pipes) und stehen im
passenden Callout, in jeder Zeile mit dessen `>`. **Aus GFM nutzt der
Generator ausschließlich diese Pipe-Tabelle**: Durchgestrichenes,
Aufgabenlisten, Fußnoten und Auto-Links bleiben normaler Text — genau so
rendert sie `app/src/markdown/remark-table.ts`.

Der Szenen-Few-Shot (`example-output.json`) zeigt eine kleine W6-Tabelle in
einem `[!note]`-Callout, damit das Modell die Form im Callout sieht statt sie
nur beschrieben zu bekommen. Tabellen bleiben unvalidiert: eine kaputte
Trennzeile ist Text — Degradation statt Fehler.

## NPC-Generator

Gleiche Pipeline, eigener Endpoint (`POST /api/campaigns/:campaign/generate/npc`)
und eigene Prompt-Assets (`npc-system-prompt.md` und `npc-example-output.json`
als Few-Shot-Ziel). Zielformat: der NPC aus README.md, ohne `rev`; `[[id]]`
nur auf NPCs, Orte und Szenen der Kampagne oder den NPC selbst, Quickstats
als Strings (das Plus überlebt), `status: alive` als Normalfall, `chapter`
leer. Ein Generator-Job pro Kampagne, egal ob Szenen oder NPC. Das Ergebnis
steht unter `npcResult.npc` und wird wie jeder vorgeschlagene NPC über seine
`id` übernommen.

Ein bestehender NPC wird an seiner Ressource ergänzt (`POST
…/npcs/<id>/augment`, übernommen mit `POST …/npcs/<id>/augment/apply`):
`npc-augment-system-prompt.md` trägt die Ergänzungsregel, der Abschnitt
„## Die Felder des NPC“ aus `npc-system-prompt.md` die Felder, und der
bestehende NPC steht im Prompt in der Antwort-Form (`quickstats` als Paare).

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
`LLM_PROVIDER`-Wert werden nicht verschluckt: `POST /api/campaigns/:campaign/generate`
antwortet `503` mit der Meldung im Klartext. Vollständige Variablen-Tabelle:
docs/DEPLOYMENT.md Abschnitt 2.

## Adressen bildet der Server

Das Modell liefert **Szenen, NPCs und Orte**, und der Server bildet die
Adresse einer Szene:

* Szenen: `<kapitel>/<id>` — Kapitel aus dem Kontext des Laufs, `id` aus
  den Eigenschaften. Die **Gruppe** kommt aus `location`, also lautet die
  gespeicherte Adresse `<kapitel>/<location>/<id>` (ohne `location`:
  Kapitelebene).
* Vorgeschlagene NPCs und Orte haben keine Adresse: sie stehen als NPCs bzw.
  Orte ohne `rev` unter `result.npcs` und `result.locations` und werden über
  ihre `id` geprüft, entschieden und übernommen (`accept { npcs: [<id>],
  locations: [<id>] }`; die Antwort nennt die geschriebenen unter `npcs` und
  `locations`).
* NPC-Lauf und Ergänzen-Lauf: ein Objekt ohne `path`; beim Ergänzen steht
  das Ziel ohnehin serverseitig fest — bei NPC und Ort ist es die Ressource,
  an der der Lauf hängt (`POST …/npcs/<id>/augment`, `POST
  …/locations/<id>/augment`, übernommen mit `…/augment/apply`).

Der Prüfschritt adressiert die Teile eines Laufs weiterhin über die vom
Server gebildete Adresse (`GenerateResult.scenes[].path` = `<kapitel>/<id>`);
beim Übernehmen kann die tatsächlich geschriebene Adresse davon abweichen,
wenn die Szene eine `location` nennt — genau dafür meldet die Antwort
`written: { <prüfschritt-adresse>: <geschriebene adresse> }`.
