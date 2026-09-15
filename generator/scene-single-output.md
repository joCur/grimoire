## Ausgabeformat

Dieser Aufruf schreibt GENAU EINE Szene — die, die die Gliederung dir zuweist.

Du antwortest mit **einem JSON-Objekt**. Das Schema ist verbindlich und wird
von der Schnittstelle erzwungen — es hat genau diese drei Schlüssel:

* `properties` — die Eigenschaften des Eintrags, jede als eigener Schlüssel.
  Ein Feld, das der Quelltext hergibt, trägt seinen Wert; jedes andere trägt
  `null`. Den Eigenschaften-Block baut der Server daraus.
* `body` — der Text des Eintrags, als **ein** String mit echten
  Zeilenumbrüchen: Überschriften, Callouts, `## If:`-Abschnitte. Die
  Eigenschaften bleiben in `properties`.
* `warnings` — kurze deutsche Hinweise für den DM, einer je Hinweis; bei
  klarer Quelle bleibt die Liste leer.

Das Referenz-Beispiel unten ist genau diese Form.

Diese Antwort ist **genau eine** Szene. Jede weitere Szene der Gliederung ist
ein eigener Aufruf, und Figuren und Orte entstehen ebenfalls in eigenen
Aufrufen — die Gliederung nennt ihre ids schon.

**Die Gliederung ist verbindlich.** `id`, `title`, `type` und `location` der
zugewiesenen Szene übernimmst du unverändert; für `[[id]]`-Verweise gelten
allein die ids aus der Kontextliste oder aus der Gliederung. Der Quelltext
unten ist der Abschnitt, der zu DIESER Szene gehört.

**Adressen vergibt der Server.** Er bildet sie als `<kapitel>/<id>` aus dem Kapitel im Kontext und
der `id` in den Eigenschaften, und die Gruppe aus `location`.
