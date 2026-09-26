# Kapitel, Ort und Reihenfolge der Szenen

## Entscheidung

### Der Kapitel-Status ist ein Enum, höchstens ein Kapitel ist aktiv

Der Status eines Kapitels ist `planned | active | done`, genau einmal in
`shared/src/chapter.ts` definiert (`CHAPTER_STATUSES`), mit den Labels de
„Geplant / Aktiv / Abgeschlossen", en „Planned / Active / Done". Die Spalte ist
ein CHECK-Constraint, ein anderer Wert ist 400 (`decisions/constraints`). Ein
neu angelegtes Kapitel startet auf `planned`.

`active` ist eine Entscheidung über zwei Kapitel, und „höchstens ein aktives
Kapitel je Kampagne" gehört dem **Feld, nicht einem Endpunkt**: jeder
Schreibweg, der `active` setzt — `PATCH …/chapters/:id { rev, status:
"active" }` mit Wächter wie jeder Schreibzugriff und `POST …/chapters` mit
`status: "active"` —, setzt das zuvor aktive Kapitel in derselben Transaktion
auf `planned`, und dessen `rev` bewegt sich mit.

In der Kapitelübersicht ist die Status-Anzeige das Bedienelement (wie beim
Szenen-Status, gemeinsames Markup in `app/src/components/StatusMenu.tsx`):
jede Auswahl patcht das Kapitel, die Auswahl des Werts, der schon angezeigt
wird, schreibt nichts. Mobil bleibt der Status Anzeige: unter `md` rendert die
Route die Startfläche statt der Kapitelübersicht.

### Der Ort einer Szene steht in einer Spalte

Der Ort einer Szene steht in genau einer Spalte, `location`; eine Gruppe
daneben gibt es nicht. `location` ist eine Orts-id oder leer
(`decisions/constraints`). Aus `location` wird nichts abgeleitet: weder die
URL der Szene noch eine Gruppierung.

### Die Reihenfolge der Szenen setzt der DM

Ein Kapitel hat eine Szenenreihenfolge, und die setzt der DM. `scenes.pos` ist
diese Reihenfolge, fortlaufend innerhalb des Kapitels, gepflegt über
Hoch/Runter an der Zeile. Die Kapitelübersicht zeigt genau sie: eine
durchgehende Liste ohne Ortsgruppen, der Ort steht mit seinem Namen in der
Metazeile der Szene. Eventualszenen sind ein eigener Block am Ende, derselbe
`pos`-Lauf, nur getrennt gezeigt.

- **Lesen:** `ChapterNode.scenes: SceneSummary[]`
  (`shared/src/campaign-tree.ts`), sortiert nach `pos, id`. `SceneSummary`
  trägt neben der Orts-id den aufgelösten Ortsnamen (`locationName`).
- **Schreiben:** `PUT /api/campaigns/:campaign/chapters/:chapter/scene-order`
  mit `{ scenes: string[], rev }`. `scenes` ist die vollständige neue
  Reihenfolge; ist sie nicht exakt die Menge der Szenen-ids dieses Kapitels —
  eine fehlt, eine doppelt sich, eine gehört woanders hin —, ist das 400, und
  es wird nichts geschrieben. Der Write schreibt die Positionen dicht neu.
- **Der Wächter ist `chapters.scene_order_rev`,** ein eigener Zähler, der nur
  die Writes dieser Liste zählt und den `ChapterNode` mitliefert; das `rev`
  im Rumpf ist seiner. Ein alter Stand ist 409 `rev_conflict`. Der Write
  bewegt `scene_order_rev` und `campaigns.version` — weder `scenes.rev` noch
  `chapters.rev`.
- **Neue Szenen landen am Ende** ihres Kapitels. Wechselt eine Szene das
  Kapitel, landet sie am Ende des Zielkapitels.
- **Die Szenen eines Generator-Laufs** stehen an **Startwert des Laufs +
  Nummer der Szene in der Gliederung**, damit die Reihenfolge des Laufs auch
  über mehrere Teil-Übernahmen in beliebiger Reihenfolge hält. `pos` ist ein
  Sortierschlüssel und verträgt Lücken.
  - Die Nummer ist der Index der Szene unter den Szenen-Teilen der Gliederung.
    Eine verworfene oder gescheiterte Szene behält ihre Nummer und hinterlässt
    eine Lücke; ein Retry ändert die Nummer nicht.
  - Der Startwert ist das Kapitelende bei der **ersten Szenen-Übernahme** des
    Laufs. Er wird im selben Commit am Job gespeichert (neben der Gliederung,
    übersteht also einen Neustart) und für diesen Lauf nie neu berechnet. Eine
    Szene, die der DM zwischen Start und erster Übernahme von Hand anlegt,
    steht so vor dem Lauf; ein neues Kapitel beginnt bei 0.
  - **Die Handsortierung gewinnt.** Mit dem Startwert speichert der Job den
    `scene_order_rev` des Kapitels. Hat der sich seitdem bewegt, hängt jede
    weitere Übernahme dieses Laufs ans Kapitelende wie jede andere neue Szene.
  - Ein Gleichstand (der DM legt mitten in der Prüfung eine Szene an) löst
    sich über die Sortierung `pos, id`.
  - Wer alles in einem Aufruf übernimmt, bekommt dieselbe Reihenfolge. Keine
    Übernahme bewegt `scene_order_rev`, `chapters.rev` oder das `rev` einer
    bestehenden Szene. Ein neuer Lauf bekommt seinen eigenen Startwert; ein
    Einsortieren über Läufe hinweg gibt es nicht.
