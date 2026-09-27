## Regeln

0. **Referenzen im Fließtext**: Nennen `motivation` oder `body` eine Figur,
   einen Ort oder eine Szene mit id, schreibe `[[id]]` statt des Namens
   (`[[jorna]] zahlt gut`) — die App setzt beim Anzeigen den aktuellen Namen
   ein. In den Klammern steht allein die id, Endungen stehen außerhalb
   (`[[jorna]]s Kai`). Dieselbe Form gilt in jedem Abschnitt, auch unter
   `## Beziehungen`: `- [[jorna]]: <Freitext>`.
1. **id**: kebab-case, kurz, stabil gedacht (`fenn` statt
   `der-schmuggler-aus-der-nordbucht`). Die ASCII-Beschränkung gilt
   AUSSCHLIESSLICH für die `id` — `name`, `role`, `voice`,
   `appearance`, `motivation` und der Fließtext bleiben deutsch geschrieben
   (siehe Regel 11).
   Die id ist **neu** gegenüber jeder id aus der Kontextliste, damit
   bestehende NPCs stehen bleiben. Ist im Kontext eine
   `vorgegebene id` genannt, benutze genau diese.
2. **status**: `alive`, oder das, was der Quelltext eindeutig sagt
   (`dead`/`missing`/`unknown`). Das Feld trägt immer genau einen dieser vier
   Werte.
3. **quickstats**: nur was sozial am Tisch gebraucht wird (Insight, Deception,
   Persuasion, passive Perception …). Werte immer als **String in
   Anführungszeichen** (`"+2"`) — das Plus ist der ganze Sinn eines sozialen
   Modifikators. Ganze Statblocks gehören hinter `statblock`.
4. **statblock**: setze es, wenn der Quelltext ein Sheet/einen Statblock
   nennt; Format `"Roll20: <Name>"`. Sonst trägt das Feld `null`.
5. **`chapter`**: Das Feld trägt `null` — der DM setzt es später.
6. **Quelltreu bleiben**: Fähigkeiten, Verwandte, Orte und Geheimnisse
   stammen aus dem Quelltext. Lücken gehören in `warnings`.
7. **Callouts**: `[!secret]` trägt das Wissen, das allein dem DM gehört
   (empfohlen unter `## Weiß`). `[!note]`, `[!check]`, `[!readaloud]`,
   `[!outcome]` und `[!loot]` stehen sparsam dort, wo sie passen. Genau diese
   sechs Typen.
8. **Kampagnenwissen**: Der Abschnitt „Kampagnenwissen“ im Prompt ist
   verbindlich und gewinnt gegen den Quelltext. Namenskonventionen gelten
   überall — `name`, `role`, `motivation`, Fließtext, Callouts. Fehlt der Abschnitt, gilt
   für diese Kampagne allein der Quelltext.
9. **Übersetzung**: Nutze das mitgelieferte Glossar strikt. Regelbegriffe
   (Checks, Skills, Conditions, advantage/disadvantage, DCs) bleiben Englisch.
10. **Warnings**: kurze deutsche Hinweise für den DM — fehlende Motivation,
   Figuren ohne id, unklarer Status, geraten wirkende Werte.
11. **Deutsche Orthografie**: Jeder echte Text nutzt die volle deutsche
   Rechtschreibung — ä, ö, ü und ß stehen als genau diese Zeichen. Das gilt
   für Fließtext, Read-Alouds, alle Callouts, `## If:`-Bedingungen,
   Überschriften, `warnings` und für jedes Feld, das Text ist (`name`,
   `role`, `voice`, `appearance`, `motivation`, `statblock`, `body`).
   **Einzige Ausnahme**: `id`-Werte — die bleiben kebab-case ASCII. Eigennamen aus dem Quelltext bleiben genau
   so geschrieben, wie sie dort stehen. **Anführungszeichen**: deutsche
   typografische Anführungszeichen „…“ (unten öffnend U+201E, oben
   schließend U+201C), einfach ‚…‘, als Apostroph ’.
12. **Tabellen**: Tabellen aus dem Quellmaterial — Zufallstabellen, Begegnungs-
   und Würfellisten — gibst du als gültige GFM-Pipe-Tabelle aus: Kopfzeile,
   Trennzeile aus `|---|` (eine Zelle je Spalte) und Rand-Pipes links und
   rechts in jeder Zeile. Die Tabelle steht im passenden Callout (Zufalls-
   und Begegnungstabellen in `[!note]`, Probenreihen in `[!check]`, Beute in
   `[!loot]`) und trägt in jeder Zeile das `>` des Callouts. **Aus GFM nutzt
   du ausschließlich diese Pipe-Tabelle**: Durchgestrichenes (`~~x~~`),
   Aufgabenlisten (`- [x]`), Fußnoten und Auto-Links schreibst du als
   normalen Text, und genau so werden sie gerendert. Eine Tabelle entsteht
   dort, wo das Quellmaterial eine hat; fließender Text bleibt Fließtext.

## Beispiel (Few-Shot)

### Eingabe (Quelltext)

> **Fenn** runs the smuggling operation in the north cove. He is polite,
> soft-spoken, and gets quieter the more dangerous a situation becomes: a
> smuggler, not a killer — he wants the job finished without anyone dying,
> and that is the lever the party can pull. He knows the name of his
> employer but will only give it up once his own way out is secured. He and
> harbormaster Jorna go back a long way; he avoids her eyes. Salt-crusted
> leather jacket, silver ring on the thumb. Use his Roll20 sheet ("Fenn");
> Insight +2, passive Perception 13.

### Kontext (Auszug)

```
npcs: jorna (Hafenmeisterin Jorna)
locations: bucht (Die Schmugglerbucht)
```

### Erwartete Ausgabe

Der NPC `fenn` mit `status: alive`, `role` als Einzeiler,
`statblock: "Roll20: Fenn"`, quickstats als Strings, `motivation` (Auftrag
ohne Tote — der wunde Punkt) und einem `body` mit `## Weiß` samt einem
`[!secret]` (Name des Auftraggebers, Bedingung fürs Reden) und
`## Beziehungen` mit genau `- [[jorna]]: …` (id existiert im Kontext). Das
Referenz-Beispiel liegt dem Prompt als `npc-example-output.json` bei.
