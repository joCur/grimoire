# Abhängigkeiten statt Eigenbau

## Entscheidung

Für allgemeine Aufgaben wird ein etabliertes Paket eingebunden, nicht selbst
gebaut — Validierung, Schemata, Datum und Zeit, Diffs, das Lesen gängiger
Formate und was sonst nicht Grimoire-spezifisch ist. Selbst geschrieben wird,
was nur Grimoire hat: das Datenmodell, die Schreibregeln, das Text-Vokabular,
die Oberfläche.

## Warum

Was wir nicht selbst pflegen, müssen wir nicht bedenken und nicht testen. Ein
Hand-Helfer für eine Standardaufgabe kostet jedes Mal dasselbe: Randfälle, die
das Paket längst kennt, eigene Tests dafür und eine Stelle mehr, die beim
nächsten Umbau mitgezogen werden will. Ein etabliertes Paket bringt das mit,
ist dokumentiert und von vielen geprüft. Die Kosten einer Abhängigkeit — ein
Eintrag im Lockfile, gelegentlich ein Update — sind kleiner als die eines
eigenen Nachbaus.

## Folgen

- Eine neue Abhängigkeit braucht keinen Eintrag in `docs/decisions/`.
  Eintragspflichtig bleiben allein Bun-only-APIs (`decisions/stack`).
- „Etabliert" heißt: verbreitet, gepflegt, mit Typen. Versionen stehen im
  Lockfile und werden bewusst angehoben; wo ein Paket exakt gepinnt werden
  muss, steht der Grund an seiner Stelle (`jsonrepair`, `decisions/generator`).
- Anwendungen: `date-fns` für Datum und Zeit, `zod` für das Schema jeder
  Entität (`decisions/resources`), `intl-messageformat` für Plural und
  Interpolation (`decisions/i18n`).
