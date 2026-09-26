# Schreiben: in der App, mit Wächter, ein Weg je Entität

## Entscheidung

### App-first

Bearbeitet wird in der App. Das Zielbild sind alle Pflege-Operationen aus der
App heraus, und die Priorisierung richtet sich danach. Die Datenbank ist die
Wahrheit (`decisions/sqlite`); einen Datenpfad an der App vorbei, etwa einen
externen Editor, gibt es nicht. Schreibzugriffe der App laufen nur über die
dokumentierte API.

Log-Zeilen und Ideen sind append-only: sie werden einmal geschrieben. Die
einzigen Änderungen danach sind das Sichten einer Log-Zeile (`reviewed`) und
das Abhaken einer Idee (`done`); ein anderes Feld im Patch ist 400.

### Ein Wächter je Zeile

Jede Entität trägt ihr eigenes `rev`, die Zeilenversion. Ein Schreibzugriff
gilt nur bei unverändertem `rev`, bewegt nur das `rev` der Zeile, die er
schreibt, und sonst ist er 409. Einen Zähler über alle Zeilen einer Art gibt
es nicht. Eine Reihenfolge hat ihren eigenen Wächter (`decisions/resources`,
`decisions/scene-order`).

### Ein Schreibweg je Entität

Jede Entität hat genau einen Schreibweg, `PATCH` auf ihrer eigenen Ressource
mit `{ rev, force?, …Teilmenge ihrer Felder }`, geprüft gegen das Schema der
Entität.

- Mindestens ein Feld muss dabei sein, sonst 400 `nothing_to_write`. Alle
  Felder zusammen sind **ein** Schreibvorgang in einer Transaktion, gegen
  **einen** `rev`: eine Zeilen-Änderung, ein Schritt von `rev`, ein
  Versions-Zähler, ein Index-Lauf. Wie viel eine Anfrage trägt, ist an `rev`
  nicht ablesbar.
- `null` löscht ein optionales Feld. Ein Feld, das die Entität nicht hat, oder
  ein Wert der falschen Form ist eine 400, die das Feld nennt. Die `id` wird
  nie geändert (`decisions/constraints`).
- Ein veralteter `rev` ist 409 `rev_conflict` und trägt neben dem aktuellen
  `rev` den **aktuellen Stand** der Ressource unter dem Namen der Entität
  (`{ thread }`, `{ idea }`, `{ glossaryTerm }` …): der Konfliktdialog zeigt,
  was im Weg steht, ohne nachzuladen. Dieselbe 409-Form gilt für jeden
  Schreibzugriff mit Wächter.
- `force: true` schreibt auf die Zeile, wie sie jetzt ist, und schreibt nur
  die mitgeschickten Felder: ein fremd geänderter Status übersteht ein
  erzwungenes Text-Speichern.
- Anlegen antwortet mit dem Typ der Entität, auch `POST /api/campaigns`
  (`Campaign`), und trägt kein `rev`, denn eine neue Zeile überschreibt
  nichts. `DELETE` trägt `{ rev }` wie jeder Schreibzugriff mit Wächter.
- Die App hält den `rev` der laufenden Bearbeitung und schickt ihn mit, statt
  ihn einzufrieren und zu raten.

### Konfliktzeile in der App

Ein Dialog oder Editor zeigt bei 409 die Konfliktzeile mit zwei Aktionen:
„Neu laden" verwirft den Entwurf und übernimmt den gespeicherten Stand,
„Trotzdem speichern" schreibt mit `force` nur die Felder, die sich geändert
haben — eine fremd geänderte Eigenschaft bleibt.

## Warum

Alle Felder einer Entität, `body` eingeschlossen, liegen in einer Zeile und
teilen einen Wächter. Zwei Schreibwege auf dieselbe Zeile machten die erste
Antwort durch den zweiten Aufruf selbst ungültig, und die App müsste den
nächsten `rev` erraten, statt ihn zu kennen.

Stilles Überschreiben ist der eine Fehler, den ein Einzelnutzer mit zwei Tabs
trotzdem hat. Der Wächter fängt ihn ab; `force` mit nur den geänderten
Feldern hält den bewussten Überschreib-Fall so schmal wie möglich.

## Folgen

- Weil alle Felder einer Szene eine Zeile und einen Wächter teilen, ist auch
  ein reiner Status-Write eines Zweitschreibers ein Konflikt für einen offenen
  Texteditor.
- Das Übernehmen eines Generator-Vorschlags ist kein Weg an diesen Regeln
  vorbei: es prüft dieselben Felder und Referenzen wie das Anlegen seiner
  Entität (`decisions/generator`).
- Jeder Schreibzugriff zählt zusätzlich `campaigns.version` hoch
  (`decisions/polling`); das ist kein Wächter.
