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
- Topbar-Navigation „Kapitel · NPCs · Orte" ist eine PERSISTENTE
  Sektions-Navigation, keine Breadcrumb: leise Links in der Titelleiste,
  kampagnenbezogen, ab `lg` sichtbar, nicht im Live-Modus. „Kapitel" ist
  der Pool und damit der Rückweg von überall — das Kampagnen-Label daneben
  ist der Switcher-Trigger, kein Link, und die Wortmarke wäre ein Umweg
  über „/" (PO-Rückmeldung zu PR #35). Markiert wird die SEKTION der
  aktuellen Ansicht, nicht die Route: Pool und Szenendateien →
  „Kapitel", NPC-Datei und NPC-Liste → „NPCs", Ort-Datei und Ortsliste →
  „Orte", Generator/Review/Kampagnendatei/Session/Inbox/Glossar → keine
  Markierung (eine willkürliche wäre eine Lüge). Der markierte Eintrag
  trägt `aria-current="page"` und volle Textfarbe (`foreground` gegen
  `body-secondary`) — nur Farbe, keine Schriftstärke: ein Gewichtswechsel
  würde die Zeile umbrechen lassen. Der Prototyp deckt diese Navigation
  nicht ab; die bisherige Pool-Fußzeile („NPCs · Orte" unter der
  Kapitelliste, aus #26) war eine Team-Minimallösung und entfällt. Die
  Topbar-Links schließen die Design-Lücke per PO-Entscheid (#34) —
  künftige Views denken sie mit. Mobil bleibt die „Nachschlagen"-Liste der
  Startfläche der Zugang; ⌘K findet beide Listen in jeder Breite.
- CHROME IST GLOBAL UND STABIL. Der linke Topbar-Block ist auf ALLEN
  kampagnenbezogenen Ansichten identisch — Pool, Nachschlage-Listen,
  Datei-/Szenen-Ansicht, Generator, Review:

      Grimoire │ Kampagne: <Name> ⌄ │ Kapitel · NPCs · Orte

  Beim Wechsel zwischen ihnen erscheint und verschwindet nichts, nichts
  verschiebt sich; der einzige Unterschied ist die Markierung im Trio.
  Das gilt seit der Chip-Konsolidierung (siehe nächster Punkt) auch für den
  Live-Modus: er zeigt denselben Switcher an derselben Stelle, nur ohne das
  Trio (dieser Modus gehört der laufenden Session). Die rechte Seite bleibt
  ansichtsspezifisch (⌘K, Session-Button, Review-Fortschritt,
  Generator-Einstieg).
- EIN SESSION-CHIP statt Live-Steuerung (PO-Rückmeldung zu #40, Overflow
  #50). Die laufende Session war über sechs Elemente verteilt — grüne
  Live-Pille, separater Timer, Pause, „Session beenden", „Session
  verwerfen", eigene mobile LiveBar — mit wechselnder Menge und Reihenfolge
  je Route; bei mittleren Breiten lief die Leiste über. Jetzt: EIN Chip
  direkt hinter dem Switcher, auf allen kampagnenbezogenen Routen an
  derselben Stelle, `/live` eingeschlossen:

      Grimoire │ Kampagne: <Name> ⌄ │ ● 0:12:33 │ Kapitel · NPCs · Orte

  Messing (Akzent) IST der Zustand — kein „Live"-Label mehr; Laufzeit
  H:MM:SS mit Sekundentick (der 15s-Tick auf Minuten wirkte eingefroren).
  Außerhalb von `/live` führt der Klick zurück in die Session, in `/live`
  öffnet er das Session-Menü (Pause · Session beenden · Session verwerfen,
  letzteres nur bei leerer Session). Unter `md` sitzt derselbe Chip in einer
  eigenen schmalen Zeile (Link-Modus — es gibt keinen mobilen Live-Modus).
  Das Kapitel-Label der alten Live-Topbar steht jetzt über der Szenen-Nav
  des Live-Modus. Abweichung vom Prototyp, der zwei Topbar-Layouts kennt:
  Stabilität der Session-Bedienung gewinnt.
- DERSELBE CHIP IN JEDEM ZUSTAND (PO-Rückmeldung zu #40). Der Chip ist nicht
  nur die Anzeige der laufenden Session, er IST die Session-Bedienung — ein
  Element, ein Slot, gleiche Höhe, Form, Paddings und Schriftgröße; nur
  Inhalt und Farbe wechseln:
  „Session starten" (bzw. „Session fortsetzen", wenn die heutige Session
  beendet ist) als Messing-Aufforderung · ● H:MM:SS in gedämpftem Messing,
  solange eine Session läuft · „Status unbekannt", gedimmt und nicht
  klickbar, wenn die Session-Abfrage fehlschlägt. Der separate Start-Button
  und die eigene Textzeile „Session-Status unbekannt" entfallen. Ab `lg`
  hält eine Mindestbreite die Zustände auf vergleichbarer Größe, darunter
  ist die Leiste dafür zu eng (#50); die Laufzeit nutzt Tabellenziffern,
  damit der Sekundentick nichts verschiebt. Der Start erscheint nur bei der
  ausdrücklichen Server-Antwort „nichts läuft" — nie während der Abfrage
  und nie nach einem Fehler.
- BEI KEINER BREITE ≥390px HORIZONTALER OVERFLOW (#50). Elastisch in der
  Leiste ist der ⌘K-Chip (Label kürzt), der Kampagnenname kürzt mit
  Ellipsis (unter `xl` härter), der Generator-Einstieg trägt unter `xl` nur
  sein Icon (Name bleibt zugänglich). Die Topbar-E2E prüft mehrere mittlere
  Breiten mit laufender Session.
- KEINE BREADCRUMBS IN DER TOPBAR — nirgends. Die drei früheren
  (Szene, Liste, Generator) haben jeweils den Kampagnennamen wiederholt,
  mit der Navigation daneben konkurriert und auf einer Datei einen
  Kapitelpfad behauptet, der für einen aus der NPC-Liste geöffneten NPC
  schlicht falsch war (PO-Rückmeldung mit Screenshot zu PR #35).
- SEITEN-KONTEXT LEBT IN DER SEITE. Die Hierarchie steht als leise
  Kontextzeile über dem Titel, direkt bei dem, was sie beschreibt:
  Szene → `<Kapiteltitel> › <Gruppe>` (Kapitel verlinkt auf den Pool,
  Gruppe wie ein Pool-Gruppenkopf aufgelöst), `<kapitel>/_chapter` → nur das
  Kapitel, NPC → „NPCs", Ort → „Orte" (jeweils auf ihre Liste). Kampagnen-
  Datei, Sessions, Inbox, Glossar bekommen keine Zeile. Desktop-Pendant
  der mobilen „‹ Pool"-Zeile (die bleibt unter `md`).
- KAMPAGNENNAME GENAU EINMAL im Chrome: im Switcher. Nie in Krümeln, nie
  in Kontextzeilen.
- Anzeigenamen statt ids: Pool-Gruppenköpfe zeigen den Ortsnamen, wenn
  `locations/<slug>` existiert (sonst den Slug unverändert — Gruppen-
  Ordner sind lose Konvention), der Review-Quellchip den Szenentitel
  („Log · Ankunft am Leuchtturm", Fallback id). Sichtbare ids bleiben nur
  in Identifikations-Kontexten, dort mono: Rename-Dialog, NPC-Stub-
  Platzhalter, id-Badge der NPC-Karte, Pfad-Vorschauen im Generator.
- „Bearbeiten" am Pool-Kopf und im Kampagnen-Lesekopf: Dialog mit Name +
  Beschreibung (schreibt `_campaign`, `rev`-sicher). Auch nicht im
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
