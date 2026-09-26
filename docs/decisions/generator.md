# LLM-Generator

## Entscheidung

Der Generator ist eine Pipeline mit Prüfschritt: er schreibt nie direkt in
die Kampagne. Was ein Lauf vorschlägt, wartet im Job, bis der DM es
übernimmt; eine vorgeschlagene Szene steht immer auf `status: "draft"`.
Ablauf, Prompts und Few-Shot beschreibt [generator/README.md](../../generator/README.md).

### Provider und Antwort

- Der Provider hängt hinter einer Schnittstelle (`server/src/llm-provider.ts`):
  Standard ist die Claude API, `LLM_PROVIDER` schaltet auf einen
  OpenAI-kompatiblen Endpunkt um (`lmstudio`, `openai`, `openrouter`).
- **Jede Modell-Antwort ist ein per Schema erzwungenes JSON-Objekt** — die
  Gliederung ihr eigenes (`shared/schema/outline.schema.json`), ein Aufruf
  für eine Entität das Antwort-Schema dieser Entität.
- **`jsonrepair`** (exakt gepinnt) repariert jede Antwort deterministisch vor
  der Validierung. Die Regeln der Validierung bleiben unangetastet, und ein
  reparierter Lauf trägt eine Warnung.
- Nach der Generierung prüft eine mechanische Validierung die Antwort; Fehler
  gehen als Korrektur-Turn zurück ans Modell. `LLM_CORRECTION_TURNS` legt fest,
  wie viele ein Lauf ausgeben darf: 0–2, Default 1.
- **Das Antwort-Schema einer Entität ist ihr Typ ohne `rev`** in der strengen
  Form der Provider, abgeleitet aus ihrem zod-Schema mit `z.toJSONSchema`
  (`decisions/resources`): null-fähig statt optional,
  `additionalProperties: false`, jedes Feld in `required`, kein `pattern`,
  kein `format`, keine Grenzen. Das Schema trägt allein die Form, keine
  `description`; was das Modell über die Felder wissen muss und das Schema
  nicht sagen kann, steht in ihrem Prompt unter `generator/` und wird in der
  Validierung geprüft. Ein Test prüft genau die Regeln des strict mode an den
  abgeleiteten Schemata.
- **Jedes `[[id]]` in einem erzeugten Text** nennt einen NPC, Ort oder eine
  Szene der Kampagne oder einen Vorschlag desselben Laufs (die Gliederung
  eines Szenen-Laufs, im NPC-Lauf der NPC selbst) — sonst geht die Antwort als
  Korrektur-Turn zurück. Die Regel gilt für Szenen, NPCs und Orte im neuen
  Lauf und im Ergänzen-Lauf, dort nur für Verweise, die der Vorschlag neu
  bringt: ein Verweis im bestehenden Text gehört dem DM. Gelesen wird mit der
  Grammatik von Anzeige und Suche (`shared/src/refs.ts`): nur eine
  kebab-case-id in doppelten Klammern, nichts in Code. Geprüft wird der Text;
  `motivation` und `atmosphere` zeigen ein `[[id]]` ohne Zeile als Text. Das
  ist eine Regel für die Antwort des Modells, keine Referenz: „Übernehmen" und
  der Schreibweg prüfen sie nicht.

### Kein Markdown-Zwischenformat

Ein Vorschlag ist von der Antwort des Modells bis in die Zeile der Typ seiner
Entität ohne `rev`. Der Server setzt nirgends einen Text mit vorangestellten
Feldern zusammen und liest nirgends einen zurück: die Antwort liefert die
Felder, die Validierung liest sie, der Prüfschritt zeigt sie, und die
Schreibschicht bekommt sie unverändert. Der bestehende Stand, den ein
Ergänzen-Lauf dem Modell zeigt, ist Prompt-Formatierung und wird dort gebaut,
wo der Prompt gebaut wird (`server/src/llm-provider.ts`) — kein
Speicherformat. Nichts im Repo parst Felder aus Text; es gibt keinen
Frontmatter-Parser und keine YAML-Abhängigkeit.

### Jobs laufen serverseitig und sind Zeilen

Jede Operation, die länger als ein paar Sekunden dauern kann, läuft als
serverseitiger Job: der Start antwortet sofort mit dem Job, Status und
Ergebnis werden gepollt, und die UI stellt den Zustand nach Navigation,
Reload oder Tab-Schließen vollständig wieder her. Nichts ist an einen offenen
Browser-Tab oder eine offene HTTP-Verbindung gebunden.

- Jobs sind Zeilen der Tabelle `generate_jobs`, **höchstens einer je
  Kampagne**; die Liste `GET …/generator-jobs` ist leer oder hat genau einen
  Eintrag.
