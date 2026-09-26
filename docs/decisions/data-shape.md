# Daten sind Felder und Zeilen, nie Text-Abschnitte

## Entscheidung

Was eine Ansicht, ein Schreibweg oder eine Prüfung als Daten braucht, ist ein
**Feld** einer Entität oder eine **eigene Zeile** (`decisions/resources`) —
nie ein Abschnitt, der über den Text seiner Überschrift gefunden wird.
Überschriften im Text gliedern ihn für den DM; eine Bedeutung für den Code
hat allein `## If:`, ein Element des Renderers (README.md). Im Code von
`app/`, `server/` und `shared/` sucht allein `## If:` eine Überschrift per
Text.

Eine Zeile ist ihre Spalten: kein Markdown in der Zeile, kein Leser, der Text
in Zeilen zurückparst, und keine Skelett-Zeilen, die nur ein Text bräuchte
(Überschriften, Marker). Eine Pause ist eine Zeile der Pausen einer Session
und keine Log-Zeile: Pausieren schreibt keine Log-Zeile.

Eine Migration, die ein solches Feld oder eine solche Zeile einführt,
**überträgt nichts** aus dem Text: ein bestehender Abschnitt bleibt freier
Text (`decisions/sqlite`, Regel 2).

### Motivation und Atmosphäre

- `npcs.motivation` und `locations.atmosphere` sind Spalten und damit Felder
  (`motivation`, `atmosphere`). NPC-Karte, Ort-Karte, Hover-Vorschau und
  Leseansicht lesen sie; ein `## Will` oder `## Atmosphäre` im Text hat darauf
  keinen Einfluss. Ein `[[id]]` im Wert erscheint bei der Anzeige als
  aktueller Name, ohne Referenz zu sein (`decisions/constraints`); ohne Zeile
  steht es als Text da. Die Suche indexiert beide Felder mit aufgelösten
  Namen.
- Bearbeitet werden sie im Bearbeiten-Modus der Leseansicht neben dem Text,
  nicht im Eigenschaften-Dialog. Sie teilen den einen Wächter der Zeile
  (`decisions/writes`).
- Der Generator liefert beide Felder über das Antwort-Schema, nullable wie
  `voice` und `appearance`; NPC- und Ort-Prompt beschreiben sie als Feld.

### Die Fäden eines Kapitels

- Ein Faden ist eine Zeile der Tabelle `threads` und nie eine Checkliste im
  Kapiteltext: `campaign_id`, eine opake `id` (eindeutig je Kampagne, nicht je
  Kapitel und nicht die Position), das Kapitel `chapter_id` als
  Fremdschlüssel, `text`, `done`, `pos`. Ein Faden liegt flach unter der
  Kampagne, sein Kapitel ist ein Feld, und er hat sein eigenes `rev`. Ein
  weiterer Anker (Szene, Kampagne) wäre eine weitere Besitzer-Spalte.
- Anlegen trägt kein `rev`, wie Idee und Log-Zeile: ein Anhängen
  überschreibt nichts, und ein Wächter würde „Handlungsstrang übernehmen" nur
  deshalb abweisen, weil sich in einem anderen Tab etwas bewegt hat.
- **Getrennte Wächter:** kein Schreibzugriff auf einen Faden berührt Text oder
  `rev` des Kapitels, und ein Kapitel-Write bewegt keinen Faden.
- „Handlungsstrang übernehmen" in der Nachbereitung legt einen Faden im
  aktiven Kapitel an; die Kapitelübersicht zeigt die Fäden unter dem
  Kapiteltext, in der Reihenfolge des Anlegens, und pflegt sie (anlegen,
  abhaken, umformulieren, löschen).
- Fäden werden nicht indexiert, wie die Ideen, und erreichen keinen
  Generator-Prompt; ein Szenen-Lauf kennt vom Kapitel nur die id.
- Ein Abschnitt `## Offene Fäden` im Kapiteltext ist freier Text.

### Kapitel und Kampagne zeigen ihren ganzen Text

- Die Kapitelübersicht zeigt den **ganzen Text** des Kapitels, ihr Kopf unter
  der Kurzbeschreibung den ganzen Text der Kampagne — beide durch denselben
  Renderer wie jeder Text (Callouts, `## If:`, `[[id]]`), auf wenige Zeilen
  begrenzt und aufklappbar. Ob der Text länger ist, wird gemessen; „Mehr
  anzeigen" steht nur dann da. Ausgewählt wird nichts, und keine Überschrift
  hat für die Anzeige eine Bedeutung.
- „Kapitel anlegen" schreibt die Beschreibung aus dem Dialog als `body` des
  Kapitels (`POST …/chapters { title, id?, status?, body? }`), so wie sie
  getippt wurde — getrimmt, mit einem abschließenden Zeilenumbruch, ohne
  Überschrift davor.
- Ein Kapitel mit `## Ziel des Kapitels` zeigt diese Überschrift als Teil
  seines Textes.

### Fixtures sind die Form der API

Es gibt genau ein Fixture-Format, und es ist die Form der API: die
Beispielkampagne liegt unter `fixtures/` als die Objekte, die ihre
Ressourcen liefern, eine Datei je Entität und id unter
`fixtures/<kampagne>/<ressource>/<id>.json` (etwa
`fixtures/beispiel/locations/leuchtturm.json`), jede ohne `rev`. Auch
Sessions (mit Pausen, Log-Zeilen und gespielten Szenen), Ideen und
Glossar-Begriffe liegen strukturiert vor, nicht als Text. Jede Beispielszene
nennt ihren Ort selbst. `grimoire seed <dir>` liest sie und schreibt sie über
die Store-Schicht. Einen Importer gibt es nicht. Die Bodies bleiben Zeichen
für Zeichen, wie sie sind; ihr Format ist Vertrag.

## Warum

Ein Abschnitt, den Code über den Text seiner `##`-Überschrift findet, ist eine
Absprache mit dem DM, die still bricht: Leser und Schreiber erkennen
Überschriften leicht nach verschiedenen Regeln (Groß/Klein, CRLF), und was der
DM anders schreibt, fällt still heraus oder entsteht doppelt. Die Speicherung
leitet nichts aus Text ab (`decisions/constraints`); dasselbe gilt für
Anzeige, Schreibwege und Prüfungen. Einen Wert bei einer Migration aus einem
Markdown-Abschnitt zu schneiden, wäre genau der Leser, den diese
Entscheidung ausschließt.

Kein Produktivpfad importiert, und wer die App frisch installiert, legt seine
Kampagne in der UI an. Ein Seed, der durch einen Parser läuft, prüfte den
Parser statt den Speicher; Fixtures in der Form der API sind zugleich die
Referenz dafür, was die API antwortet.

## Folgen

- Keine Prüfung des Generators und kein Anlegen eines NPC verzweigt über eine
  Überschrift (`decisions/generator`, `decisions/constraints`). `## Weiß` und
  `## Beziehungen` sind Empfehlungen der NPC-Prompts, freier Text; ebenso ein
  Abschnitt `## Notizen`.
- Die Fixtures sind der Seed für Dev, Tests und E2E und die Referenz für
  Callouts.
