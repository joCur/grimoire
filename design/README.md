# design/ — verbindliche Design-Referenz

Export aus dem Claude-Design-Projekt des PO (Quelle:
https://claude.ai/design/p/bdec0f7c-9772-4d68-91f1-49623f1b530a).
Diese Dateien sind die Design-Wahrheit für alle Views; docs/UI-BRIEF.md bleibt
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
- Topbar-Navigation „NPCs" und „Orte": leise Links in der Titelleiste,
  kampagnenbezogen, ab `lg` sichtbar, nicht im Live-Modus (dessen Topbar
  gehört der laufenden Session). Der Prototyp deckt diese Navigation nicht
  ab; die bisherige Pool-Fußzeile („NPCs · Orte" unter der Kapitelliste,
  aus #26) war eine Team-Minimallösung und entfällt. Die Topbar-Links
  schließen die Design-Lücke per PO-Entscheid (#34) — künftige Views
  denken sie mit. Mobil bleibt die „Nachschlagen"-Liste der Startfläche
  der Zugang; ⌘K findet beide Listen in jeder Breite.
- Anzeigenamen statt ids: Pool-Gruppenköpfe zeigen den Ortsnamen, wenn
  `locations/<slug>.md` existiert (sonst den Slug unverändert — Gruppen-
  Ordner sind lose Konvention), der Review-Quellchip den Szenentitel
  („Log · Ankunft am Leuchtturm", Fallback id). Sichtbare ids bleiben nur
  in Identifikations-Kontexten, dort mono: Rename-Dialog, NPC-Stub-
  Platzhalter, id-Badge der NPC-Karte, Pfad-Vorschauen im Generator.
- „Bearbeiten" am Pool-Kopf und im Kampagnen-Lesekopf: Dialog mit Name +
  Beschreibung (schreibt `_campaign.md`, mtime-sicher). Auch nicht im
  Prototyp — erste kleine Scheibe des #15-Territoriums, per PO-Entscheid
  (#34).

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