- `POST …/generator-jobs { kind, … }` startet einen Szenen- oder NPC-Lauf.
  Ein Ergänzen-Lauf hängt an seiner Ressource: `POST …/<ressource>/:id/augment`
  startet ihn und antwortet mit seinem Job, `POST
  …/<ressource>/:id/augment/apply` übernimmt ihn. Sein Vorschlag ist der
  gelesene Stand neben dem vorgeschlagenen, beide im Typ der Entität ohne
  `rev`.
- Ein Job-Ergebnis listet `scenes`, `npcs` und `locations` als eigene
  getypte Listen, jede im Typ ihrer Entität ohne `rev`. Prüfen, Entscheiden
  und Übernehmen laufen je Entität und `id`.
- **Neustart:** Ein fertiger Job (`done`/`failed`) übersteht ihn vollständig —
  Ergebnis, Fehlerbody und Prüfzustand — und bleibt übernehmbar. Ein
  laufender kann es nicht, weil sein Provider-Call mit dem Prozess stirbt:
  der Boot schreibt jede übrig gebliebene `running`-Zeile auf `failed`
  (`failInterruptedJobs` in `server/src/db/job-boot.ts`), mit 503 und dem Code
  `job_restarted` im Fehlerbody, statt die App ins endlose Pollen zu schicken.

### Ein Szenen-Lauf ist eine Pipeline aus Teilen

Ein Gliederungs-Aufruf legt fest, welche Szenen es gibt; die Gliederung ist
ein systeminterner Schritt und wird dem DM nie zum Bearbeiten angeboten.
Danach ist jede Szene und jeder neue NPC oder Ort ein eigener Aufruf, drei
gleichzeitig. NPC- und Ergänzen-Lauf sind Ein-Aufruf-Läufe ohne Teile.

- Die Zeile trägt die Gliederung, die Teile mit Status je Teil
  (`pending | running | done | failed`), Fehlertext und Token-Verbrauch je
  Teil sowie Token- und Aufruf-Summe des Laufs (Spalte `pipeline`), dazu den
  Quelltext des Laufs, weil ein Teil-Neustart denselben Ausschnitt erneut
  schicken muss.
- **Ein fertiger Teil ist sofort prüfbar und übernehmbar,** während andere
  noch laufen: der Job bleibt `running`, das Ergebnis füllt sich, und die
  Prüfseite zeigt Teile in Gliederungsreihenfolge. Der Job wird `done`, sobald
  ein Teil etwas produziert hat, und `failed` nur, wenn kein einziger Teil
  durchkam. Übernehmen verlangt deshalb keinen fertigen Job, sondern ein
  Ergebnis: 409 ist es für einen gescheiterten Lauf und für einen, der noch
  keinen fertigen Teil hat.
- Beim Neustart werden laufende und wartende Teile `failed`; fertige Teile
  bleiben stehen und übernehmbar.
