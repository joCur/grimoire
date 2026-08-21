# CLAUDE.md — Grimoire

Grimoire ist ein selbst gehostetes Einzelnutzer-Tool für einen D&D-Spielleiter:
Session-Vorbereitung und Live-Moderation über einer Markdown-Datenbasis.
Es ist KEIN VTT, KEIN Kampagnen-Wiki und hat KEINE Spieler-Ansicht.

## Pflichtlektüre vor jeder Aufgabe

1. `README.md` — Datenformat und Konventionen (Entitäten, Callouts, `If:`-Abschnitte, Hashtags)
2. `docs/DECISIONS.md` — Architektur-Entscheidungen inkl. Tech-Stack. Entscheidungen dort sind bindend; Abweichungen nur mit neuem Eintrag.
3. `docs/UI-BRIEF.md` — Design-Richtung für alles Sichtbare

## Stack (Kurzfassung, Details in docs/DECISIONS.md #5)

- Frontend: Vite + React 19 + Tailwind v4 + shadcn/ui, TanStack Query,
  react-markdown + eigenes Remark-Plugin für Callouts und `## If:`
- Backend: Bun + Hono, gray-matter, chokidar, Fuse.js
- Regel: Keine Bun-only-APIs ohne Eintrag in docs/DECISIONS.md (Node-Portabilität)

## Projektstruktur

- `examples/` — generische Beispielkampagne (committet). Das sind die
  Dev-Fixtures und die Format-Referenz. NIE umformatieren oder „aufräumen";
  das Format ist Vertrag.
- `campaigns/` — echte Kampagnendaten, in `.gitignore` (Nutzungsdaten,
  ggf. urheberrechtlich geschütztes Quellmaterial). Im Code nie fest
  verdrahten — der Datenpfad kommt aus `CAMPAIGN_ROOT`.
- `shared/` — Entitäts-Typen und Frontmatter-Parser (`@grimoire/shared`),
  von Server und App gemeinsam genutzt. Das Datenformat ist hier genau
  einmal in Code beschrieben (Spiegel von README.md — beides synchron halten).
- `server/` — Hono-API. Geplante Endpoints sind in `server/src/server.ts`
  dokumentiert und dort abzuhaken, wenn implementiert.
- `app/` — das Frontend (bei erster UI-Aufgabe anlegen: Vite-Scaffold).
- `generator/` — LLM-Pipeline (Prompt, Few-Shot, Ablauf-README).
- `design/` — verbindliche Design-Referenz (Claude-Design-Export des PO,
  siehe design/README.md). Bei Widerspruch zu docs/UI-BRIEF.md gewinnt design/.
- `docs/` — die längeren Dokumente: `DECISIONS.md` (bindende ADRs),
  `UI-BRIEF.md` (Design-Intention), `DEPLOYMENT.md` (Betrieb).
  `README.md` und `CLAUDE.md` bleiben im Root (Tooling-Konvention).

## Arbeitsweise

- Vertikale Scheiben, eine pro Auftrag. Nicht mehrere Views gleichzeitig.
- Gegen echte Daten entwickeln: Server im Dev-Modus auf `examples/`
  zeigen lassen (Default von `CAMPAIGN_ROOT`), keine erfundenen
  Mock-Objekte. `campaigns/` existiert nur lokal beim Nutzer und darf
  in Code, Tests und Doku nie vorausgesetzt werden.
- Der Callout-Renderer (`[!readaloud]`, `[!check]`, `[!secret]`,
  `[!outcome]`, `[!loot]`, `[!note]`) ist die zentrale Komponente —
  Änderungen daran immer gegen
  `examples/beispiel/01-salzhafen/hafen/von-schmugglern-erwischt.md`
  und `.../ankunft-leuchtturm.md` prüfen.
- Format degradiert: unbekannte Callouts/Überschriften als normalen Text
  rendern, niemals Fehler werfen.
