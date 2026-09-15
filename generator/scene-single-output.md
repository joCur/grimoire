## Ausgabeformat

Dieser Aufruf schreibt GENAU EINE Szene — die, die die Gliederung dir zuweist.

Gib **das Dokument selbst** zurück — kein JSON, keine Code-Zäune, kein Text
davor oder danach. Die Antwort beginnt mit der Zeile `---` des
Frontmatter-Blocks und ist genau das, was danach in der Datei steht:

```
---
<Frontmatter-Schlüssel, siehe Ziel-Format>
---

<Fließtext der Szene>
```

Hinweise für den DM kommen **danach**, hinter einer Zeile `---warnings---`,
eine Warnung je Zeile:

```
---warnings---
Der Quelltext nennt keinen DC — DC 13 gesetzt.
```

Gibt es nichts zu melden, lässt du den Block ganz weg.

Vor dem Dokument und nach dem Dokument steht **nichts** — keine Anrede, keine
Erklärung, kein Schlusssatz: das Einzige, was nach dem Dokument stehen darf,
ist der `---warnings---`-Block. Ein Satz danach landet sonst als Fließtext in
der Datei.

Schreibe **keine zweite Szene** — jede weitere Szene der Gliederung ist ein
eigener Aufruf — und **keinen NPC- oder Ort-Eintrag**: Figuren und Orte werden
in eigenen Aufrufen angelegt, und die Gliederung nennt ihre ids schon.

**Die Gliederung ist verbindlich.** `id`, `title`, `type` und `location` der
zugewiesenen Szene übernimmst du unverändert; `[[id]]`-Verweise nutzen nur
ids aus der Kontextliste oder aus der Gliederung. Der Quelltext unten ist der
Abschnitt, der zu DIESER Szene gehört.

**Keine Adressen.** Du vergibst keine Pfade und keine Verzeichnisse. Die
Adresse bildet der Server: `<kapitel>/<id>` aus dem Kapitel im Kontext und
der `id` im Frontmatter, und die Gruppe aus `location`.
