// THE German catalog — and the source of truth for the KEY SET.
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
// The German strings are the ones the components show; their typographic
// detail is part of the design (curly quotation marks, the em dash with
// spaces, the single ellipsis character). Do not normalize them.
//
// The catalog covers the topbar incl. session chip, campaign switcher, the
// five create dialogs, properties dialog + fields, cold start and the areas
// listed in the sections below. A component not covered here still carries
// its literal strings.

export const de = {
  // --- shared verbs ---------------------------------------------------------
  "common.cancel": "Abbrechen",
  "common.discard": "Verwerfen",
  "common.save": "Speichern",
  "common.saving": "Speichere …",
  "common.create": "Anlegen",
  "common.creating": "Lege an …",
  "common.serverDown":
    "Server nicht erreichbar — Grimoire-Server auf Port 3000 starten.",

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
  "topbar.generator.running": "Generierung läuft …",
  "topbar.generator.progress": "{written} von {total} übernommen",
  "topbar.review.pending": "Nachbereitung · {count} offen",
  // The same link below xl, where the row has no width to spare:
  // the COUNT is the news, the word is the one thing that can go. The full
  // label stays as the accessible name at every width.
  "topbar.review.pendingShort": "{count} offen",
  "topbar.session.back": "Zur Session",

  // --- campaign switcher ----------------------------------------------------
  "campaign.switcher.current": "Kampagne: {name}",
  "campaign.switcher.empty": "Noch keine Kampagnen gefunden.",

  // --- the session chip -----------------------------------------------------
  "session.start": "Session starten",
  "session.start.failed": "Session nicht gestartet — Server prüfen",
  "session.start.olderRunning": "Eine ältere Session läuft noch — in der Session-Ansicht beenden",
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
  // date reads in the conventions of that language.
  "session.date": "Session vom {date}",
  "session.date.unknown": "Session",

  // --- the reading page of one session --------------------------------------
  // There is no session list page, so the context step is a plain word.
  "session.page.crumb": "Sessions",
  "session.page.loading": "Lade Session …",
  "session.page.notLoadable": "Session nicht ladbar — Server prüfen und neu laden.",
  "session.page.started": "Start",
  "session.page.ended": "Ende",
  "session.page.stillRunning": "läuft noch",
  "session.page.timeUnknown": "unbekannt",
  "session.page.runtime": "Spielzeit",
  "session.page.log": "Log",
  "session.page.log.empty": "In dieser Session wurde nichts notiert.",
  "session.page.pauses": "Pausen",
  "session.page.pauseRow": "{from} – {to} ({duration})",
  "session.page.scenes": "Gespielte Szenen",
  "session.page.scenes.empty": "Keine Szene als gespielt vermerkt.",

  // --- create dialogs -------------------------------------------------------
  "create.failed": "Nicht angelegt — Server prüfen.",
  "create.useSuggestion": '„{id}“ verwenden',

  "create.campaign.title": "Kampagne anlegen",
  "create.campaign.nameLabel": "Name der Kampagne",
  "create.campaign.namePlaceholder": "Name der Kampagne",
  "create.campaign.idPrefix": "Kennung: ",
  "create.campaign.descriptionLabel": "Beschreibung (optional)",
  "create.campaign.descriptionPlaceholder": "Ein Satz, der die Kampagne einordnet",

  "create.chapter.title": "Kapitel anlegen",
  "create.chapter.description":
    "Die Beschreibung ist optional. Sie wird der Text des Kapitels und steht in der Kapitelübersicht unter dem Titel.",
  "create.chapter.nameLabel": "Titel",
  "create.chapter.namePlaceholder": "Titel des Kapitels",
  "create.chapter.descriptionLabel": "Beschreibung (optional)",
  "create.chapter.descriptionPlaceholder":
    "Worum es in diesem Kapitel geht und was die Gruppe erreichen soll",

  "create.scene.title": "Szene anlegen",
  "create.scene.description":
    "Die Szene entsteht als Entwurf in diesem Kapitel und öffnet gleich im Editor.",
  "create.scene.nameLabel": "Titel",
  "create.scene.namePlaceholder": "Titel der Szene",

  "create.npc.title": "NPC anlegen",
  "create.npc.description":
    "Nur der Name — Rolle, Status und alles Weitere stehen danach im Eigenschaften-Dialog.",
  "create.npc.nameLabel": "Name",
  "create.npc.namePlaceholder": "Name des NPCs",

  "create.location.title": "Ort anlegen",
  "create.location.description":
    "Nur der Name — alles Weitere steht danach im Eigenschaften-Dialog.",
  "create.location.nameLabel": "Name",
  "create.location.namePlaceholder": "Name des Orts",

  // --- the id line of every create surface (components/IdField.tsx) ---------
  "idField.label": "Kennung",
  "idField.edit": "Kennung selbst setzen",
  "idField.invalid":
    "Die Kennung braucht Kleinbuchstaben, Ziffern und einzelne Bindestriche.",

  // --- cold start ("/" without a campaign) ----------------------------------
  "home.opening": "Kampagne wird geöffnet …",
  "coldstart.title": "Willkommen bei Grimoire",
  "coldstart.lead": "Noch keine Kampagne. Leg eine an — danach entstehen darin Kapitel und Szenen.",

  // --- properties dialog ----------------------------------------------------
  "properties.action": "Eigenschaften",
  "properties.title": "{kind}: Eigenschaften",
  "properties.description":
    "Alle Eigenschaften dieses Eintrags. Gespeichert wird nur, was du geändert hast — alles andere bleibt unverändert stehen.",
  "properties.id": "Kennung",
  "properties.discard.title": "Änderungen verwerfen?",
  "properties.discard.close":
    "Die geänderten Eigenschaften sind nicht gespeichert. Verwerfen schließt das Fenster und lässt den Eintrag so, wie er gespeichert ist.",
  "properties.discard.keepEditing": "Weiter bearbeiten",
  // The same question for LEAVING A PAGE whose save is explicit
  // (components/UnsavedChangesGuard.tsx); the title is shared.
  "unsaved.description":
    "Auf dieser Seite gibt es ungespeicherte Änderungen. Beim Verlassen gehen sie verloren.",


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
  "properties.ref.unknown": "Unbekannt — Eintrag muss existieren.",
  "properties.ref.unknownLocation": "Unbekannt — Ort muss existieren.",
  "properties.issue.locationUnusable":
    'Kein verwendbarer Name — „{value}“ ergibt keine Orts-Kennung.',
  "properties.issue.notAnId":
    '„{id}“ ist keine Kennung — nur Kleinbuchstaben, Ziffern und Bindestriche.',
  "properties.issue.namelessRow": "Zeile ohne Namen — Name ergänzen oder Zeile entfernen.",
  "properties.issue.duplicateName":
    'Name „{name}“ doppelt — jeder Name darf nur einmal vorkommen.',
  "properties.issue.chapterRequired":
    "Eine Szene braucht ein Kapitel — es lässt sich verschieben, aber nicht entfernen.",

  // Field labels/hints/placeholders — a scene's (scene/SceneFields.tsx), a
  // chapter's (chapter/ChapterFields.tsx), an npc's (npc/NpcFields.tsx) and a
  // location's (location/LocationFields.tsx)
  "properties.scene.title.label": "Titel",
  "properties.scene.type.label": "Typ",
  "properties.scene.type.planned": "Geplante Szene",
  "properties.scene.type.contingency": "Eventualszene",
  "properties.scene.trigger.label": "Auslöser",
  "properties.scene.trigger.hint": "Nur bei Eventualszenen: wann feuert die Szene?",
  "properties.scene.chapter.label": "Kapitel",
  "properties.scene.location.label": "Ort",
  "properties.scene.location.hint":
    "Ort aus der Liste wählen — die Szene nennt ihn in ihrer Metazeile, in der Leseansicht und in der Session-Ansicht.",
  "properties.scene.npcs.label": "NPCs",
  "properties.scene.npcs.hint": "Nur ids — der NPC muss schon einen Eintrag haben.",
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
  "properties.npc.quickstats.label": "Kurzwerte",
  "properties.npc.quickstats.hint": "Frei — nur was sozial gebraucht wird, z. B. insight +2.",
  "properties.npc.voice.label": "Stimme",
  "properties.npc.voice.hint": "Wie klingt er/sie?",
  "properties.npc.appearance.label": "Erscheinung",
  "properties.npc.appearance.hint": "Ein bis zwei Merkmale.",
  "properties.npc.motivation.label": "Will",
  "properties.npc.motivation.hint":
    "Was die Figur will — die NPC-Karte und die Vorschau zeigen es. [[id]] erscheint dort als Name.",

  "properties.location.name.label": "Name",
  "properties.location.chapter.label": "Kapitel",
  "properties.location.roll20.label": "Roll20-Seite",
  "properties.location.roll20.hint": "Verweis auf die Page, keine Karten-Kopie.",
  "properties.location.atmosphere.label": "Atmosphäre",
  "properties.location.atmosphere.hint":
    "Wie der Ort wirkt — die Ort-Karte und die Vorschau zeigen es. [[id]] erscheint dort als Name.",

  "properties.chapter.title.label": "Titel",
  "properties.chapter.status.label": "Status",
  "properties.chapter.status.planned": "Geplant",
  "properties.chapter.status.active": "Aktiv",
  "properties.chapter.status.done": "Abgeschlossen",
  "properties.chapter.status.hint":
    "Aktiv markiert das Kapitel, das die Session-Ansicht öffnet — es gibt genau eins; das vorherige wird wieder geplant.",

  // --- settings page (/settings) --------------------------------------------
  "settings.title": "Einstellungen",
  "settings.lead":
    "Einstellungen dieser Grimoire-Instanz. Änderungen gelten sofort und liegen auf dem Server.",
  "settings.language.heading": "Sprache",
  "settings.language.hint": "Sprache der Oberfläche. Gilt für diese Instanz, nicht für die Kampagnendaten.",

  // --- the two campaign-content pages --------------------------------------
  // the campaign-knowledge page (/campaigns/:campaign/knowledge) and the
  // glossary page (/campaigns/:campaign/glossary). Campaign CONTENT, like the
  // npcs and the locations — the instance settings under /settings are a
  // different thing entirely.
  // Shared by both pages: the row controls, the per-entry
  // save outcome, the delete confirmation.
  "entryList.loading": "Lade Liste …",
  "entryList.loadFailed": "Liste nicht geladen — Seite neu laden.",
  "entryList.saveFailed": "Nicht gespeichert.",
  "entryList.saving": "Speichere …",
  "entryList.saved": "Gespeichert",
  "entryList.moveUp": "Nach oben",
  "entryList.moveDown": "Nach unten",
  "entryList.edit": "„{name}“ bearbeiten",
  "entryList.remove": "„{name}“ löschen",
  "entryList.removed": "Eintrag gelöscht",
  // Re-aiming the draft is offered only when the opened entry is still in the
  // list that came back (components/EntryListPage.tsx); reloading is the
  // shared `editConflict.reload`.
  "entryList.applyDraft": "Entwurf behalten & auf aktuelle Liste anwenden",
  "entryList.confirmDelete.title": "Eintrag löschen?",
  "entryList.confirmDelete.body": "„{name}“ wird aus der Liste entfernt. Das lässt sich nicht rückgängig machen.",
  "entryList.confirmDelete.confirm": "Löschen",

  "knowledge.title": "Kampagnenwissen",
  "knowledge.lead":
    "Namenskonventionen, Fakten und Stilregeln dieser Kampagne. Geht bei jedem Generator-Lauf mit und gilt verbindlich — auch wenn das Quellmaterial etwas anderes sagt. Die Reihenfolge ist die Reihenfolge im Prompt. Referenzen wie [[fenn]] werden zum Namen aufgelöst.",
  "knowledge.filter": "Wissen filtern",
  "knowledge.empty":
    "Noch kein Kampagnenwissen — ersten Eintrag anlegen (z. B. eine Namenskonvention).",
  "knowledge.noMatch": "Kein Eintrag passt zum Filter.",
  "knowledge.add": "Neuer Eintrag",
  "knowledge.blank": "Noch nichts eingetragen",
  "knowledge.kindLabel": "Art",
  "knowledge.kind.naming": "Namenskonvention",
  "knowledge.kind.fact": "Fakt",
  "knowledge.kind.style": "Stilregel",
  "knowledge.from": "Alt (im Quellmaterial)",
  "knowledge.to": "Neu (in dieser Kampagne)",
  "knowledge.factText": "Fakt, der gilt",
  "knowledge.styleText": "Stilregel für generierte Texte",
  "knowledge.incomplete": "Unvollständig — geht so nicht mit in den Prompt.",

  "glossary.title": "Glossar",
  "glossary.lead":
    "Übersetzungen für den Generator: englischer Begriff und die Schreibweise dieser Kampagne. Alphabetisch sortiert.",
  "glossary.filter": "Begriff filtern",
  "glossary.empty": "Noch keine Begriffe — ersten Begriff anlegen.",
  "glossary.noMatch": "Kein Begriff passt zum Filter.",
  "glossary.add": "Neuer Begriff",
  "glossary.term": "Begriff",
  "glossary.explanation": "Erklärung",
  "glossary.noExplanation": "Ohne Erklärung",

  // Where the two pages are reached from: the chapter overview's lookup line
  // and the mobile start surface's rows (deliberately NOT
  // the topbar, which stays the three campaign-wide entries it has).
  "lookup.heading": "Nachschlagen",

  // --- server error bodies (code -> sentence, see i18n/server-errors.ts) ----
  "server.slug_taken": '{kind} „{id}“ existiert schon — Vorschlag: „{suggestion}“',
  "server.slug_reserved": '„{id}“ ist ein reservierter Name — Vorschlag: „{suggestion}“',
  "server.slug_empty": "{field} ergibt keine Kennung — bitte Buchstaben oder Ziffern verwenden.",
  "server.location_not_an_id":
    'Der Ort „{value}“ ist keine Orts-Kennung — „{suggestion}“ verwenden und den Ort zuerst anlegen.',
  "server.location_not_an_id.noSuggestion":
    'Der Ort „{value}“ ist keine Orts-Kennung — bitte Kleinbuchstaben, Ziffern und Bindestriche verwenden.',
  "server.location_unknown": 'Den Ort „{value}“ gibt es nicht — bitte zuerst anlegen.',
  "server.npc_unknown": 'Den NPC „{value}“ gibt es nicht — bitte zuerst anlegen.',
  "server.chapter_unknown": 'Das Kapitel „{value}“ gibt es nicht — bitte zuerst anlegen.',
  "server.chapter_required": "Eine Szene braucht ein Kapitel — es lässt sich verschieben, aber nicht entfernen.",
  "server.log_scene_unknown": 'Die Szene „{value}“ gibt es nicht — bitte zuerst anlegen.',
  "server.played_scene_unknown":
    'Die gespielte Szene „{value}“ gibt es nicht — bitte zuerst anlegen.',
  "server.glossary_duplicate_term":
    'Glossar-Begriff „{term}“ kommt mehrfach vor — bitte zusammenfassen.',
  "server.scene_order_mismatch":
    "Die Reihenfolge passt nicht mehr zu den Szenen des Kapitels — bitte neu laden.",
  "server.session_running": "Eine ältere Session läuft noch — erst beenden.",
  "server.session_not_empty": "Diese Session hat Inhalt — beenden statt verwerfen.",
  "server.rev_conflict": "Inzwischen geändert — neu laden vor dem Speichern.",
  "server.nothing_to_write": "Nichts zu speichern.",
  "server.body_not_editable":
    "Dieser Eintrag hat keinen bearbeitbaren Text — er wird als Liste gepflegt.",
  "server.job_restarted": "Server wurde während des Laufs neu gestartet — Job neu starten.",
  "server.job_draft_format":
    "Dieser Lauf stammt aus einem älteren Entwurfsformat und kann nicht mehr übernommen werden — bitte neu erzeugen.",
  "server.llm_truncated":
    "Antwort wurde vom Modell abgeschnitten — LLM_MAX_TOKENS erhöhen (aktuell: {max}) oder Quelltext verkleinern.",
  "server.llm_invalid": "Antwort hat die mechanische Prüfung nicht bestanden.",
  "server.llm_truncated.defaultCap": "Standard des Endpoints",
  "server.status_not_allowed": 'Status „{value}“ gibt es nicht — erlaubt sind {allowed}.',
  "server.scene_type_not_allowed": 'Szenentyp „{value}“ gibt es nicht — erlaubt sind {allowed}.',
  "server.timestamp_not_allowed":
    'Zeitangabe „{value}“ hat nicht die Form JJJJ-MM-TTThh:mm:ss.',

  "server.kind.entry": "Der Eintrag",
  "server.kind.campaign": "Kampagne",
  "server.kind.chapter": "Kapitel",
  "server.kind.scene": "Szene",
  "server.kind.npc": "NPC",
  "server.kind.location": "Ort",
  "server.field.name": "Der Name",
  "server.field.title": "Der Titel",

  // --- status enum labels (lib/scene-status.ts, npc/npc-status.ts) ----------
  "status.scene.ready": "Bereit",
  "status.scene.draft": "Entwurf",
  "status.scene.played": "Gespielt",
  "status.scene.dropped": "Verworfen",
  "status.npc.alive": "Lebendig",
  "status.npc.dead": "Tot",
  "status.npc.missing": "Vermisst",
  "status.npc.unknown": "Unbekannt",

  // --- browse list pages (/campaigns/:campaign/list/:kind) ---------------------------
  "browse.title.scenes": "Szenen",
  "browse.title.npcs": "NPCs",
  "browse.title.locations": "Orte",

  // --- the shared write layer (lib/write-with-rev.ts, lib/use-rev-write.ts) -
  "write.stale": "Inzwischen geändert — neu laden",
  "write.failed": "Nicht gespeichert — Server prüfen",
  "write.properties.failed": "Eigenschaften nicht gespeichert — Server prüfen",
  "write.status.failed": "Status nicht gespeichert — Server prüfen",
  // The conflict line every editing surface shows (components/EditConflict.tsx)
  // and its two answers. The line only STATES it; the answers are controls,
  // because a refused write leaves the draft on screen and nothing decided.
  "editConflict.line": "Inzwischen geändert",
  "editConflict.reload": "Neu laden",
  "editConflict.force": "Trotzdem speichern",
  "status.change.aria": "Status ändern, aktuell {current}",
  "status.sceneUnloadable": "Szene nicht ladbar",
  "status.chapterUnloadable": "Dieses Kapitel ließ sich nicht laden.",

  // --- the chapter overview ("/campaigns/:campaign", routes/chapter-overview.tsx) ---
  "chapterOverview.loading": "Lade Szenen …",
  "chapterOverview.empty":
    "Noch keine Kapitel. Ein Kapitel ist die Klammer um Szenen — danach legst du darin die erste Szene an.",
  // The two counts of the overview header and the chapter accordions. German
  // has one form for both plural categories here — the ICU shape stays, so `en`
  // can differ without a second call site.
  "chapterOverview.chapterCount": "{count, plural, one {# Kapitel} other {# Kapitel}}",
  "chapterOverview.sceneCount": "{count, plural, =0 {keine Szenen} one {# Szene} other {# Szenen}}",
  "chapterOverview.chapter.empty": "Noch keine Szenen in diesem Kapitel.",
  // --- chapter actions in the chapter overview -----------------------------
  // The chapter's status control (the active option sets `active`, and the
  // server takes it off the chapter that held it in the same write) carries its
  // labels under `properties.chapter.status.*`.
  "chapterOverview.chapter.properties": "Kapitel-Eigenschaften",
  "chapterOverview.chapter.edit": "Kapitel bearbeiten",
  "chapterBody.title": "Kapitel bearbeiten: {title}",
  "chapterBody.description":
    "Der Text des Kapitels als Markdown. Die Kapitelübersicht zeigt ihn unter dem Titel.",
  "chapterBody.field.body": "Text",
  "chapterBody.field.body.placeholder":
    "Worum es in diesem Kapitel geht und was die Gruppe erreichen soll",
  // The quiet second half of the contingency-scenes heading row — the `· `
  // separator stays markup in the JSX.
  "chapterOverview.contingencies.hint": "nur wenn der Auslöser feuert",
  "chapterOverview.scene.trigger": "Wenn: {trigger}",
  // Up/down on a scene row (ADR #27). The title is IN the name: a list of
  // bare "move up" buttons says nothing about which row it moves — neither to
  // a screen reader nor in a test.
  "chapterOverview.scene.moveUp.aria": "„{title}“ nach oben",
  "chapterOverview.scene.moveDown.aria": "„{title}“ nach unten",
  // The order has no "save anyway" answer: an order arranged against a list
  // somebody else has already changed would write positions for scenes the DM
  // never saw there. So it reports and reloads, like the status control.
  "chapterOverview.order.conflict":
    "Reihenfolge inzwischen geändert — der aktuelle Stand ist geladen.",
  "chapterOverview.order.failed": "Reihenfolge nicht gespeichert — Server prüfen.",
  // The chapter's open threads (components/ChapterThreads.tsx) — a list of
  // rows beside the chapter, never a checklist in its text. The row controls
  // carry the thread's text in their names, like the scene rows' up/down.
  "chapterOverview.threads.label": "Offene Handlungsstränge",
  "chapterOverview.threads.done.aria": "„{text}“ erledigt",
  "chapterOverview.threads.edit.aria": "„{text}“ bearbeiten",
  "chapterOverview.threads.remove.aria": "„{text}“ löschen",
  "chapterOverview.threads.add": "Handlungsstrang hinzufügen",
  "chapterOverview.threads.addSubmit": "Hinzufügen",
  "chapterOverview.threads.input": "Offener Handlungsstrang",
  "chapterOverview.threads.new": "neu aus der Nachbereitung",
  "chapterOverview.threads.failed": "Nicht gespeichert — Server prüfen.",
  "chapterOverview.threads.confirmDelete.title": "Handlungsstrang löschen?",
  "chapterOverview.threads.confirmDelete.body":
    "„{text}“ wird aus der Liste entfernt. Das lässt sich nicht rückgängig machen.",
  "chapterOverview.threads.confirmDelete.confirm": "Löschen",

  // --- browse list pages (routes/browse.tsx) --------------------------------
  // The three list titles are already above under `browse.title.*`.
  "browse.fallbackTitle": "Nachschlagen",
  "browse.unknown": "Diese Liste gibt es nicht.",
  "browse.loading": "Lade …",
  "browse.empty.scenes": "Noch keine Szenen.",
  "browse.empty.npcs": "Noch keine NPCs.",
  "browse.empty.locations": "Noch keine Orte.",

  // --- the reading views (scene/, chapter/, npc/, location/) ----------------
  "scene.loading": "Lade Eintrag …",
  "scene.notLoadable": "Eintrag nicht ladbar — Pfad prüfen oder Server starten.",
  "scene.npcs.heading": "NPCs dieser Szene",

  // --- context line + mobile back row ---------------------------------------
  "context.aria": "Kontext",
  "mobileBack.chapterOverview": "Kapitel",

  // --- shared scene-group headings (routes/live.tsx + routes/chapter-overview.tsx) ------
  // Neutral prefix on purpose: the live nav and the chapter overview list show the SAME
  // two group headings — one key, not one per view.
  "scene.planned.heading": "Geplant",
  "scene.contingencies.heading": "Eventualszenen",

  // --- live mode (routes/live.tsx) ------------------------------------------
  // Below md there is no live mode (UI-BRIEF §4) — just the pointer.
  "live.mobile.note": "Die Session-Ansicht ist für den Desktop gedacht.",
  "live.mobile.read": "Szene lesen: {title}",

  "live.nav.aria": "Szenen der Session",
  "live.nav.noPlanned": "Keine geplanten Szenen in diesem Kapitel.",
  // The collapsed group of scenes that are behind us: the heading
  // alone names the group for a screen reader, `playedGroup` is the visible
  // trigger where the count is PART of the sentence.
  "live.nav.played": "Gespielt",
  "live.nav.playedGroup": "Gespielt {count}",

  // The one step of the evening, under the open scene.
  "live.next": "Nächste Szene: {title}",

  "live.scene.none":
    "Keine Szene im aktiven Kapitel — Szenen in der Kapitelübersicht anlegen.",
  "live.scene.loading": "Lade Szene …",
  "live.scene.unloadable": "Diese Szene ließ sich nicht laden.",
  "live.scene.locationHeading": "Ort",
  "live.scene.npcsHeading": "NPCs",
  "live.scene.noNpcs": "Keine NPCs in dieser Szene.",

  "live.log.heading": "Log",
  "live.log.empty": "Noch keine Einträge — die Schnellnotiz unten landet hier.",
  "live.note.aria": "Schnellnotiz",
  "live.note.placeholder": "Schnellnotiz … #thread #npc #loot",
  "live.note.hint": "Enter sendet · Zeit und Szene werden automatisch gesetzt",
  "live.note.failed": "Notiz nicht gespeichert — Server prüfen.",

  "live.session.loading": "Lade Session …",
  "live.session.unloadable": "Session nicht ladbar — Server prüfen und neu laden.",
  "live.session.none": "Es läuft keine Session.",
  // The one start conflict the live route turns into a question: an OLDER
  // session nobody ended. One sentence per variant — the session is a
  // parameter, never a fragment between two halves.
  "live.session.olderRunning": "Eine ältere Session läuft noch — erst beenden.",
  "live.session.olderRunning.withSession":
    "Eine ältere Session läuft noch ({session}) — erst beenden.",
  "live.session.endOld": "Alte Session beenden",

  // The players-facing reminder list of the aside.
  "live.pc.heading": "Für die Spieler",
  "live.pc.done": "„{text}“ erledigt",
  "live.pc.allDone": "Alles erledigt.",
  "live.pc.failed": "Nicht gespeichert — Server prüfen.",

  // --- live detail drawer (components/LiveEntityDrawer.tsx) -----------------
  "live.drawer.loading": "Lade Details …",
  "live.drawer.unloadable": "Nicht ladbar — {path} prüfen.",
  "live.drawer.open": "Eintrag öffnen",

  // --- review (the session wrap-up; the harvest metaphor lives in the code
  // names only, not in the UI)
  // routes/review.tsx, lib/use-review.ts ------------------------------------
  "review.title": "Session-Nachbereitung",
  "review.sessionFailed": "Session nicht ladbar — Server prüfen und neu laden.",
  "review.noSession": "Es gibt keine Session zum Sichten.",
  "review.backToChapters": "Zurück zu den Kapiteln",
  "review.lead":
    "Die Einträge der Session durchgehen — als Handlungsstrang übernehmen, NPC anlegen oder verwerfen. Der Rest bleibt im Log.",
  // Topbar and the mobile page read the same line (two parameters).
  "review.progress": "{seen} von {total} gesichtet",
  "review.loading": "Lade Einträge …",
  "review.empty": "Keine markierten Einträge in dieser Session — nichts zu sichten.",

  // The card's source chip — the scene travels INSIDE the sentence.
  "review.source.log": "Log",
  "review.source.logScene": "Log · {scene}",
  "review.source.inbox": "Idee",

  "review.action.thread": "Als Handlungsstrang übernehmen",
  "review.action.resolve": "Erledigt",
  "review.action.failed": "Aktion nicht gespeichert — Server prüfen.",
  "review.npc.failed": "NPC nicht angelegt — Server prüfen.",
  "review.npc.exists":
    "Den NPC „{id}“ gibt es schon, deshalb wurde die Notiz nicht übernommen. Wähle eine andere Kennung, zum Beispiel „{suggestion}“.",

  // The done row: the action of THIS sitting, or the neutral fallback after a
  // reload (the server only stores done/not-done).
  "review.done.thread": "Als Handlungsstrang übernommen",
  "review.done.npc": "NPC angelegt",
  "review.done.dismiss": "Verworfen",
  "review.done.resolved": "Erledigt",
  "review.done.seen": "gesichtet",

  // The untagged inbox lines — ideas thrown in on the go.
  "review.notes.title": "Ungetaggte Einträge",
  "review.notes.lead":
    "Einträge aus den Ideen ohne Tag — übernehmen, als NPC anlegen oder abhaken.",

  // Player-character notes: `#pc` lines from the log and the ideas.
  "review.pc.title": "Spielercharaktere",
  "review.pc.lead":
    "Einträge mit #pc — Erinnerungen für den Tisch, kein Kampagneninhalt. Abhaken oder für die nächste Nachbereitung behalten.",
  "review.pc.groupTag": "#{tag}",
  "review.pc.groupGeneral": "Allgemein",
  "review.action.keep": "Behalten",
  "review.action.keepHint": "Bleibt offen für die nächste Nachbereitung.",

  "review.threads.title": "Offene Handlungsstränge des Kapitels",
  "review.threads.empty": "Noch keine offenen Handlungsstränge in diesem Kapitel.",
  "review.threads.new": "neu",
  "review.finish": "Fertig — zurück zu den Kapiteln",

  // --- NPC create dialog of the review (npc/NpcFromNoteDialog.tsx) ----------
  "npcCreate.description":
    "Legt einen neuen NPC mit dem Status „Unbekannt“ an und übernimmt diese Notiz als seinen Text. Ist unter der Kennung schon ein leerer NPC angelegt, bekommt er die Notiz. Hat ein NPC mit dieser Kennung schon Inhalt, wird nichts geschrieben, und die Notiz bleibt offen.",
  "npcCreate.idLabel": "Kennung (steht in der Adresse)",
  "npcCreate.idPlaceholder": "id-des-npcs",
  "npcCreate.idInvalid": "Die Kennung braucht Kleinbuchstaben, Ziffern und einzelne Bindestriche.",
  "npcCreate.nameLabel": "Name (optional)",

  // --- shared verbs: ADD to the existing common block --------------------
  "common.edit": "Bearbeiten",
  // The toggle under a text shown on a few lines (components/ClampedText).
  "common.showMore": "Mehr anzeigen",
  "common.showLess": "Weniger anzeigen",

  // --- mobile start surface (routes/mobile-start.tsx) ----------------------
  "mobileStart.search": "Szenen, NPCs, Orte suchen …",
  "mobileStart.count.scenes": "{count, plural, one {# Szene} other {# Szenen}}",
  "mobileStart.count.npcs": "{count, plural, one {# NPC} other {# NPCs}}",
  "mobileStart.count.locations": "{count, plural, one {# Ort} other {# Orte}}",
  "mobileStart.inbox.label": "Ideen",
  "mobileStart.inbox.placeholder": "Idee einwerfen … #thread #npc",
  "mobileStart.inbox.submit": "Einwerfen",
  "mobileStart.inbox.saved": "Eingeworfen.",
  "mobileStart.inbox.failed": "Nicht gespeichert — Server prüfen.",

  // --- ⌘K search palette (components/CommandPalette.tsx) -------------------
  "palette.title": "Suchen",
  "palette.placeholder": "Szenen, NPCs, Orte durchsuchen …",
  "palette.results.aria": "Suchergebnisse",
  "palette.empty": "Nichts gefunden.",
  // The kind label of a NAVIGATION row: a page of this campaign,
  // not an entry the index found.
  "palette.kind.page": "Seite",

  // --- stale-bundle banner (components/UpdateBanner.tsx) -------------------
  "update.available": "Neue Version verfügbar — neu laden",
  "update.reload": "Neu laden",

  // --- campaign edit dialog (campaign/CampaignEditAction.tsx) --------------
  "campaignEdit.title": "Kampagne bearbeiten",
  "campaignEdit.description":
    "Name, Beschreibung und Text der Kampagne. Die Kapitelübersicht zeigt den Text unter der Beschreibung. Die Kennung der Kampagne bleibt, wie sie ist.",
  "campaignEdit.field.name": "Name",
  "campaignEdit.field.description": "Beschreibung",
  "campaignEdit.field.description.placeholder": "Ein Satz, der die Kampagne einordnet",
  "campaignEdit.field.body": "Text",
  "campaignEdit.field.body.placeholder": "Was für die ganze Kampagne gilt",
  "campaignEdit.unreachable": "Kampagne nicht ladbar — Server prüfen",

  // --- body editor (components/BodyEditor.tsx) ------------------------------
  "bodyEditor.markdown.aria": "Markdown-Text von {path}",
  "bodyEditor.hint": "Nur der Textkörper — die Eigenschaften bleiben unverändert.",
  "bodyEditor.hint.withFields":
    "Textkörper und {fields} — die übrigen Eigenschaften bleiben unverändert.",
  "bodyEditor.blocked": "Ein Block muss noch geklärt werden — siehe Hinweis am Block.",
  "bodyEditor.discard.title": "Änderungen verwerfen?",
  "bodyEditor.discard.description":
    "Die Änderungen sind nicht gespeichert. Verwerfen schließt den Editor und zeigt den Eintrag wieder so, wie er gespeichert ist.",

  // --- entity-kind labels ---------------------------------------------------
  // ONE set for every place a kind is named to the DM: the ⌘K result rows
  // (lib/search.ts) and the title of an entity's dialog.
  // An unknown kind is shown verbatim — the wire value is the truth.
  "kind.scene": "Szene",
  "kind.npc": "NPC",
  "kind.location": "Ort",
  "kind.chapter": "Kapitel",
  "kind.campaign": "Kampagne",
  "kind.session": "Session",
  "kind.glossary": "Glossar",
  // The accessible name of a `[[ref]]` in a body (markdown/entity-refs.tsx):
  // what it points at, then its current name.
  "markdown.ref.aria": "{kind}: {name}",

  // --- generator: input form (routes/generate.tsx, lib/generate.ts) --------
  "generate.input.title.scene": "Szenen generieren",
  "generate.input.title.npc": "NPC generieren",
  "generate.input.lead.scene":
    "Englisches Quellmaterial rein, deutsche Szenen-Entwürfe raus. Immer als Entwurf, immer mit Prüfung — geschrieben wird erst beim Übernehmen.",
  "generate.input.lead.npc":
    "Quellmaterial zu einer Figur rein, ein NPC-Eintrag nach Format raus — Will, Weiß, Beziehungen. Immer mit Prüfung; geschrieben wird erst beim Übernehmen.",
  "generate.input.modeGroup": "Generator-Modus",
  "generate.input.mode.scene": "Szenen",
  "generate.input.mode.npc": "NPC",
  "generate.input.npc.sourceLabel": "Quelltext",
  "generate.input.npc.sourcePlaceholder": "Bio, Hintergrund, Notizen zum NPC …",
  "generate.input.npc.idLabel": "Kennung (optional)",
  "generate.input.npc.idPlaceholder": "z. B. grella",
  "generate.input.npc.idHint": "leer lassen — dann wählt das Modell die Kennung",
  "generate.input.npc.idPreview": "wird angelegt als: npcs/{id}",
  "generate.input.targetLabel": "Ziel-Kapitel",
  "generate.input.newChapter": "Neues Kapitel",
  "generate.input.newTitleLabel": "Kapiteltitel",
  "generate.input.newTitlePlaceholder": "Kapiteltitel, z. B. Die Schmugglerbucht",
  "generate.input.titleMissing": "Titel fehlt — er wird der Anzeigename des neuen Kapitels.",
  "generate.input.chapterIdLabel": "Kapitel-Kennung",
  "generate.input.chapterIdPlaceholder": "z. B. 03-schmugglerbucht",
  "generate.input.chapterIdSuggested": "wird aus dem Titel vorgeschlagen",
  "generate.input.chapterIdPreview": "wird angelegt als: chapters/{id}",
  "generate.input.chapterExists": "Kapitel existiert — Szenen werden dort angelegt",
  "generate.input.sourceLabel": "Quelltext (EN)",
  "generate.input.sourcePlaceholder":
    "Abenteuertext einfügen — Absätze, Boxed Text, Statblock-Verweise …",
  "generate.input.contextLabel": "Mitgeschickter Kontext:",
  // The two counts that come from the tree. The knowledge and the glossary
  // are LINKS to their own pages now, so
  // the view composes the line from three pieces (lib/generate.ts).
  "generate.input.contextEntities":
    "{npcs, plural, one {# NPC} other {# NPCs}} \u00b7 {locations, plural, one {# Ort} other {# Orte}}",
  // The knowledge COUNT — the number is what tells the DM
  // whether the rules they just wrote arrived.
  "generate.input.knowledgeCount":
    "{count, plural, =0 {kein Kampagnenwissen} one {# Wissens-Eintrag} other {# Wissens-Eintr\u00e4ge}}",
  "generate.input.glossary": "Glossar",
  "generate.input.noGlossary": "kein Glossar",
  "generate.input.submit.scene": "Entwürfe generieren",
  "generate.input.submit.npc": "NPC generieren",

  // --- generator: the two id fields' own rules (lib/generate.ts) -----------
  "generate.input.chapterId.missing": "Kapitel-Kennung fehlt.",
  "generate.input.chapterId.slash":
    "Keine Schrägstriche — die Kapitel-Kennung ist ein einzelnes Segment.",
  "generate.input.chapterId.dots": "Kein „..“ in der Kapitel-Kennung.",
  "generate.input.chapterId.leadingDot": "Kein Punkt am Anfang.",
  "generate.input.chapterId.space": "Keine Leerzeichen — Wörter mit Bindestrich trennen.",
  "generate.input.chapterId.charset": "Nur Kleinbuchstaben, Ziffern und Bindestriche.",
  "generate.input.npcId.slash": "Keine Schrägstriche — die Kennung ist ein einzelnes Segment.",
  "generate.input.npcId.space": "Keine Leerzeichen — Wörter mit Bindestrich trennen.",
  "generate.input.npcId.charset":
    "Nur Kleinbuchstaben, Ziffern und Bindestriche; Anfang keine Bindestriche.",
  "generate.input.npcId.exists":
    "NPC existiert schon — bestehende Einträge werden nie überschrieben.",

  // --- generator: the run's own errors (routes/generate.tsx) ---------------
  // The failed JOB's body is rendered by serverErrorBodyMessage (server.*) —
  // these are the app's own sentences about a status.
  "generate.error.treeScene": "Kapitel nicht ladbar — Grimoire-Server auf Port 3000 starten.",
  "generate.error.treeNpc": "Kampagne nicht ladbar — Grimoire-Server auf Port 3000 starten.",
  "generate.error.lostJob":
    "Der Lauf ist nicht mehr vorhanden (Server-Neustart?) — erneut starten.",
  "generate.error.noApiKey": "ANTHROPIC_API_KEY fehlt — siehe server/.env",
  "generate.error.npcExists":
    "NPC existiert schon — andere Kennung wählen; bestehende Einträge werden nie überschrieben.",
  "generate.error.chapterMissing": "Kapitel nicht gefunden — anderes Ziel wählen.",
  "generate.error.failed": "Nicht generiert — Server prüfen.",
  "generate.error.validation":
    "Das Modell hat die Formprüfung nicht bestanden — nichts generiert.",
  "generate.error.unusable":
    "Das Modell hat keine verwertbare Antwort geliefert — nichts generiert.",
  "generate.error.validationHint":
    "Quelltext kürzen oder klarer strukturieren und erneut generieren.",
  "generate.error.rawReply": "Unverarbeitete Antwort anzeigen",

  // --- generator: working state (routes/generate.tsx) ----------------------
  "generate.working.title": "Entwürfe werden generiert …",
  "generate.working.correction":
    "Der Server validiert die Antwort mechanisch; Formfehler gehen automatisch als Korrektur ans Modell zurück.",
  "generate.working.background":
    "Läuft auf dem Server weiter — dieser Tab darf zu. Das Ergebnis wartet hier, bis es übernommen oder verworfen wird.",

  // --- generator: review (routes/generate.tsx, lib/generate.ts) -----------
  "generate.review.title": "Entwürfe prüfen",
  // The NPC run reviews ONE suggested entry, not a set of drafts.
  "generate.review.titleNpc": "Vorschlag prüfen",
  "generate.review.summary":
    "{scenes, plural, one {# Szene} other {# Szenen}} · {stubs, plural, one {# vorgeschlagener Eintrag} other {# vorgeschlagene Einträge}}",
  "generate.review.pending": "{summary} · noch nichts geschrieben",
  "generate.review.pendingNpc": "1 NPC · noch nichts geschrieben",
  "generate.review.lead":
    "Prüfen, anpassen, vorgeschlagene Einträge einzeln entscheiden. Erst „Übernehmen“ schreibt in die Datenbank — als Entwürfe, nie überschreibend.",
  "generate.review.leadNpc":
    "Prüfen und anpassen. Erst „Übernehmen“ schreibt den Eintrag — bestehende NPCs werden nie überschrieben.",
  "generate.review.stubsHeading": "Vorgeschlagene Einträge — einzeln entscheiden",
  // --- naming hints of the post-run check -----------------------------------
  // Deliberately NOT a warning: the check is a plain text search and the DM
  // decides. So the heading counts and the row states the finding plus where
  // it sits — the sentence is built here because the server stays
  // language-free.
  "generate.review.namingHeading":
    "{count, plural, one {# Namens-Hinweis} other {# Namens-Hinweise}} — kein Blocker",
  "generate.review.namingHint": '„{from}“ steht noch da — vereinbart ist „{to}“',
  "generate.review.namingWhereBody": "{path}, Zeile {line}",
  "generate.review.namingWhereField": "{path}, Feld {field}",
  "generate.review.conflicts": "Diese Einträge existieren schon — nichts geschrieben:",
  "generate.review.conflictsNpc": "Dieser Eintrag existiert schon — nichts geschrieben:",
  "generate.review.applyFailed": "Nicht geschrieben — Server prüfen.",
  // A 409 that is not a rev conflict: the run moved on, this part is no
  // longer open or has nothing finished yet. Nothing was written.
  "generate.review.applyStale":
    "Nicht geschrieben — der Lauf hat sich geändert. Die Ansicht wird neu geladen.",
  "generate.review.discardFailed": "Nicht verworfen — Server prüfen.",
  "generate.review.apply": "Übernehmen ({count})",
  "generate.review.applyNpc": "Übernehmen",
  // --- generator: review state on the job ----------------------------------
  // Everything the DM does here is saved on the SERVER — the line says so
  // quietly, and only once something has happened.
  "generate.review.saving": "Speichern …",
  "generate.review.saved": "Gespeichert",
  "generate.review.saveConflict": "In einem anderen Tab geändert — neu geladen.",
  "generate.review.saveFailed": "Nicht gespeichert — Server prüfen.",
  // Partial accepts: how many of how many were taken over (ICU, both halves
  // are numbers).
  "generate.review.progress":
    "{written} von {total} übernommen · der Rest wartet hier",
  "generate.review.acceptOne": "Diesen übernehmen",
  "generate.review.partWritten": "Übernommen",
  "generate.review.drop": "Aus dem Lauf nehmen",
  "generate.review.undrop": "Wieder aufnehmen",
  "generate.review.applyRest": "Rest übernehmen ({count})",
  "generate.review.discardRest": "Rest verwerfen",
  "generate.review.allDecided": "Alles entschieden.",
  "generate.review.plannedScene": "Geplante Szene",
  "generate.review.contingency": "Eventualszene",
  "generate.review.statblock": "Statblock: {statblock}",
  // The draft editor of a review card: the properties in the form of the
  // properties dialog, the body on the surfaces of the entry editor.
  "generate.review.propertiesHeading": "Eigenschaften",
  "generate.review.bodyHeading": "Text",
  "generate.review.bodyLabel": "Text von {path}",
  // A new-chapter run's outline describes the chapter; accepting makes it the
  // chapter's text. Shown read-only above the drafts.
  "generate.review.chapterDescription": "Beschreibung des Kapitels",
  // The run's token spend; the grouping SEPARATOR is locale data, not copy
  // (lib/generate.ts groups by hand — Intl would need full ICU data).
  "generate.usage": "~{tokens} Tokens · {attempts, plural, one {# Versuch} other {# Versuche}}",
  "generate.usage.group": ".",
  // --- generator: the pipeline ---------------------------------------------
  // A run is the outline call plus one call per scene and per entry, so the
  // review fills up while the run is still going. What the DM reads is the
  // PARTS — the outline itself is never shown.
  "generate.pipeline.cost":
    "~{tokens} Tokens · {calls, plural, one {# Aufruf} other {# Aufrufe}}",
  "generate.pipeline.progress":
    "{done} von {total, plural, one {# Szene} other {# Szenen}} fertig",
  // Counted over EVERY part of the run — so the wording says parts rather
  // than scenes as soon as the run has suggested entries next to its scenes.
  "generate.pipeline.progressParts":
    "{done} von {total, plural, one {# Teil} other {# Teilen}} fertig",
  "generate.pipeline.partRunning": "wird geschrieben …",
  "generate.pipeline.partPending": "wartet",
  "generate.pipeline.partFailed": "nicht geschrieben",
  "generate.pipeline.retry": "Erneut versuchen",
  "generate.pipeline.retryFailed": "Nicht neu gestartet — Server prüfen.",
  // The 409 of the retry action: the part is already running or already
  // done (a second tab, a double click) — not a server error.
  "generate.pipeline.retryConflict":
    "Nicht neu gestartet — dieser Teil läuft schon oder ist fertig. Die Ansicht wird neu geladen.",
  // Why a part failed, in this language: the server's validation message is
  // English and would otherwise be the only heading.
  "generate.pipeline.partInvalid":
    "Formprüfung nicht bestanden — die Antwort blieb auch nach den Korrekturversuchen fehlerhaft.",
  "generate.pipeline.partMissing":
    "Als fertig gemeldet, aber ohne Entwurf — versuche diesen Teil erneut.",
  "generate.pipeline.stillRunning":
    "Der Lauf ist noch nicht fertig — was hier steht, kannst du schon übernehmen.",

  // --- generator: proposal rows (routes/generate.tsx) ---------------------
  "generate.stub.reason.run": "aus diesem Lauf",
  "generate.stub.reason.scene": "aus {title}",
  "generate.stub.reason.scenes": "aus {title} u. a.",
  "generate.stub.accept": "Annehmen",
  "generate.stub.reject": "Ablehnen",
  "generate.stub.undo": "Entscheidung zurücknehmen",
  "generate.stub.accepted": "Angenommen",
  "generate.stub.rejected": "Abgelehnt",

  // --- generator: what was written (routes/generate.tsx) ------------------
  "generate.written.title.scene": "Geschrieben — alles als Entwurf",
  "generate.written.title.npc": "Geschrieben — NPC-Eintrag angelegt",
  "generate.written.hint.scene":
    "Die Szenen erscheinen unter ihrem Kapitel mit Status „Entwurf“. Bestehende Einträge werden nie überschrieben — bei Konflikt schreibt der Server nichts.",
  "generate.written.hint.npc":
    "Der NPC erscheint in der NPC-Liste und in der Suche. Bestehende Einträge werden nie überschrieben — bei Konflikt schreibt der Server nichts.",
  "generate.written.openNpc": "NPC ansehen",
  "generate.written.toChapters": "Zu den Kapiteln",

  // --- the markdown format's own vocabulary (markdown/grammar.ts holds the KEY
  //     per callout kind, markdown/Callout.tsx and markdown/Markdown.tsx show
  //     them; lib/blocks.ts names the same blocks in the composer) -----------
  "markdown.callout.readaloud": "Vorlesetext",
  "markdown.callout.check": "Probe",
  "markdown.callout.secret": "Geheim",
  "markdown.callout.outcome": "Ergebnis",
  "markdown.callout.loot": "Beute",
  "markdown.callout.note": "Notiz",
  // The branch label of a `## If:` section — the heading in the TEXT stays
  // `## If:` in every language, only this prefix is copy.
  "markdown.ifSection.prefix": "Falls:",
  "markdown.readaloud.copy": "Kopieren",
  "markdown.readaloud.copied": "Kopiert",
  "markdown.readaloud.copy.aria": "Vorlesetext kopieren",
  "markdown.readaloud.copied.aria": "Vorlesetext kopiert",
  // The scroll container around a table: on a phone the table
  // scrolls, the page never does — and a scrollable box needs a name.
  "markdown.table.aria": "Tabelle",

  // --- the Block-Composer (components/BlockComposer.tsx, lib/blocks.ts,
  //     lib/composer.ts) ----------------------------------------------------
  "composer.mode.aria": "Editiermodus",
  "composer.mode.blocks": "Blöcke",
  "composer.mode.markdown": "Markdown",
  "composer.picker.title": "Block einfügen",
  "composer.picker.cancel.aria": "Einfügen abbrechen",

  // The four structural block names; the six callouts come from markdown.* above.
  "composer.blockType.ifSection": "Falls-Abschnitt",
  "composer.blockType.heading": "Überschrift",
  "composer.blockType.text": "Text",
  "composer.blockType.markdown": "Markdown-Block",

  // ONE key for both states of the level select: a hand-written level outside
  // the offered range reads exactly like an offered one.
  "composer.heading.level": "Ebene {depth}",
  "composer.heading.level.aria": "Ebene der Überschrift",
  "composer.heading.text.aria": "Text der Überschrift",
  "composer.heading.text.placeholder": "Flow",
  "composer.ifSection.condition.aria": "Bedingung des Falls-Abschnitts",
  "composer.ifSection.condition.placeholder": "sie geben zu, für Jorna zu arbeiten",
  "composer.ifSection.hint":
    'Wird als „## If: …“ geschrieben und in der Leseansicht einklappbar.',
  "composer.block.content.aria": "Inhalt: {label}",
  "composer.block.text.placeholder": "Text des Blocks",
  "composer.block.markdown.placeholder": "Markdown",
  "composer.markdown.hint": "Markdown mit Markern — wird unverändert übernommen.",
  "composer.list.aria": "Blöcke: {label}",
  "composer.empty": 'Noch keine Blöcke — mit „+“ den ersten anlegen.',
  // Two whole sentences instead of one glued-in fragment naming the insert
  // target: that word order is not the same in every language.
  "composer.insert.aria": "Block an Position {position} einfügen",
  "composer.insert.section.aria": "Block im Falls-Abschnitt an Position {position} einfügen",
  // Label plus position: it makes the second read-aloud of a scene
  // distinguishable for screen readers and for the E2E suite.
  "composer.card.name": "{label} {position}",
  "composer.card.moveUp.aria": "{name} nach oben",
  "composer.card.moveDown.aria": "{name} nach unten",
  "composer.card.collapse.aria": "{name} zuklappen",
  "composer.card.edit.aria": "{name} bearbeiten",
  "composer.card.delete.aria": "{name} löschen",
  "composer.summary.empty": "leer",
  // What blocks a save, at the offending card (lib/composer.ts) — a HINT with
  // two ways out, never a correction.
  "composer.issue.sectionEscape":
    "»##«-Überschrift beendet den Falls-Abschnitt — tiefer einstufen (###) oder Block nach außen ziehen.",

  // --- the raw-markdown editor (components/MarkdownEditor.tsx) --------------
  // The edit action is labelled by `common.edit`.
  "editor.preview": "Vorschau",

  // --- scene article (components/SceneArticle.tsx) --------------------------
  "sceneArticle.type.planned": "Geplante Szene",
  "sceneArticle.type.contingency": "Eventualszene",
  "sceneArticle.trigger.inline": "Wenn: {trigger}",
  "sceneArticle.trigger.label": "Auslöser",
  "sceneArticle.tag": "#{tag}",
  "sceneArticle.handout": "Handout: {handout}",

  // --- the aside cards (npc/NpcCard.tsx, location/LocationCard.tsx) ---------
  "npcCard.noId": "{id} — keine NPC-Kennung, deshalb kein Eintrag.",
  "npcCard.unloadable": "{id} — NPC nicht ladbar, Server prüfen.",
  "npcCard.will.inline": "Will:",
  "npcCard.will": "Will",
  "npcCard.voice": "Stimme",
  "locationCard.unloadable": "{id} — Ort nicht ladbar, Server prüfen.",
  "locationCard.roll20": "Roll20-Seite: {value}",

  // --- hover preview of a `[[ref]]` (components/EntityPreview.tsx) ---------
  // Everything else it says comes from the shared labels: `kind.*`,
  // `status.*`, `sceneArticle.type.*`, `sceneArticle.trigger.label`,
  // `npcCard.will.inline` and `locationCard.roll20`. Only the scene's
  // location row has a label of its own.
  "refPreview.scene.location": "Ort",

  // --- npc and location reading views (npc/NpcArticle.tsx,
  //     location/LocationArticle.tsx) ------------------------------------------
  "entity.npc.statblock": "Statblock: {value}",
  "entity.location.roll20": "Roll20-Seite: {value}",

  // --- the DEV markdown harness ("/dev/markdown", routes/harness.tsx) -------
  "harness.title": "Markdown-Harness",
  "harness.lead": "Rendert die Referenz-Fixtures aus fixtures/ ohne laufenden Server.",
  "harness.properties": "Eigenschaften anzeigen",

  // --- the augment-with-AI action (components/AugmentAction.tsx) -----------
  "augment.action": "Mit KI ergänzen",
  "augment.title": "Mit KI ergänzen",
  "augment.description":
    "Quelltext und/oder Anweisung — die KI ergänzt {name}. Nichts wird überschrieben, "
    + "bevor du es übernommen hast.",
  "augment.description.running": "Die KI ergänzt {name}.",
  "augment.description.review":
    "Vorschlag für {name} — du entscheidest jede Stelle einzeln.",
  "augment.announce.running": "Der Lauf läuft.",
  "augment.announce.ready": "Der Vorschlag steht bereit.",
  "augment.source.label": "Quelltext (EN)",
  "augment.source.placeholder": "Abschnitt aus dem Abenteuer, Notizen, Hintergrund …",
  "augment.instruction.label": "Anweisung (optional)",
  "augment.instruction.placeholder": "z. B. Führe einen neuen Handlungsstrang ein",
  "augment.input.hint": "Mindestens eines von beidem wird gebraucht.",
  "augment.start": "Ergänzen",
  "augment.starting": "Starte …",
  "augment.start.failed": "Lauf nicht gestartet — Server prüfen.",
  "augment.running": "Läuft auf dem Server. Du kannst den Tab schließen — das Ergebnis bleibt.",
  "augment.busy": "Ein anderer Generator-Lauf läuft gerade. Erst abwarten oder dort verwerfen.",
  "augment.busy.review":
    "Ein anderer Generator-Lauf wartet noch auf Prüfung. Übernimm oder verwirf ihn erst "
    + "im Generator — ein neuer Lauf würde ihn löschen.",
  "augment.discard": "Lauf verwerfen",
  "augment.discard.failed": "Konnte den Lauf nicht verwerfen — Server prüfen.",

  // the review
  "augment.properties.heading": "Eigenschaften",
  "augment.properties.none": "Keine Änderung an den Eigenschaften vorgeschlagen.",
  "augment.field.current": "Vorhanden",
  "augment.field.proposed": "Vorschlag",
  "augment.field.empty": "leer",
  "augment.body.heading": "Text",
  "augment.body.modeGroup": "Ansicht des Vorschlags",
  "augment.body.blocks": "Blöcke",
  "augment.body.markdown": "Markdown",
  "augment.body.none": "Keine Änderung am Text vorgeschlagen.",
  "augment.body.showUnchanged": "Unveränderte Blöcke zeigen",
  "augment.body.hideUnchanged": "Unveränderte Blöcke ausblenden",
  "augment.state.new": "Neu",
  "augment.state.changed": "Geändert",
  "augment.state.removed": "Entfällt",
  "augment.decision.aria": "Übernehmen oder behalten",
  "augment.decision.take": "Übernehmen",
  "augment.decision.keep": "Behalten",
  "augment.decision.takeUnit": "Übernehmen: {label}",
  "augment.decision.keepUnit": "Behalten: {label}",
  "augment.diff.added": "hinzugefügt",
  "augment.diff.removed": "entfernt",
  "augment.diff.changed": "geändert",
  "augment.review.aria": "Vorschlag prüfen",
  "augment.accept": "Übernehmen",
  "augment.reject": "Vorschlag verwerfen",
  "augment.review.namingHeading":
    "{count, plural, one {# Hinweis zur Namenskonvention} other {# Hinweise zur Namenskonvention}} — kein Blocker",
  "augment.review.namingHint": "„{from}“ steht noch da, die Konvention sagt „{to}“.",

} as const;
