## Regeln

0. **Referenzen im Fließtext**: Nennen `body` oder `atmosphere` eine Figur,
   einen Ort oder eine Szene mit id, schreibe `[[id]]` statt des Namens
   (`[[jorna]] hält die Schlüssel`). In den Klammern steht allein die id,
   Endungen stehen außerhalb (`[[jorna]]s Boot`).
1. **id**: kebab-case, kurz, stabil gedacht (`leuchtturm` statt
   `der-alte-leuchtturm-oben-am-kap`). Die ASCII-Beschränkung gilt
   AUSSCHLIESSLICH für die `id` — `name`, `atmosphere`, Überschriften und
   der Fließtext bleiben deutsch geschrieben (siehe Regel 10).
2. **Genau diese Felder**: Der Ort trägt die Felder aus dem Abschnitt oben und
   sonst keine.
3. **`chapter`**: eine Kapitel-id aus der Kontextliste oder der Gliederung,
   wenn der Ort eindeutig dorthin gehört. Sonst trägt das Feld `null` — der DM setzt es später.
4. **`roll20Page`**: setze es, wenn der Quelltext eine Page/Karte nennt;
   sonst trägt das Feld `null`, und die Lücke gehört in `warnings`.
5. **Quelltreu bleiben**: Räume, Bewohner, Geheimnisse und Schätze stammen
   aus dem Quelltext. Lücken gehören in `warnings`.
6. **Callouts**: `[!readaloud]` für Vorlesetext, `[!secret]` für Wissen, das
   allein dem DM gehört, `[!check]` für Würfelmechanik am Ort,
   `[!loot]` für Beute, `[!note]` für DM-Hinweise. Genau diese fünf Typen.
7. **Kampagnenwissen**: Der Abschnitt „Kampagnenwissen“ im Prompt ist
   verbindlich und gewinnt gegen den Quelltext. Namenskonventionen gelten
   überall — `name`, Überschriften, Fließtext, Callouts.
8. **Übersetzung**: Nutze das mitgelieferte Glossar strikt. Regelbegriffe
   (Checks, Skills, Conditions, advantage/disadvantage, DCs) bleiben Englisch.
   Read-Alouds: atmosphärisch, „ihr“-Anrede, Präsens.
9. **Warnings**: kurze deutsche Hinweise für den DM — fehlender erster
   Eindruck, unklare Zuordnung zu einem Kapitel, geraten wirkende Details
   im Quelltext.
10. **Deutsche Orthografie**: Jeder echte Text nutzt die volle deutsche
   Rechtschreibung — ä, ö, ü und ß stehen als genau diese Zeichen. Das gilt
   für Fließtext, Read-Alouds, alle Callouts, `## If:`-Bedingungen,
   Überschriften, `warnings` und für jedes Feld, das Text ist (`name`,
   `atmosphere`, `body`). **Einzige Ausnahme**: `id`-Werte — die bleiben
   kebab-case ASCII. Eigennamen aus dem Quelltext bleiben genau so
   geschrieben, wie sie dort stehen. **Anführungszeichen**: deutsche
   typografische Anführungszeichen „…“ (unten öffnend U+201E, oben
   schließend U+201C), einfach ‚…‘, als Apostroph ’.
11. **Tabellen**: Tabellen aus dem Quellmaterial — Zufallstabellen, Begegnungs-
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

> **The lighthouse of Salzhafen.** Inside it smells of cold lamp oil and
> salt. The spiral stair disappears into the dark above you; a half-eaten
> meal sits on the table, untouched for days. The place was abandoned in a
> hurry, not in a fight: nothing is knocked over, everything is simply left
> behind. Nobody is there — which is precisely the problem. Harbormaster
> Jorna says she last saw the tower manned three days ago. Use the Roll20
> page "Leuchtturm".

### Kontext (Auszug)

```
npcs: jorna (Hafenmeisterin Jorna)
locations: bucht (Die Schmugglerbucht)
```

### Erwartete Ausgabe

Der Ort `leuchtturm` mit `name`, `chapter: 01-salzhafen`,
`roll20Page: "Leuchtturm"`, `atmosphere` (in Eile verlassen, `[[jorna]]` als
Referenz) und einem `body` mit `## Beim ersten Betreten` als `[!readaloud]`
und `## Wer ist hier` (niemand). Das Referenz-Beispiel liegt dem Prompt als
`location-example-output.json` bei.
