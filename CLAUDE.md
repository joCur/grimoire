# CLAUDE.md — Grimoire

Grimoire ist ein selbst gehostetes Einzelnutzer-Tool für einen D&D-Spielleiter:
Session-Vorbereitung und Live-Moderation über einer Markdown-Datenbasis.
Es ist KEIN VTT, KEIN Kampagnen-Wiki und hat KEINE Spieler-Ansicht.

## Pflichtlektüre vor jeder Aufgabe

1. `README.md` — Datenformat und Konventionen (Entitäten, Callouts, `If:`-Abschnitte, Hashtags)
2. `DECISIONS.md` — Architektur-Entscheidungen inkl. Tech-Stack. Entscheidungen dort sind bindend; Abweichungen nur mit neuem Eintrag.
3. `UI-BRIEF.md` — Design-Richtung für alles Sichtbare

## Stack (Kurzfassung, Details in DECISIONS.md #5)

- Frontend: Vite + React 19 + Tailwind v4 + shadcn/ui, TanStack Query,
  react-markdown + eigenes Remark-Plugin für Callouts und `## If:`
- Backend: Bun + Hono, gray-matter, chokidar, Fuse.js
- Regel: Keine Bun-only-APIs ohne Eintrag in DECISIONS.md (Node-Portabilität)

## Projektstruktur

- `examples/` — generische Beispielkampagne (committet). Das sind die
  Dev-Fixtures und die Format-Referenz. NIE umformatieren oder „aufräumen";
  das Format ist Vertrag.
- `campaigns/` — echte Kampagnendaten, in `.gitignore` (Nutzungsdaten,
  ggf. urheberrechtlich geschütztes Quellmaterial). Im Code nie fest
  verdrahten — der Datenpfad kommt aus `CAMPAIGN_ROOT`.
- `server/` — Hono-API. Geplante Endpoints sind in `server/src/server.ts`
  dokumentiert und dort abzuhaken, wenn implementiert.
- `app/` — das Frontend (bei erster UI-Aufgabe anlegen: Vite-Scaffold).
- `generator/` — LLM-Pipeline (Prompt, Few-Shot, Ablauf-README).

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

## Qualitäts-Boden (nicht verhandelbar)

- Responsive bis Mobil (Mobile = Suche, Leseansicht, Inbox — siehe UI-BRIEF)
- Dark Mode ist der Primärmodus, Light Mode muss funktionieren
- Tastatur-Fokus sichtbar; `prefers-reduced-motion` respektieren
- Keine localStorage-Persistenz für Daten — der Server ist die Wahrheit
