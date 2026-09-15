## Ausgabeformat

Dieser Aufruf schreibt GENAU EINE Szene — die, die die Gliederung dir zuweist.

Du antwortest mit **einem JSON-Objekt**. Das Schema ist verbindlich und wird
von der Schnittstelle erzwungen — es hat genau diese drei Schlüssel:

* `properties` — die Eigenschaften aus dem Ziel-Format, jedes als
  eigener Schlüssel. Ein Feld, das der Quelltext nicht hergibt: `null`. Den
  Eigenschaften-Block baut der Server daraus; du schreibst kein YAML.
* `body` — der Fließtext unter dem Block, als **ein** String mit echten
  Zeilenumbrüchen: Überschriften, Callouts, `## If:`-Abschnitte. Ohne
  Eigenschaften-Block — der steckt in `properties`.
* `warnings` — kurze deutsche Hinweise für den DM, einer je Eintrag; gibt es
  nichts zu melden, ist die Liste leer.

Das Referenz-Beispiel unten ist genau diese Form.

Schreibe **keine zweite Szene** — jede weitere Szene der Gliederung ist ein
eigener Aufruf — und **keinen NPC- oder Ort-Eintrag**: Figuren und Orte werden
in eigenen Aufrufen angelegt, und die Gliederung nennt ihre ids schon.

**Die Gliederung ist verbindlich.** `id`, `title`, `type` und `location` der
zugewiesenen Szene übernimmst du unverändert; `[[id]]`-Verweise nutzen nur
ids aus der Kontextliste oder aus der Gliederung. Der Quelltext unten ist der
Abschnitt, der zu DIESER Szene gehört.

**Keine Adressen.** Du vergibst keine Pfade und keine Verzeichnisse. Die
Adresse bildet der Server: `<kapitel>/<id>` aus dem Kapitel im Kontext und
der `id` in den Eigenschaften, und die Gruppe aus `location`.
