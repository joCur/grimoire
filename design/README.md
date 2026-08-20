# design/ — verbindliche Design-Referenz

Export aus dem Claude-Design-Projekt des PO (Quelle:
https://claude.ai/design/p/bdec0f7c-9772-4d68-91f1-49623f1b530a).
Diese Dateien sind die Design-Wahrheit für alle Views; UI-BRIEF.md bleibt
die Intentions-Ebene darüber. Bei Widerspruch gewinnt diese Referenz.

- `Grimoire.dc.html` — Desktop-Prototyp: Topbar (Kampagnen-Switcher, ⌘K,
  Session-Steuerung), Pool (Kapitel-Akkordeons), Szene, Live (3 Zonen mit
  Log-Panel + Schnellnotiz), Review („Fünf Minuten Ernte"), ⌘K-Palette.
- `Grimoire-Mobil.dc.html` — Mobil: Startfläche (Suche, Inbox, Zuletzt
  angesehen) und Leseansicht.
- `grimoire-icon.svg` — App-Icon (Buch + Funke, Messing auf Anthrazit).

Verbindliche Kernwerte (aus dem Prototyp):
Palette: bg #1d1a16 · panel #23201b · border #2e2925/#38322a ·
text #e7dfd2/#d6ccbc · secondary #a2968a · muted #7a6f61 · faint #5d554a ·
Akzent #c8a35a (hover #dcb96e) · Read-Aloud #29241d/#ece2cf ·
Grün #8fae7e/#93a888 (Status). Serif: Literata (selbst gehostet).
Callout-Labels: Check · Geheim · Konsequenz · Beute · Notiz;
Read-Aloud ohne Label. Status-Labels: bereit · Entwurf · gespielt.
`Falls:`-Zweige: randlose Zeile, Chevron, kursive Bedingung, Inhalt
eingerückt, standardmäßig GEÖFFNET.

## Abweichungen per PO-Entscheid (aktueller als der Prototyp)

- Keine Szenen-`id` in der Topbar (Prototyp zeigt sie rechts) — ids
  erscheinen nirgends in der UI, auch nicht optional (showIds entfällt).

## Update 2026-08-20: Generator-Ansicht

`Grimoire.dc.html` enthält jetzt die GENERATOR-Sektion (vier Zustände:
Eingabe → Arbeiten → Review → Geschrieben) plus Topbar-Einstieg
(„Generator"-Button im Pool, Breadcrumb). Kernpunkte: Ziel-Kapitel als
Chips inkl. „Neues Kapitel"-Flow (Titel-Input, Pfad-Vorschau),
Quelltext-Textarea mit Kontext-Hinweiszeile, Spinner mit
Korrektur-Turn-Erklärtext, Review mit Warnungs-Callouts, Szene-Karte
(gerenderter Body ODER Roh-Markdown-Edit umschaltbar), Stub-Zeilen
einzeln annehmen/ablehnen, „Übernehmen (n)" + Verwerfen,
Erfolgs-Zustand mit geschriebenen Pfaden.