- **„Erneut versuchen" je Teil:** `PATCH …/generator-jobs/:id/parts/:key
  { status: "running" }` startet genau diesen Teil neu, aus der gespeicherten
  Gliederung, in **einer Transaktion** über der neu gelesenen Zeile, die nur
  diesen Teil anfasst — ein Rückschreiben der ganzen `pipeline`-Spalte
  überschriebe einen Geschwister-Teil, der inzwischen fertig wurde. Ein noch
  `pending` Teil ist 409: er gehört dem Pool des Laufs und liefe sonst
  zweimal.
- Wo die übernommenen Szenen im Kapitel stehen, regelt
  `decisions/scene-order`.

### Der Prüfzustand liegt am Job

Alles, was der DM im Prüfschritt tut — Felder und Text bearbeiten,
vorgeschlagene NPCs und Orte annehmen oder ablehnen, Szenen aus dem Lauf
nehmen, je Feld übernehmen oder behalten —, steht in `generate_jobs.review`,
nicht im Browser. Die App liest ihren Zustand aus dem Job und schreibt jede
Änderung zurück: Texteingaben debounced (~600 ms) und spätestens beim
Verlassen des Feldes, Entscheidungen sofort.

- Änderungen des DM werden **je Entität und id** gespeichert (`sceneEdits`,
  `npcEdits`): eine Änderung nennt die Felder, die sie setzt, `null` löscht
  ein optionales, und jedes andere Feld behält den Wert des Modells.
- Geprüft und übernommen wird mit `PATCH …/generator-jobs/:id { rev, … }`.
  Der Job hat sein eigenes `rev`; ein veralteter ist 409 `rev_conflict` mit
  dem aktuellen Job, und die App lädt neu, statt die Entscheidung eines
  anderen Tabs still zu überschreiben (`decisions/writes`).
- **Übernehmen** heißt, Vorschläge in `review.writtenScenes`, `writtenNpcs`
  oder `writtenLocations` zu nennen. Es schreibt genau diese in einer
  Transaktion (Konfliktprüfung darin, Suchindex und Referenzen folgen) und
  vermerkt sie im selben Commit am Job. Es ist kein Weg an den Schreibregeln
  vorbei (`decisions/writes`), und eine übernommene Szene nimmt die
  Vorschläge mit, die sie nennt (`decisions/constraints`). Ist nichts mehr
  offen, ist der Job erledigt, und die Antwort ist sein letzter Stand.
- **Verwerfen** (`DELETE …/generator-jobs/:id { rev }`) stoppt die offenen
  Teile und nimmt nur den offenen Rest mit. Was übernommen wurde, ist eine
  Zeile der Kampagne und kein Teil des Jobs; es wird im normalen Editor
  weiterbearbeitet.
- Es gibt keinen Undo-Verlauf und kein Zusammenführen zweier Bearbeiter.

### Das Kapitel eines „Neues Kapitel"-Laufs entsteht aus dem Lauf

- Der Titel wird beim Start am Job vermerkt
  (`generate_jobs.new_chapter_title`), und die erste Übernahme legt das
  Kapitel daraus an — idempotent und im selben Vorgang wie die Szenen, auch
  wenn kein übernommener Teil es nennt: das Kapitel gehört dem Lauf. Eine
  generierte Szene bekommt ihr Kapitel im selben Schreibvorgang; ist die
  Kapitel-id kein Slug, ist das 400.
- Die Gliederung trägt `chapterDescription` (nullable). Nur der
  Gliederungs-Aufruf eines Laufs, der sein Kapitel anlegt, erfährt das
  (Kontextzeile `neues Kapitel: ja`) und beschreibt das Kapitel aus dem
  Quellmaterial. „Entwürfe prüfen" zeigt die Beschreibung lesend, und das
  Übernehmen legt das Kapitel mit ihr als `body` an. Für einen Lauf in ein
  bestehendes Kapitel verwirft die Validierung das Feld, und der Text eines
  Kapitels, das beim Übernehmen schon existiert, bleibt unberührt. Fehlt die
  Beschreibung, beginnt das Kapitel mit leerem Text; das kostet keinen
  Korrektur-Turn.
- In den Dialogen muss ein Kapitel, das der DM tippt, existieren (400
  `chapter_unknown`): dort ist ein unbekanntes Kapitel ein Tippfehler.

## Warum

- Ein Lauf kostet Geld und Minuten. Ist er an einen Tab oder eine Verbindung
  gebunden, vernichtet ein Browser-Zurück oder ein Space-Wechsel ein bezahltes
  Ergebnis; das darf konstruktionsbedingt nicht möglich sein. Auch ein Deploy
  zwischen „fertig" und „Übernehmen" darf kein Ergebnis wegwerfen, deshalb
  ist der Job eine Zeile.
- Der Prüfschritt ist Arbeit, die der DM selbst hineinsteckt; flüchtiger als
  das Ergebnis, das sie bearbeitet, darf sie nicht sein. Ein zweiter Speicher
  im Browser verbietet sich (`decisions/scope`).
- Ein Endpunkt, der `response_format` annimmt und ignoriert, liefert trotzdem
  Handgeschriebenes, und dort sind die Fehler mechanisch (Komma am Ende,
  einfache Anführungszeichen): eine deterministische Reparatur ist deutlich
  billiger als eine Korrekturrunde, die den ganzen Prompt erneut sendet.
- Ein Text mit vorangestellten Feldern, der durch Job und Prüfschritt
  getragen und beim Übernehmen wieder zerlegt wird, kann nur verlieren: ein
  Feld, das als YAML anders zurückkommt (ein Datum, ein `+2`, ein Doppelpunkt
  in einem Satz), ein Block, der beim Parsen degradiert.
- Das Kapitel eines Laufs darf nicht im Browser liegen: die Übernahme
  passiert regelmäßig nach Navigation oder Reload.

## Folgen

- Ändert sich die Form einer Entität, werden gespeicherte Jobs, deren
  Nutzlast sie in der alten Form trägt, nicht überführt: die Migration löscht
  sie per SQL. Ein Lauf kostet ein paar Token, ein halb überführter Vorschlag
  eine falsche Zeile in der Kampagne.
- Zwei Tabs sind ein Konflikt, den man meldet, keiner, den man zusammenführt.
