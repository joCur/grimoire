# Entscheidungen

Die Architektur-Entscheidungen von Grimoire, eine Datei je Thema. Sie sind
bindend; eine Abweichung braucht eine geänderte oder neue Datei.

## Wie Entscheidungen geführt werden

- Eine Datei hält nur Zielentscheidungen fest: was heute gilt. Es gibt keine
  befristeten Entscheidungen und keine Zwischenstände; der Zwischenstand eines
  in Scheiben geschnittenen Umbaus steht allein im Ticket.
- Jede Datei hat einen sprechenden Namen, keine Nummer und kein Datum, und
  gliedert sich in `## Entscheidung`, `## Warum` und `## Folgen`.
- Eine Änderung schreibt die betroffene Datei um oder legt eine neue an. Eine
  Regel steht in genau einer Datei; berührt sie ein anderes Thema, verweist
  die andere Datei auf sie.
- Die Geschichte einer Entscheidung steht in git, nicht in der Datei.
- Zitiert wird in Code-Kommentaren als `decisions/<name>`, in Dokumenten als
  Link auf `docs/decisions/<name>.md`.

## Dateien

- [scope.md](scope.md) — Einzelnutzer-Werkzeug für den DM: kein VTT, kein
  Wiki, keine Spieler-Ansicht, kein Roll20-Sync, Zugriffsschutz vor der App.
- [stack.md](stack.md) — Tech-Stack, Bun-Workspace-Monorepo mit `shared/`,
  Node-Portabilität und die eine eingetragene Bun-only-API, Wachstumspfad.
- [dependencies.md](dependencies.md) — etablierte Pakete statt Eigenbau.
- [sqlite.md](sqlite.md) — eine SQLite-Datei ist die Quelle der Wahrheit:
  Markdown als Body-Format, Drizzle, Migrationen ab der Baseline, FTS5,
  `GRIMOIRE_DATA`, Seed-Werkzeug.
- [constraints.md](constraints.md) — Referenzen als Fremdschlüssel, Status
  und Typ als CHECK, unveränderliche ids, leere Zeilen.
- [resources.md](resources.md) — eine Ressource, ein Typ, ein zod-Modul je
  Entität; URL-Schema, Kinder einer Session, Reihenfolgen, App-Slices.
- [writes.md](writes.md) — App-first, Wächter `rev`, 409 mit aktuellem Stand,
  ein Schreibweg je Entität, `force`.
- [data-shape.md](data-shape.md) — Daten sind Felder und Zeilen, nie
  Text-Abschnitte; Fäden; Fixtures in der Form der API.
- [scene-order.md](scene-order.md) — Kapitel-Status und ein aktives Kapitel,
  der Ort einer Szene, die Szenenreihenfolge mit eigenem Wächter.
- [generator.md](generator.md) — LLM-Generator: Provider, Antwort-Schema,
  serverseitige Jobs, Pipeline aus Teilen, Prüfzustand am Job, Übernehmen.
- [polling.md](polling.md) — Client-Aktualisierung über den Versionszähler.
- [i18n.md](i18n.md) — typisierter Katalog, ICU über `intl-messageformat`,
  sprachfreier Server, Lint-Gate.
- [release.md](release.md) — release-please, Conventional Commits,
  Versions-Tags, `:latest` nur beim Release, CI publiziert nie.
