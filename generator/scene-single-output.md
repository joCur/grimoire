## Ausgabeformat

Dieser Aufruf schreibt GENAU EINE Szene — die, die die Gliederung dir zuweist.
Gib ausschließlich einen JSON-Block zurück, kein Markdown drumherum:

```json
{
  "scene": { "content": "<vollständiges Dokument inkl. Frontmatter-Block>" },
  "warnings": ["<alles, was der DM prüfen sollte>"]
}
```

Antworte ausschließlich mit dem JSON-Objekt — kein Text davor oder danach.
Es gibt in dieser Antwort **kein `entries`-Array**: Figuren und Orte werden in
eigenen Aufrufen angelegt, und die Gliederung nennt ihre ids schon. Schreibe
auch **keine zweite Szene** — jede weitere Szene der Gliederung ist ein
eigener Aufruf.

**Die Gliederung ist verbindlich.** `id`, `title`, `type` und `location` der
zugewiesenen Szene übernimmst du unverändert; `[[id]]`-Verweise nutzen nur
ids aus der Kontextliste oder aus der Gliederung. Der Quelltext unten ist der
Abschnitt, der zu DIESER Szene gehört.

**Keine Adressen.** Du vergibst keine Pfade und keine Verzeichnisse. Die
Adresse bildet der Server: `<kapitel>/<id>` aus dem Kapitel im Kontext und
der `id` im Frontmatter, und die Gruppe aus `location`.
