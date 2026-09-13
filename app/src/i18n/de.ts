// THE German catalog — and the source of truth for the KEY SET (issue #69).
//
// `MessageKey` is derived from this object (messages.ts), so every other
// language is a `Record<MessageKey, string>`: a key that is missing in `en.ts`
// — or one that exists only there — is a TYPE ERROR, not a runtime surprise.
// That is the whole reason the catalogs are TS objects instead of JSON.
//
// Values are ICU MessageFormat (ADR #15): `{name}` interpolates, `{count,
// plural, one {…} other {…}}` picks the form, `#` is the number itself.
// A literal brace in copy has to be quoted as `'{'` — there is none here.
//
// The German strings are taken 1:1 out of the components they came from; the
// typographic detail is part of the design (»…« as „ ", the em dash with
// spaces, the ellipsis character in „Speichere …"). Do not normalize them.
//
// SCHEIBE 1 (issue #69): topbar incl. session chip, campaign switcher, the
// five create dialogs, properties dialog + fields, rename dialog, cold start.
// Everything else still carries its literal strings and follows in Scheibe 2.

export const de = {
  // --- shared verbs ---------------------------------------------------------
  "common.cancel": "Abbrechen",
  "common.discard": "Verwerfen",
  "common.save": "Speichern",
  "common.saving": "Speichere …",
  "common.create": "Anlegen",
  "common.creating": "Lege an …",

  // --- language switch (campaign switcher menu) -----------------------------
  "language.heading": "Sprache",
  "language.de": "Deutsch",
  "language.en": "English",

  // --- topbar ---------------------------------------------------------------
  "topbar.brand": "Grimoire",
  "topbar.nav.aria": "Kapitel, NPCs und Orte",
  "topbar.nav.chapters": "Kapitel",
  "topbar.nav.npcs": "NPCs",
  "topbar.nav.locations": "Orte",
  "topbar.search": "Suchen …",
  "topbar.generator": "Generator",
  "topbar.generator.running": "Generierung läuft",
  "topbar.review.pending": "Review · {count} offen",
  "topbar.session.back": "Zur Session",

  // --- campaign switcher ----------------------------------------------------
  "campaign.switcher.current": "Kampagne: {name}",
  "campaign.switcher.empty": "Noch keine Kampagnen gefunden.",

  // --- the session chip -----------------------------------------------------
  "session.start": "Session starten",
  "session.start.failed": "Session nicht gestartet — Server prüfen",
  "session.start.olderRunning": "Eine ältere Session läuft noch — im Live-Modus beenden",
  "session.status.unknown": "Status unbekannt",
  "session.status.unknown.aria": "Session-Status unbekannt — Server prüfen",
  "session.state.running": "Session läuft",
  "session.state.paused": "Session pausiert",
  "session.state.withElapsed": "{state}, {elapsed}",
  "session.chip.link.aria": "{label} — zur laufenden Session",
  "session.chip.menu.aria": "{label} — Session-Menü",
  "session.short.running": "läuft",
  "session.short.paused": "pausiert",
  "session.menu.pause": "Pause",
  "session.menu.continue": "Weiter",
  "session.menu.end": "Session beenden",
  "session.menu.discard": "Session verwerfen",
  "session.write.failed": "Session nicht geändert — Server prüfen.",
  "session.discard.title": "Leere Session verwerfen?",
  "session.discard.description": "Die Session wird gelöscht.",
  "session.discard.failed": "Session nicht verworfen — Server prüfen und neu laden.",
  // `{date}` comes from Intl.DateTimeFormat in the selected language, so the
  // German reading stays „Session vom 13.09.2026".
  "session.date": "Session vom {date}",
  "session.date.unknown": "Session",

  // --- create dialogs -------------------------------------------------------
  "create.failed": "Nicht angelegt — Server prüfen.",
  "create.useSuggestion": '„{id}" verwenden',

  "create.campaign.title": "Kampagne anlegen",
  "create.campaign.description":
    "Der Name wird zur id der Kampagne — sie steht in jeder Adresse und bleibt, wie sie ist. Danach entstehen darin Kapitel und Szenen.",
  "create.campaign.nameLabel": "Name der Kampagne",
  "create.campaign.namePlaceholder": "Name der Kampagne",
  "create.campaign.idPrefix": "id: ",
  "create.campaign.descriptionLabel": "Beschreibung (optional)",
  "create.campaign.descriptionPlaceholder": "Ein Satz, der die Kampagne einordnet",

  "create.chapter.title": "Kapitel anlegen",
  "create.chapter.description":
    "Der Titel wird zur id des Kapitels — sie steht in jeder Szenen-Adresse und bleibt, wie sie ist. Das Ziel ist optional und landet unter „Ziel des Kapitels“.",
  "create.chapter.nameLabel": "Titel",
  "create.chapter.namePlaceholder": "Titel des Kapitels",
  "create.chapter.goalLabel": "Ziel des Kapitels (optional)",
  "create.chapter.goalPlaceholder": "Was die Gruppe hier erreichen soll",

  "create.scene.title": "Szene anlegen",
  "create.scene.description":
    "Die Szene entsteht als Entwurf in diesem Kapitel und öffnet gleich im Editor. Der Titel wird zur id — sie bleibt, wie sie ist.",
  "create.scene.nameLabel": "Titel",
  "create.scene.namePlaceholder": "Titel der Szene",

  "create.npc.title": "NPC anlegen",
  "create.npc.description":
    "Nur der Name — Rolle, Status und alles Weitere stehen danach im Eigenschaften-Dialog. Aus dem Namen wird die id, und die bleibt.",
  "create.npc.nameLabel": "Name",
  "create.npc.namePlaceholder": "Name des NPCs",

  "create.location.title": "Ort anlegen",
  "create.location.description":
    "Nur der Name — alles Weitere steht danach im Eigenschaften-Dialog. Aus dem Namen wird die id, und die bleibt.",
  "create.location.nameLabel": "Name",
  "create.location.namePlaceholder": "Name des Orts",

  // --- cold start ("/" without a campaign) ----------------------------------
  "home.opening": "Kampagne wird geöffnet …",
  "home.serverDown": "Server nicht erreichbar — Grimoire-Server auf Port 3000 starten.",
  "coldstart.title": "Willkommen bei Grimoire",
  "coldstart.lead": "Noch keine Kampagne. Leg eine an — danach entstehen darin Kapitel und Szenen.",
  "coldstart.id": "id: {id}",

  // --- properties dialog ----------------------------------------------------
  "properties.action": "Eigenschaften",
  "properties.title": "{kind}: Eigenschaften",
  "properties.description":
    "Alle Eigenschaften dieses Eintrags. Gespeichert wird nur, was du geändert hast — alles andere bleibt unverändert stehen.",
  "properties.id": "id",
  "properties.id.viaRename": ' · unten über „id ändern"',
  "properties.changeId": "id ändern",
  "properties.discard.title": "Änderungen verwerfen?",
  "properties.discard.close":
    "Die geänderten Eigenschaften sind nicht gespeichert. Verwerfen schließt das Fenster und lässt den Eintrag so, wie er gespeichert ist.",
  "properties.discard.rename":
    "Die geänderten Eigenschaften sind nicht gespeichert. Verwerfen öffnet die id-Änderung und lässt den Eintrag so, wie er gespeichert ist.",
  "properties.discard.keepEditing": "Weiter bearbeiten",

  "properties.kind.scene": "Szene",
  "properties.kind.npc": "NPC",
  "properties.kind.location": "Ort",
  "properties.kind.chapter": "Kapitel",

  // Field controls
  "properties.field.required": " · nötig",
  "properties.field.unset": "— nicht gesetzt —",
  "properties.field.chipsPlaceholder": "hinzufügen, Enter",
  "properties.field.addRow": "Zeile hinzufügen",
  "properties.field.remove.aria": "{item} entfernen",
  "properties.field.row": "Zeile {row}",
  "properties.field.row.name.aria": "{label}, Zeile {row}: Name",
  "properties.field.row.value.aria": "{label}, Zeile {row}: Wert",
  "properties.ref.unknownChapter": "Unbekannt — Kapitel muss existieren.",
  "properties.ref.freeText": "Freier Text — kein Eintrag.",
  "properties.ref.new": "Neu — wird beim Speichern angelegt.",
  "properties.issue.notAnId":
    '„{id}" ist keine id — nur Kleinbuchstaben, Ziffern und Bindestriche.',
  "properties.issue.namelessRow": "Zeile ohne Namen — Name ergänzen oder Zeile entfernen.",
  "properties.issue.duplicateName":
    'Name „{name}" doppelt — jeder Name darf nur einmal vorkommen.',

  // Per-kind field labels/hints/placeholders (lib/properties-form.ts)
  "properties.scene.title.label": "Titel",
  "properties.scene.type.label": "Typ",
  "properties.scene.type.planned": "geplant",
  "properties.scene.type.contingency": "Kontingenz",
  "properties.scene.trigger.label": "Auslöser",
  "properties.scene.trigger.hint": "Nur bei Kontingenz: wann feuert die Szene?",
  "properties.scene.chapter.label": "Kapitel",
  "properties.scene.location.label": "Ort",
  "properties.scene.location.hint": "id aus Orte oder freier Text.",
  "properties.scene.npcs.label": "NPCs",
  "properties.scene.npcs.hint": "Nur ids — unbekannte werden beim Speichern angelegt.",
  "properties.scene.handouts.label": "Handouts",
  "properties.scene.handouts.hint": "Name des Roll20-Handouts, nur ein Verweis.",
  "properties.scene.tags.label": "Tags",
  "properties.scene.tags.hint": "Frei; empfohlen: combat, social, stealth, travel.",
  "properties.scene.status.label": "Status",

  "properties.npc.name.label": "Name",
  "properties.npc.role.label": "Rolle",
  "properties.npc.role.hint": "Ein Einzeiler.",
  "properties.npc.chapter.label": "Kapitel",
  "properties.npc.chapter.hint": "Wo der NPC eingeführt wird.",
  "properties.npc.status.label": "Status",
  "properties.npc.statblock.label": "Statblock",
  "properties.npc.statblock.placeholder": "Roll20: Fenn",
  "properties.npc.statblock.hint": "Verweis auf das Roll20-Sheet, keine Kopie.",
  "properties.npc.quickstats.label": "Quickstats",
  "properties.npc.quickstats.hint": "Frei — nur was sozial gebraucht wird, z. B. insight +2.",
  "properties.npc.voice.label": "Stimme",
  "properties.npc.voice.hint": "Wie klingt er/sie?",
  "properties.npc.appearance.label": "Erscheinung",
  "properties.npc.appearance.hint": "Ein bis zwei Merkmale.",

  "properties.location.name.label": "Name",
  "properties.location.chapter.label": "Kapitel",
  "properties.location.roll20.label": "Roll20-Seite",
  "properties.location.roll20.hint": "Verweis auf die Page, keine Karten-Kopie.",

  "properties.chapter.title.label": "Titel",
  "properties.chapter.status.label": "Status",
  "properties.chapter.status.placeholder": "active",
  "properties.chapter.status.hint":
    "Der Wert active markiert das Kapitel, das die Live-Ansicht öffnet.",

  // --- rename dialog --------------------------------------------------------
  "rename.title": "{kind}: id ändern",
  "rename.description":
    "Die neue id zieht alle Referenzen mit: Eigenschaften, Session-Log und Beziehungslisten. Erwähnungen im Fließtext bleiben unverändert.",
  "rename.newId.label": "neue id (aktuell {oldId})",
  "rename.preview": "Vorschau",
  "rename.previewing": "Prüfe …",
  "rename.commit": "Umbenennen",
  "rename.committing": "Benenne um …",

  "rename.kind.npc": "NPC",
  "rename.kind.location": "Ort",
  "rename.kind.scene": "Szene",
  "rename.kind.chapter": "Kapitel",

  "rename.error.unchanged": "Unverändert — das ist schon die aktuelle id.",
  "rename.error.slug": "id braucht Kleinbuchstaben, Ziffern und einzelne Bindestriche.",
  "rename.error.reserved": "npcs, locations und sessions sind reservierte Namen.",
  "rename.failed": "Umbenennen fehlgeschlagen — Server prüfen.",
  "rename.conflict.ambiguous": "Mehrere Einträge beanspruchen diese id — Konflikt in der Datenbank.",
  "rename.conflict.path": "{path} existiert schon — andere id wählen.",
  "rename.notFound": "Nicht gefunden — Ansicht neu laden.",
  "rename.badId": "id abgelehnt — Kleinbuchstaben, Ziffern und einzelne Bindestriche.",

  "rename.changed": "betrifft {count, plural, one {# Eintrag} other {# Einträge}}",
  "rename.usage.total": "{count, plural, one {# Verwendung} other {# Verwendungen}}",
  "rename.usage.none": "Keine Referenzen — nichts hängt an dieser id.",
  "rename.usage.sceneNpcs": "{count, plural, one {# Szene} other {# Szenen}}",
  "rename.usage.npcRelations": "{count, plural, one {# Beziehung} other {# Beziehungen}}",
  "rename.usage.sceneLocation": "{count, plural, one {# Szene} other {# Szenen}}",
  "rename.usage.scenesPlayed":
    "{count, plural, one {# Session-Eintrag} other {# Session-Einträge}}",
  "rename.usage.logEntries": "{count, plural, one {# Log-Zeile} other {# Log-Zeilen}}",
  "rename.usage.chapterScenes": "{count, plural, one {# Szene} other {# Szenen}}",
  "rename.usage.chapterNpcs": "{count, plural, one {# NPC} other {# NPCs}}",
  "rename.usage.chapterLocations": "{count, plural, one {# Ort} other {# Orte}}",
  "rename.usage.bodyRefs": "{count, plural, one {# Textstelle} other {# Textstellen}}",
} as const;
