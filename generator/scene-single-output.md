## Ausgabeformat

Dieser Aufruf schreibt GENAU EINE Szene — die, die die Gliederung dir zuweist.

Du antwortest mit **einem JSON-Objekt**. Das Schema ist verbindlich und wird
von der Schnittstelle erzwungen — es trägt die Felder der Szene und daneben
`warnings`:

* jedes Feld der Szene als eigener Schlüssel: `id`, `title`, `type`,
  `trigger`, `chapter`, `location`, `npcs`, `handouts`, `tags`, `status` und
  `body`. Ein Feld, das der Quelltext hergibt, trägt seinen Wert; `trigger`
  und `location` tragen sonst `null`, eine Liste sonst `[]`. Der Server
  speichert die Szene genau so.
* `body` ist der Fließtext der Szene, als **ein** String mit echten
  Zeilenumbrüchen: Überschriften, Callouts, `## If:`-Abschnitte.
* `warnings` — kurze deutsche Hinweise für den DM, einer je Hinweis; bei
  klarer Quelle bleibt die Liste leer.

Das Referenz-Beispiel unten ist genau diese Form.

Diese Antwort ist **genau eine** Szene. Jede weitere Szene der Gliederung ist
ein eigener Aufruf, und Figuren und Orte entstehen ebenfalls in eigenen
Aufrufen — die Gliederung nennt ihre ids schon.

**Die Gliederung ist verbindlich.** `id`, `title`, `type` und `location` der
zugewiesenen Szene übernimmst du unverändert; `chapter` ist die Kapitel-id
aus dem Kontext. Für `[[id]]`-Verweise gelten allein die ids aus der
Kontextliste oder aus der Gliederung. Der Quelltext unten ist der Abschnitt,
der zu DIESER Szene gehört.

