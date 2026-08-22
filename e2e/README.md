# e2e — die kritischen Pfade gegen den echten Stack

Playwright-Suite für die neun kritischen Pfade aus `CLAUDE.md`. Gebaute App,
echter Server-Prozess auf einer Kopie von `examples/beispiel`, echter Browser.
Nichts im Browser ist gemockt — die einzige Attrappe ist das LLM: ein lokaler,
OpenAI-kompatibler Stub (`fixtures/stub-llm.ts`), den der Server über den
normalen `OpenAICompatProvider` per HTTP aufruft.

## Lokal ausführen

```bash
bun install
bunx playwright install chromium     # einmalig
bun run e2e                          # aus dem Repo-Root

# oder direkt in e2e/
cd e2e
npx playwright test                          # alles
npx playwright test generator                # nur den Generator-Pfad
npx playwright test -g "Schnellnotiz"        # nach Testnamen
npx playwright test --headed --debug 04      # zuschauen
npx playwright show-report                   # Report nach einem Fehlschlag
```

Voraussetzung ist `bun` im `PATH` (Server und Stub laufen darauf); liegt es
woanders, hilft `GRIMOIRE_BUN=/pfad/zu/bun`.

Nützliche Schalter:

| Variable        | Wirkung                                                      |
| --------------- | ------------------------------------------------------------ |
| `E2E_VERBOSE=1` | Ausgabe von Server und Stub-LLM durchreichen                 |
| `E2E_KEEP=1`    | Kampagnen-Kopien im Temp-Verzeichnis nach dem Lauf behalten   |

## Aufbau

```
playwright.config.ts     Projekt (nur chromium), globalSetup, Report
support/global-setup.ts  baut die App, legt die Referenz-Kopie an, startet den Stub
support/test.ts          das `test` der Suite: eigener Server + eigene
                         Kampagnen-Kopie + `baseURL` pro Test, Datei-Helfer
support/procs.ts         verwaltete Kindprozesse (Start, Warten, Stoppen)
fixtures/stub-llm.ts     standalone LLM-Stub (auch einzeln startbar)
fixtures/replies.ts      die kanonischen Modellantworten
tests/*.e2e.ts           ein Spec pro kritischem Pfad (Zuordnung unten)
```

**Isolation:** Jeder Test bekommt seine eigene Kampagnen-Kopie *und* seinen
eigenen Server-Prozess auf eigenem Port (Bereich ab 3200, pro Worker
getrennt). Damit ist auch der In-Memory-Zustand des Servers (Generator-Job)
frisch, und Datei-Zusicherungen lesen genau das Verzeichnis, das dieser Test
beschrieben hat. `examples/` wird nur kopiert, nie verändert.

Die Dateien werden über den `files`-Helfer direkt von der Platte gelesen —
jede Schreibaktion der UI wird doppelt geprüft: in der Oberfläche und in der
Datei.

Spec-Dateien heißen `*.e2e.ts`, damit `bun test` im Repo-Root sie nicht
einsammelt (Bun matcht `*.test.ts` und `*.spec.ts`).

## Stub-Fixtures anpassen

`fixtures/replies.ts` enthält die Modellantworten als lesbare Markdown-Blöcke:
den Szenen-Entwurf mit NPC- und Ort-Stub, die NPC-Datei und je eine bewusst
ungültige Variante. Sie erfüllen die aktuelle mechanische Validierung aus
`server/src/generator.ts` (Szene: Pfad im Ziel-Kapitel, `status: draft`, nur
bekannte Callouts, Referenzen existieren oder kommen als Stub mit; NPC-Stub
*mit* Status, Ort-Stub *ohne*; NPC-Lauf: `id` == Dateiname, kein `chapter`,
Quickstats als Strings in Anführungszeichen, `## Notizen` leer).

Wenn sich eine Validierungsregel ändert, ist diese Datei die Stelle, die
mitwandert. Die Specs behaupten die dort definierten Titel und ids.

Welche Antwort kommt, entscheidet ausschließlich der Prompt — der Stub hält
keinen Zustand und kann mehrere Worker parallel bedienen:

- `chapter: <id>` im Kontext-Block → Szenen-Lauf für genau dieses Kapitel
- kein `chapter` → NPC-Lauf, `vorgegebene id: <id>` fixiert den Dateinamen
- `E2E_INVALID` im Quelltext → Antwort, die die Validierung reißt (auch im
  Korrektur-Turn, der Lauf endet also in einem 422)
- `E2E_TRUNCATED` im Quelltext → `finish_reason: "length"`

Der Stub läuft auch allein, z. B. um einen Prompt von Hand anzuschauen:

```bash
bun e2e/fixtures/stub-llm.ts --port 4319
LLM_PROVIDER=openai LLM_BASE_URL=http://127.0.0.1:4319/v1 LLM_MODEL=stub \
  APP_DIST=app/dist CAMPAIGN_ROOT=examples bun server/src/server.ts
```

## Regel

**Wer einen kritischen Pfad berührt oder einen neuen schafft, erweitert diese
Suite im selben PR — sonst kein Merge** (`CLAUDE.md`, „Kritische Pfade"). Die
Pfade und die Specs stehen zueinander; die Nummer steht außerdem in der
Kopfzeile des jeweiligen Specs (die Dateinamen tragen sie bewusst nicht — die
Suite hat keine Reihenfolge). Ein Pfad kann mehr als einen Spec haben, wenn
mehrere Schreibwege auf ihm liegen:

| Pfad (CLAUDE.md)   | Spec                                                           |
| ------------------ | -------------------------------------------------------------- |
| 1 Auto-Einstieg    | `tests/pool.e2e.ts`                                            |
| 2 Szene lesen      | `tests/scene-rendering.e2e.ts`                                 |
| 3 ⌘K-Suche         | `tests/search.e2e.ts`                                          |
| 4 Session-Zyklus   | `tests/session-cycle.e2e.ts`                                   |
| 5 Ernte            | `tests/review-harvest.e2e.ts`                                  |
| 6 Generator        | `tests/generator.e2e.ts`                                       |
| 7 Frontmatter/409  | `tests/status-control.e2e.ts`, `tests/frontmatter-form.e2e.ts` |
| 8 Mobil            | `tests/mobile.e2e.ts`                                          |
| 9 Datei bearbeiten | `tests/file-edit.e2e.ts`                                       |

Auf Pfad 7 teilen sich zwei Specs die Arbeit: `status-control.e2e.ts` deckt den
Status-Regler ab (ein Schlüssel, Konflikt über das Poll-Fenster),
`frontmatter-form.e2e.ts` den „Eigenschaften"-Dialog von #42 (alle Felder einer
Entitätsart, Chips/Referenzen/Select, Leeren löscht den Schlüssel, und der
deterministische 409, weil der Dialog seine mtime beim Öffnen einfriert). Der
Dialog berührt zusätzlich Pfad 2 (die Leseansicht zeigt die neuen Werte sofort)
und Pfad 8 (Formular bei 390px) — beides steht in demselben Spec.

Deutsche UI-Strings in Zusicherungen kommen aus den Komponenten, nicht aus dem
Gedächtnis: bei einer Textänderung in der App wandert der Spec mit.

Ein Spec deckt auch spätere Scheiben auf seinem Pfad ab, nicht nur die Scheibe,
die ihn angelegt hat: `tests/pool.e2e.ts` prüft zusätzlich Gruppenkopf-Namen,
die Topbar-Navigation und den Kampagnen-Metadaten-Dialog (#34),
`tests/review-harvest.e2e.ts` den Szenentitel im Quellchip.