- Schreibzugriffe der App nur über die dokumentierte API; Frontmatter-Patches
  mit mtime-Check (409 bei Konflikt).
- Sprache der UI: Deutsch. Code, Kommentare, Commits: Englisch.

## Backlog-Prozess

- Der PO kippt Ideen als Issues mit Label `idee` ein (Template „Idee") —
  formlos, Freitext genügt.
- Refinement findet IM Issue statt: Rückfragen als Kommentare stellen;
  danach den Issue-Body zum Ticket ausbauen — User Story („Als DM will
  ich … damit …"), Akzeptanzkriterien (nachprüfbar), Scope/Nicht-Ziele,
  Abhängigkeiten. Erst nach PO-Ok im Thread: Label `idee` → `ready`.
- Das Team nimmt nur `ready`-Tickets. Übernahme = Label „in Arbeit" +
  Kommentar mit Zuschnitt; fertig = Schließen mit Commit-Verweis.
- Zu Beginn jeder Arbeitssitzung: offene `idee`-Issues sichten, bevor
  neue Arbeit startet.
- Vor dem Merge einer Scheibe mit UI-Anteil läuft der Lead den echten
  Klickpfad selbst (Server + gebaute App, Produktions-Topologie) —
  Agent-Smoke-Berichte ersetzen das nicht.

## Branch- & PR-Prozess (main ist produktiv)

- KEINE Direkt-Pushes auf main. (Serverseitige Branch-Protection ist im
  Free-Plan für private Repos nicht verfügbar — die Regel ist prozessual
  bindend; bei Wechsel auf Pro/public wird sie technisch erzwungen.)
- Jedes Ticket: eigener Worktree + Feature-Branch (`<nr>-<slug>`),
  Ergebnis als PR. Merge-Voraussetzungen: CI grün (Tests, Typecheck,
  Build, E2E), Lead-Klickpfad, UND PO-Approval auf dem PR.
- `:latest` baut weiter bei jedem Merge — main ist per Definition
  deploybar; der PO pullt bewusst (nie direkt vor einer Session),
  SHA-Tags erlauben Rollback.

## Kritische Pfade (E2E-Pflicht, echte Suite ohne Mocks)

Playwright gegen den echten Stack (realer Server auf Kampagnen-Kopie,
gebaute App, echter Browser; einzige Ausnahme: das LLM ist ein lokaler
Stub-HTTP-Server — der Provider-Pfad läuft real). Die Pfade:

1. Auto-Einstieg `/` → Pool lädt die Kampagne
2. Szene lesen: Callouts, If-Sections, NPC-Karten der Referenzszenen
3. ⌘K-Suche findet und öffnet
4. Session-Zyklus: starten → Schnellnotiz → Log + scenes_played →
   Pause → beenden → Review
5. Ernte: Thread übernehmen → _chapter.md; Inbox abhaken
6. Generator-Zyklus (Stub-LLM): Job → Review → Übernehmen → draft im
   Pool; plus 409-/Fehlerpfad
7. Frontmatter-Patch/Status-Regler inkl. 409-Konflikt
8. Mobil-Startfläche + Inbox-Einwurf bei 390px
9. Datei bearbeiten: öffnen → Body ändern → speichern → gerendert
   sichtbar; 409 bei externer Änderung → neu laden statt still
   überschreiben

Regel für neue Features: Jedes ready-Ticket benennt die berührten
kritischen Pfade; wer einen berührt oder schafft, erweitert die
E2E-Suite im selben PR — sonst kein Merge.

## Qualitäts-Boden (nicht verhandelbar)

- Responsive bis Mobil (Mobile = Suche, Leseansicht, Inbox — siehe UI-BRIEF)
- Dark Mode ist der Primärmodus, Light Mode muss funktionieren
- Tastatur-Fokus sichtbar; `prefers-reduced-motion` respektieren
- Keine localStorage-Persistenz für Daten — der Server ist die Wahrheit