- **Die Session-Ansicht liest dieselbe Reihenfolge.** Sie öffnet die erste
  Szene, deren Status weder `played` noch `dropped` ist, sonst die erste;
  unter der offenen Szene steht der Schritt „Nächste Szene: <Titel>".
- **`pos` ist kein Feld der Szene.** Es steht nicht im Typ der Szene, nicht in
  den Fixtures und nicht im Eigenschaften-Dialog. Reihenfolge wohnt in einer
  `pos`-Spalte: `scene_npcs.pos` hält die der NPCs einer Szene,
  `chapters.pos` die der Kapitel, keine davon ist eine Eigenschaft.

Am Kapitel stehen damit drei Schreibwege mit drei Wächtern: die Szene mit
`scenes.rev` (ihre Felder samt Text), das Kapitel mit `chapters.rev` (Titel,
Status, Kapiteltext) und die Reihenfolge mit `chapters.scene_order_rev`.

## Warum

**Ein Wert, eine Quelle.** Eine Gruppe neben `location` wäre ein zweiter Wert
für dieselbe Sache: korrigiert der DM den Ort, bliebe die Gruppe stehen, und
die Anzeige widerspräche dem Feld. Auch eine abgeleitete Spalte hätte jeden
Schreibpfad verpflichtet, sie mitzuziehen. Zwei Quellen für eine Wahrheit
driften immer; die Reparatur ist, eine abzuschaffen. Dasselbe gilt für die
Reihenfolge: sie hat genau eine Quelle, `pos`.

**Gesetzt statt abgeleitet.** Eine Ordnung nach id oder Ortsname fiele an,
statt gesetzt zu werden. Die id entsteht aus dem getippten Namen und steht
danach fest; der Name ist Dramaturgie, und wer dramaturgisch benennt,
sortiert nicht. Übrig bliebe, ids zu Nummern zu machen (`01-ankunft`) — eine
Reihenfolge, die beim ersten Umstellen falsch wird. Die Kapitelübersicht ist
das Werkzeug der Vorbereitung, und Vorbereitung heißt: in welcher Reihenfolge
erzähle ich das. Der Ort ist eine Eigenschaft der Szene, keine
Gliederungsebene über ihr; zwei Szenen am selben Ort können dramaturgisch weit
auseinanderliegen.

**Die ganze Liste.** Eine Reihenfolge ist eine Aussage über eine Menge; ein
Umsortieren ändert immer mehrere Positionen. Eine Teilliste ohne Positionen
anzunehmen hieße, den Rest irgendwohin zu sortieren. Dem Hoch/Runter liegt die
vollständige Liste ohnehin vor. Die eine Teilliste mit ausdrücklichen
Positionen ist die eines Generator-Laufs. Ein je Übernahme neu berechnetes
„ans Ende" wanderte mit, und eine später übernommene frühere Szene landete
wieder hinten; ein neuer Startwert nach einer Handsortierung sortierte nur
wieder um die Ordnung des DM herum.

**Ein eigener Wächter.** Die Reihenfolge gehört dem Kapitel, ist aber nicht
das Kapitel. Mit `chapters.rev` als Wächter triebe ein Umsortieren einen
offenen Kapiteltext in eine 409 und umgekehrt — Konflikte über etwas, das
sich nicht widerspricht. Ein Wächter, der auf fremde Writes anspringt,
erzieht dazu, die Konfliktzeile wegzuklicken, und fängt dann die echte
Überschreibung nicht. Ein Wächter zählt deshalb nur die Writes,
gegen die er schützt.

**Kein Positionsfeld.** Felder sind, was eine Szene über sich selbst aussagt.
Wo sie in einer Liste steht, sagt die Liste über sie aus. Eine Positionszahl
im Eigenschaften-Dialog wäre obendrein unbedienbar.

**Hoch/Runter statt Drag & Drop.** Hoch/Runter ist mit Tastatur und
Zeigegerät dieselbe Bedienung, auf dem Handy nicht kaputt, braucht keine
Bibliothek und keine Greiffläche, die mit der „ruhigen Liste" aus
[docs/UI-BRIEF.md](../UI-BRIEF.md) ringt. Drag & Drop wäre später eine andere
Geste an demselben Endpunkt.

**Ein aktives Kapitel am Feld.** Hinge die Regel an einem Endpunkt, wäre der
Eigenschaften-Dialog eine zweite Tür daran vorbei.

## Folgen

- Nicht Teil der Entscheidung: eine Reihenfolge über Kapitelgrenzen hinweg
  (die Kapitel haben ihre eigene, `chapters.pos`) und Sortieren nach Status,
  Tag oder Ort als Ansicht — die Kapitelübersicht filtert, sie sortiert nicht
  um.
- Das Kampagnenwissen hat dasselbe Muster mit eigenem Wächter
  (`decisions/resources`).
