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
  "topbar.review.pending": "Nachbereitung · {count} offen",
  // The same link below xl, where the row has no width to spare (issue #69):
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
    'Der Titel wird zur id des Kapitels — sie steht in jeder Szenen-Adresse und bleibt, wie sie ist. Das Ziel ist optional und landet in der Datei unter der Überschrift „## Ziel des Kapitels" — dem Abschnitt, den der Pool liest.',
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
  "rename.error.reserved":
    '„npcs", „locations" und „sessions" sind reservierte Namen.',
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

  // --- settings page (/settings) --------------------------------------------
  "settings.title": "Einstellungen",
  "settings.lead":
    "Einstellungen dieser Grimoire-Instanz. Änderungen gelten sofort und liegen auf dem Server.",
  "settings.language.heading": "Sprache",
  "settings.language.hint": "Sprache der Oberfläche. Gilt für diese Instanz, nicht für die Kampagnendaten.",

  // --- the two campaign-content pages (issue #53) --------------------------
  // „Kampagnenwissen" (/:campaign/knowledge) and „Glossar"
  // (/:campaign/glossary). Campaign CONTENT, like the NPCs and the Orte — the
  // instance settings under /settings are a different thing entirely (PO
  // feedback on PR #87). Shared by both pages: the row controls, the per-entry
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
  // The two actions next to `write.stale`. Reloading is always possible;
  // re-aiming the draft only when the opened entry is still in the list that
  // came back (components/EntryListPage.tsx).
  "entryList.reload": "Neu laden",
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

  // Where the two pages are reached from: the pool's „Nachschlagen" line and
  // the mobile start surface's rows (PO feedback on PR #87 — deliberately NOT
  // the topbar, which stays the three campaign-wide entries it has).
  "lookup.heading": "Nachschlagen",

  // --- server error bodies (code -> sentence, see i18n/server-errors.ts) ----
  "server.slug_taken": '{kind} „{id}" existiert schon — Vorschlag: „{suggestion}"',
  "server.slug_reserved": '„{id}" ist ein reservierter Name — Vorschlag: „{suggestion}"',
  "server.slug_empty": "{field} ergibt keine id — bitte Buchstaben oder Ziffern verwenden.",
  "server.glossary_duplicate_term":
    'Glossar-Begriff „{term}" kommt mehrfach vor — bitte zusammenfassen.',
  "server.session_running": "Eine ältere Session läuft noch — erst beenden.",
  "server.session_not_empty": "Diese Session hat Inhalt — beenden statt verwerfen.",
  "server.rev_conflict": "Inzwischen extern geändert — neu laden vor dem Speichern.",
  "server.job_restarted": "Server wurde während des Laufs neu gestartet — Job neu starten.",
  "server.llm_truncated":
    "Antwort wurde vom Modell abgeschnitten — LLM_MAX_TOKENS erhöhen (aktuell: {max}) oder Quelltext verkleinern.",
  "server.llm_invalid": "Antwort hat die mechanische Prüfung nicht bestanden.",
  "server.llm_truncated.defaultCap": "Standard des Endpoints",

  "server.kind.entry": "Der Eintrag",
  "server.kind.campaign": "Kampagne",
  "server.kind.chapter": "Kapitel",
  "server.kind.scene": "Szene",
  "server.kind.npc": "NPC",
  "server.kind.location": "Ort",
  "server.field.name": "Der Name",
  "server.field.title": "Der Titel",

  // --- status enum labels (lib/scene-status.ts, lib/entity.ts) --------------
  "status.scene.ready": "bereit",
  "status.scene.draft": "Entwurf",
  "status.scene.played": "gespielt",
  "status.scene.dropped": "verworfen",
  "status.npc.alive": "lebendig",
  "status.npc.dead": "tot",
  "status.npc.missing": "vermisst",
  "status.npc.unknown": "unbekannt",

  // --- browse list pages (/:campaign/list/:kind) ---------------------------
  "browse.title.scenes": "Szenen",
  "browse.title.npcs": "NPCs",
  "browse.title.locations": "Orte",

  // --- the shared write layer (lib/write-with-rev.ts, lib/use-rev-write.ts) -
  "write.stale": "Inzwischen geändert — neu laden",
  "write.failed": "Nicht gespeichert — Server prüfen",
  "write.properties.failed": "Eigenschaften nicht gespeichert — Server prüfen",
  "write.status.failed": "Status nicht gespeichert — Server prüfen",
  "status.change.aria": "Status ändern, aktuell {current}",
  "status.sceneUnloadable": "Szene nicht ladbar",

  // --- the scene pool ("/:campaign", routes/pool.tsx) -----------------------
  "pool.loading": "Lade Szenen …",
  "pool.empty":
    "Noch keine Kapitel. Ein Kapitel ist die Klammer um Szenen — danach legst du darin die erste Szene an.",
  // The two counts of the pool header and the chapter accordions. German has
  // one form for both plural categories here — the ICU shape stays, so `en`
  // can differ without a second call site.
  "pool.chapterCount": "{count, plural, one {# Kapitel} other {# Kapitel}}",
  "pool.sceneCount": "{count, plural, =0 {keine Szenen} one {# Szene} other {# Szenen}}",
  "pool.chapter.goal": "Ziel: {goal}",
  "pool.chapter.empty": "Noch keine Szenen in diesem Kapitel.",
  // The chapter pill: only `active` gets a label, every other value degrades
  // to the raw string (README, "Format degradiert").
  "pool.chapter.status.active": "aktiv",
  // The quiet second half of the „Falls es schiefgeht" heading row — the „· "
  // separator stays markup in the JSX.
  "pool.contingencies.hint": "Kontingenzen",
  "pool.scene.trigger": "Wenn: {trigger}",

  // --- browse list pages (routes/browse.tsx) --------------------------------
  // The three list titles are already above under `browse.title.*`.
  "browse.fallbackTitle": "Nachschlagen",
  "browse.unknown": "Diese Liste gibt es nicht.",
  "browse.loading": "Lade …",
  "browse.empty.scenes": "Noch keine Szenen.",
  "browse.empty.npcs": "Noch keine NPCs.",
  "browse.empty.locations": "Noch keine Orte.",

  // --- the reading view ("/:campaign/file/*", routes/scene.tsx) -------------
  "scene.loading": "Lade Eintrag …",
  "scene.notLoadable": "Eintrag nicht ladbar — Pfad prüfen oder Server starten.",
  "scene.npcs.heading": "NPCs dieser Szene",

  // --- context line + mobile back row ---------------------------------------
  "context.aria": "Kontext",
  "mobileBack.pool": "Pool",

  // --- shared scene-group headings (routes/live.tsx + routes/pool.tsx) ------
  // Neutral prefix on purpose: the live nav and the pool list show the SAME
  // two group headings — one key, not one per view.
  "scene.planned.heading": "Geplant",
  "scene.contingencies.heading": "Falls es schiefgeht",

  // --- live mode (routes/live.tsx) ------------------------------------------
  // Below md there is no live mode (UI-BRIEF §4) — just the pointer.
  "live.mobile.note": "Der Live-Modus ist für den Desktop gedacht.",
  "live.mobile.read": "Szene lesen: {title}",

  "live.nav.aria": "Szenen der Session",
  "live.nav.noPlanned": "Keine geplanten Szenen in diesem Kapitel.",
  // The collapsed group of scenes that are behind us (issue #73): the heading
  // alone names the group for a screen reader, `playedGroup` is the visible
  // trigger where the count is PART of the sentence.
  "live.nav.played": "Gespielt",
  "live.nav.playedGroup": "Gespielt {count}",

  "live.scene.none": "Keine Szene im aktiven Kapitel — Szenen im Pool anlegen.",
  "live.scene.loading": "Lade Szene …",
  "live.scene.unloadable": "Szene nicht ladbar — Pfad prüfen.",
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
  // session nobody ended. One sentence per variant — the path is a parameter,
  // never a fragment between two halves.
  "live.session.olderRunning": "Eine ältere Session läuft noch — erst beenden.",
  "live.session.olderRunning.withPath": "Eine ältere Session läuft noch ({path}) — erst beenden.",
  "live.session.endOld": "Alte Session beenden",

  // The „Für die Spieler" reminder list of the aside (issue #86).
  "live.pc.heading": "Für die Spieler",
  "live.pc.done": "„{text}“ erledigt",
  "live.pc.failed": "Nicht gespeichert — Server prüfen.",

  // --- live detail drawer (components/LiveEntityDrawer.tsx) -----------------
  "live.drawer.loading": "Lade Details …",
  "live.drawer.unloadable": "Nicht ladbar — {path} prüfen.",
  "live.drawer.open": "Eintrag öffnen",

  // --- review (the session wrap-up, formerly "Fünf Minuten Ernte" — issue
  // #10; the "Ernte"/harvest metaphor stayed in the code, not in the UI)
  // routes/review.tsx, lib/use-review.ts ------------------------------------
  "review.title": "Session-Nachbereitung",
  "review.sessionFailed": "Session nicht ladbar — Server prüfen und neu laden.",
  "review.noSession": "Es gibt keine Session zum Sichten.",
  "review.backToPool": "Zurück zum Pool",
  "review.lead":
    "Notizen der Session durchgehen — als Handlungsstrang übernehmen, NPC anlegen oder verwerfen. Der Rest bleibt im Log.",
  // Topbar and the mobile page read the same line (two parameters, #69).
  "review.progress": "{seen} von {total} gesichtet",
  "review.hashUnavailable":
    "Gesichtet-Status der Log-Zeilen nicht verfügbar — Grimoire über localhost oder https öffnen.",
  "review.loading": "Lade Einträge …",
  "review.empty": "Keine markierten Einträge in dieser Session — nichts zu sichten.",

  // The card's source chip — the scene travels INSIDE the sentence.
  "review.source.log": "Log",
  "review.source.logScene": "Log · {scene}",
  "review.source.inbox": "Inbox",

  "review.action.thread": "Als Handlungsstrang übernehmen",
  "review.action.resolve": "Erledigt",
  "review.action.failed": "Aktion nicht gespeichert — Server prüfen.",
  "review.npc.failed": "NPC nicht angelegt — Server prüfen.",

  // The done row: the action of THIS sitting, or the neutral fallback after a
  // reload (the server only stores done/not-done).
  "review.done.thread": "Als Handlungsstrang übernommen",
  "review.done.npc": "NPC angelegt",
  "review.done.dismiss": "Verworfen",
  "review.done.resolved": "Erledigt",
  "review.done.seen": "gesichtet",

  // The untagged inbox lines (issue #85) — ideas thrown in on the go.
  "review.notes.title": "Notizen",
  "review.notes.lead":
    "Ungetaggte Einträge aus der Inbox — übernehmen, als NPC anlegen oder abhaken.",

  // Player-character notes (issue #86): `#pc` lines from log and inbox.
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
  "review.finish": "Fertig — zurück zum Pool",

  // --- NPC stub dialog of the review (components/NpcCreateDialog.tsx) -------
  // `status: unknown` and `## Notizen` are FORMAT tokens on the wire (README),
  // so they stand verbatim in both languages.
  "npcCreate.description":
    "Legt den NPC-Eintrag mit status: unknown an; der Text landet unter ## Notizen. Gibt es die id schon, wird auf den bestehenden Eintrag verwiesen.",
  "npcCreate.idLabel": "id (steht im Pfad)",
  "npcCreate.idPlaceholder": "id-des-npcs",
  "npcCreate.nameLabel": "Name (optional)",

  // --- shared verbs: ADD to the existing common block --------------------
  "common.edit": "Bearbeiten",

  // --- mobile start surface (routes/mobile-start.tsx) ----------------------
  "mobileStart.search": "Szenen, NPCs, Orte suchen …",
  "mobileStart.count.scenes": "{count, plural, one {# Szene} other {# Szenen}}",
  "mobileStart.count.npcs": "{count, plural, one {# NPC} other {# NPCs}}",
  "mobileStart.count.locations": "{count, plural, one {# Ort} other {# Orte}}",
  "mobileStart.inbox.label": "Inbox",
  "mobileStart.inbox.placeholder": "Inbox — Idee einwerfen … #thread #npc",
  "mobileStart.inbox.submit": "Einwerfen",
  "mobileStart.inbox.saved": "Eingeworfen.",
  "mobileStart.inbox.failed": "Nicht gespeichert — Server prüfen.",

  // --- ⌘K search palette (components/CommandPalette.tsx) -------------------
  "palette.title": "Suchen",
  "palette.placeholder": "Szenen, NPCs, Orte durchsuchen …",
  "palette.results.aria": "Suchergebnisse",
  "palette.empty": "Nichts gefunden.",
  // The kind label of a NAVIGATION row (issue #53): a page of this campaign,
  // not a document the index found.
  "palette.kind.page": "Seite",

  // --- stale-bundle banner (components/UpdateBanner.tsx) -------------------
  "update.available": "Neue Version verfügbar — neu laden",
  "update.reload": "Neu laden",

  // --- campaign metadata dialog (components/CampaignMetaAction.tsx) --------
  "campaignMeta.title": "Kampagne bearbeiten",
  "campaignMeta.description":
    "Name und Beschreibung stehen in _campaign. Die id bleibt, wie sie ist — sie steckt in jeder Adresse und ändert sich hier nicht.",
  "campaignMeta.field.name": "Name",
  "campaignMeta.field.description": "Beschreibung",
  "campaignMeta.field.description.placeholder": "Ein Satz, der die Kampagne einordnet",
  "campaignMeta.unreachable": "Kampagne nicht ladbar — Server prüfen",

  // --- body editor (components/FileBodyEditor.tsx) -------------------------
  "bodyEditor.raw.aria": "Markdown-Text von {path}",
  "bodyEditor.hint": "Nur der Textkörper — die Eigenschaften bleiben unverändert.",
  "bodyEditor.blocked": "Ein Block muss noch geklärt werden — siehe Hinweis am Block.",
  "bodyEditor.discard.title": "Änderungen verwerfen?",
  "bodyEditor.discard.description":
    "Die Änderungen sind nicht gespeichert. Verwerfen schließt den Editor und zeigt den Eintrag wieder so, wie er gespeichert ist.",

  // --- entity-kind labels ---------------------------------------------------
  // ONE set for every place a kind is named to the DM: the ⌘K result rows
  // (lib/search.ts) and the properties dialog's title (lib/properties-form.ts).
  // An unknown kind is shown verbatim — the wire value is the truth.
  "kind.scene": "Szene",
  "kind.npc": "NPC",
  "kind.location": "Ort",
  "kind.chapter": "Kapitel",
  "kind.campaign": "Kampagne",
  // The accessible name of a `[[ref]]` in a body (markdown/entity-refs.tsx):
  // what it points at, then its current name.
  "markdown.ref.aria": "{kind}: {name}",

  // --- generator: input form (routes/generate.tsx, lib/generate.ts) --------
  "generate.input.title.scene": "Szenen generieren",
  "generate.input.title.npc": "NPC generieren",
  "generate.input.lead.scene":
    "Englisches Quellmaterial rein, deutsche Szenen-Drafts raus. Immer status draft, immer mit Review — geschrieben wird erst beim Übernehmen.",
  "generate.input.lead.npc":
    "Quellmaterial zu einer Figur rein, ein NPC-Eintrag nach Format raus — Will, Weiß, Beziehungen. Immer mit Review; geschrieben wird erst beim Übernehmen.",
  "generate.input.modeGroup": "Generator-Modus",
  "generate.input.mode.scene": "Szenen",
  "generate.input.mode.npc": "NPC",
  "generate.input.npc.sourceLabel": "Quelltext",
  "generate.input.npc.sourcePlaceholder": "Bio, Hintergrund, Notizen zum NPC …",
  "generate.input.npc.idLabel": "id (optional)",
  "generate.input.npc.idPlaceholder": "z. B. grella",
  "generate.input.npc.idHint": "leer lassen — dann wählt das Modell die id",
  "generate.input.npc.idPreview": "wird angelegt als: npcs/{id}",
  "generate.input.targetLabel": "Ziel-Kapitel",
  "generate.input.newChapter": "Neues Kapitel",
  "generate.input.newTitleLabel": "Kapiteltitel",
  "generate.input.newTitlePlaceholder": "Kapiteltitel, z. B. Die Schmugglerbucht",
  "generate.input.titleMissing": "Titel fehlt — er wird der Anzeigename des neuen Kapitels.",
  "generate.input.chapterIdLabel": "Kapitel-id",
  "generate.input.chapterIdPlaceholder": "z. B. 03-schmugglerbucht",
  "generate.input.chapterIdSuggested": "wird aus dem Titel vorgeschlagen",
  "generate.input.chapterIdPreview": "wird angelegt als: {id}/",
  "generate.input.chapterExists": "Kapitel existiert — Szenen werden dort angelegt",
  "generate.input.sourceLabel": "Quelltext (EN)",
  "generate.input.sourcePlaceholder":
    "Abenteuertext einfügen — Absätze, Boxed Text, Statblock-Verweise …",
  "generate.input.contextLabel": "Mitgeschickter Kontext:",
  // The two counts that come from the tree. The knowledge and the glossary
  // are LINKS to their own pages now (issue #53, PO feedback on PR #87), so
  // the view composes the line from three pieces (lib/generate.ts).
  "generate.input.contextEntities":
    "{npcs, plural, one {# NPC} other {# NPCs}} \u00b7 {locations, plural, one {# Ort} other {# Orte}}",
  // The knowledge COUNT (issue #53 AK5) — the number is what tells the DM
  // whether the rules they just wrote arrived.
  "generate.input.knowledgeCount":
    "{count, plural, =0 {kein Kampagnenwissen} one {# Wissens-Eintrag} other {# Wissens-Eintr\u00e4ge}}",
  "generate.input.glossary": "Glossar",
  "generate.input.noGlossary": "kein Glossar",
  "generate.input.submit.scene": "Entwürfe generieren",
  "generate.input.submit.npc": "NPC generieren",

  // --- generator: the two id fields' own rules (lib/generate.ts) -----------
  "generate.input.chapterId.missing": "Kapitel-id fehlt.",
  "generate.input.chapterId.slash":
    "Keine Schrägstriche — die Kapitel-id ist ein einzelnes Segment.",
  "generate.input.chapterId.dots": "Kein „..“ in der Kapitel-id.",
  "generate.input.chapterId.leadingDot": "Kein Punkt am Anfang.",
  "generate.input.chapterId.space": "Keine Leerzeichen — Wörter mit Bindestrich trennen.",
  "generate.input.chapterId.charset": "Nur Kleinbuchstaben, Ziffern und Bindestriche.",
  "generate.input.chapterId.reserved":
    '„npcs", „locations" und „sessions" sind reserviert — kein Kapitelname.',
  "generate.input.npcId.slash": "Keine Schrägstriche — die id ist ein einzelnes Segment.",
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
    "Der Generierungs-Job ist nicht mehr vorhanden (Server-Neustart?) — erneut starten.",
  "generate.error.noApiKey": "ANTHROPIC_API_KEY fehlt — siehe server/.env",
  "generate.error.npcExists":
    "NPC existiert schon — andere id wählen; bestehende Einträge werden nie überschrieben.",
  "generate.error.chapterMissing": "Kapitel nicht gefunden — anderes Ziel wählen.",
  "generate.error.failed": "Nicht generiert — Server prüfen.",
  "generate.error.validation":
    "Das Modell hat die Formprüfung nicht bestanden — nichts generiert.",
  "generate.error.unusable":
    "Das Modell hat keine verwertbare Antwort geliefert — nichts generiert.",
  "generate.error.validationHint":
    "Quelltext kürzen oder klarer strukturieren und erneut generieren.",
  "generate.error.rawReply": "Rohantwort anzeigen",

  // --- generator: working state (routes/generate.tsx) ----------------------
  "generate.working.title": "Drafts werden generiert …",
  "generate.working.correction":
    "Der Server validiert die Antwort mechanisch; Formfehler gehen automatisch als Korrektur ans Modell zurück.",
  "generate.working.background":
    "Läuft auf dem Server weiter — dieser Tab darf zu. Das Ergebnis wartet hier, bis es übernommen oder verworfen wird.",

  // --- generator: review (routes/generate.tsx, lib/generate.ts) -----------
  "generate.review.title": "Review",
  "generate.review.summary":
    "{scenes, plural, one {# Szene} other {# Szenen}} · {stubs, plural, one {# Stub} other {# Stubs}}",
  "generate.review.pending": "{summary} · noch nichts geschrieben",
  "generate.review.pendingNpc": "1 NPC · noch nichts geschrieben",
  "generate.review.lead":
    "Prüfen, anpassen, Stubs einzeln entscheiden. Erst „Übernehmen“ schreibt in die Datenbank — als Drafts, nie überschreibend.",
  "generate.review.leadNpc":
    "Prüfen und anpassen. Erst „Übernehmen“ schreibt den Eintrag — bestehende NPCs werden nie überschrieben.",
  "generate.review.stubsHeading": "Stubs — einzeln entscheiden",
  // --- naming hints of the post-run check (issue #53 AK3) -------------------
  // Deliberately NOT a warning: the check is a plain text search and the DM
  // decides. So the heading counts and the row states the finding plus where
  // it sits — the sentence is built here because the server stays
  // language-free (#69).
  "generate.review.namingHeading":
    "{count, plural, one {# Namens-Hinweis} other {# Namens-Hinweise}} — kein Blocker",
  "generate.review.namingHint": '„{from}" steht noch da — vereinbart ist „{to}"',
  "generate.review.namingWhereBody": "{path}, Zeile {line}",
  "generate.review.namingWhereField": "{path}, Feld {field}",
  "generate.review.conflicts": "Diese Einträge existieren schon — nichts geschrieben:",
  "generate.review.conflictsNpc": "Dieser Eintrag existiert schon — nichts geschrieben:",
  "generate.review.applyFailed": "Nicht geschrieben — Server prüfen.",
  "generate.review.discardFailed": "Nicht verworfen — Server prüfen.",
  "generate.review.apply": "Übernehmen ({count})",
  "generate.review.applyNpc": "Übernehmen",
  "generate.review.plannedScene": "Geplante Szene",
  "generate.review.contingency": "Kontingenz",
  "generate.review.statblock": "Statblock: {statblock}",
  "generate.review.rawLabel": "Roh-Markdown von {title}",
  // The run's token spend; the grouping SEPARATOR is locale data, not copy
  // (lib/generate.ts groups by hand — Intl would need full ICU data).
  "generate.usage": "~{tokens} Tokens · {attempts, plural, one {# Versuch} other {# Versuche}}",
  "generate.usage.group": ".",

  // --- generator: stub rows (routes/generate.tsx) -------------------------
  "generate.stub.reason.run": "aus diesem Lauf",
  "generate.stub.reason.scene": "aus {title}",
  "generate.stub.reason.scenes": "aus {title} u. a.",
  "generate.stub.accept": "Annehmen",
  "generate.stub.reject": "Ablehnen",
  "generate.stub.undo": "Entscheidung zurücknehmen",
  "generate.stub.accepted": "Angenommen",
  "generate.stub.rejected": "Abgelehnt",

  // --- generator: what was written (routes/generate.tsx) ------------------
  "generate.written.title.scene": "Geschrieben — alles als draft",
  "generate.written.title.npc": "Geschrieben — NPC-Eintrag angelegt",
  "generate.written.hint.scene":
    "Die Szenen erscheinen im Pool mit Status „Entwurf“. Bestehende Einträge werden nie überschrieben — bei Konflikt schreibt der Server nichts.",
  "generate.written.hint.npc":
    "Der NPC erscheint in der NPC-Liste und in der Suche. Bestehende Einträge werden nie überschrieben — bei Konflikt schreibt der Server nichts.",
  "generate.written.openNpc": "NPC ansehen",
  "generate.written.toPool": "Zum Pool",

  // --- the markdown format's own vocabulary (markdown/grammar.ts holds the KEY
  //     per callout kind, markdown/Callout.tsx and markdown/Markdown.tsx show
  //     them; lib/blocks.ts names the same blocks in the composer) -----------
  "markdown.callout.readaloud": "Vorlesetext",
  "markdown.callout.check": "Check",
  "markdown.callout.secret": "Geheim",
  "markdown.callout.outcome": "Konsequenz",
  "markdown.callout.loot": "Beute",
  "markdown.callout.note": "Notiz",
  // The branch label of a `## If:` section — the heading in the FILE stays
  // `## If:` in every language, only this prefix is copy.
  "markdown.ifSection.prefix": "Falls:",
  "markdown.readaloud.copy": "Kopieren",
  "markdown.readaloud.copied": "Kopiert",
  "markdown.readaloud.copy.aria": "Vorlesetext kopieren",
  "markdown.readaloud.copied.aria": "Vorlesetext kopiert",

  // --- the Block-Composer (components/BlockComposer.tsx, lib/blocks.ts,
  //     lib/composer.ts) ----------------------------------------------------
  "composer.mode.aria": "Editiermodus",
  "composer.mode.blocks": "Blöcke",
  "composer.mode.raw": "Roh",
  "composer.picker.title": "Block einfügen",
  "composer.picker.cancel.aria": "Einfügen abbrechen",

  // The four structural block names; the six callouts come from markdown.* above.
  "composer.blockType.ifSection": "Falls-Abschnitt",
  "composer.blockType.heading": "Überschrift",
  "composer.blockType.text": "Text",
  "composer.blockType.raw": "Roh-Block",

  // ONE key for both states of the level select: a hand-written level outside
  // the offered range reads exactly like an offered one.
  "composer.heading.level": "Ebene {depth}",
  "composer.heading.level.aria": "Ebene der Überschrift",
  "composer.heading.text.aria": "Text der Überschrift",
  "composer.heading.text.placeholder": "Flow",
  "composer.ifSection.condition.aria": "Bedingung des Falls-Abschnitts",
  "composer.ifSection.condition.placeholder": "sie geben zu, für Jorna zu arbeiten",
  "composer.ifSection.hint":
    'Wird als „## If: …" geschrieben und in der Leseansicht einklappbar.',
  "composer.block.content.aria": "Inhalt: {label}",
  "composer.block.text.placeholder": "Text des Blocks",
  "composer.block.raw.placeholder": "Markdown",
  "composer.raw.hint": "Roh-Markdown mit Markern — wird unverändert übernommen.",
  "composer.list.aria": "Blöcke: {label}",
  "composer.empty": 'Noch keine Blöcke — mit „+" den ersten anlegen.',
  // Two whole sentences instead of a glued-in fragment („… im Falls-Abschnitt"):
  // the word order of the insert target is not the same in every language.
  "composer.insert.aria": "Block an Position {position} einfügen",
  "composer.insert.section.aria": "Block im Falls-Abschnitt an Position {position} einfügen",
  // „Vorlesetext 2" — the position makes the second read-aloud of a scene
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
  // „Bearbeiten" is `common.edit`.
  "editor.preview": "Vorschau",

  // --- scene article (components/SceneArticle.tsx) --------------------------
  "sceneArticle.type.planned": "Geplante Szene",
  "sceneArticle.type.contingency": "Kontingenz",
  "sceneArticle.trigger.inline": "Wenn: {trigger}",
  "sceneArticle.trigger.label": "Auslöser",
  "sceneArticle.tag": "#{tag}",
  "sceneArticle.handout": "Handout: {handout}",

  // --- the aside cards (components/NpcCard.tsx, components/LocationCard.tsx) -
  "npcCard.noId": "{id} — keine NPC-id, deshalb kein Eintrag.",
  "npcCard.unloadable": "{id} — NPC nicht ladbar, Server prüfen.",
  "npcCard.will.inline": "Will:",
  "npcCard.will": "Will",
  "npcCard.voice": "Stimme",
  "locationCard.unloadable": "{id} — Ort nicht ladbar, Server prüfen.",
  "locationCard.roll20": "Roll20-Seite: {value}",

  // --- entity reading view (components/EntityArticle.tsx) -------------------
  "entity.npc.statblock": "Statblock: {value}",
  "entity.location.roll20": "Roll20-Seite: {value}",

  // --- the DEV markdown harness ("/dev/markdown", routes/harness.tsx) -------
  "harness.title": "Markdown-Harness",
  "harness.lead": "Rendert die Referenz-Fixtures aus examples/ ohne laufenden Server.",
  "harness.properties": "Eigenschaften anzeigen",
} as const;
