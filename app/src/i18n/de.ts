// THE German catalog — and the source of truth for the KEY SET.
//
// `MessageKey` is derived from this object (messages.ts), so every other
// language is a `Record<MessageKey, string>`: a key that is missing in `en.ts`
// — or one that exists only there — is a TYPE ERROR, not a runtime surprise.
// That is the whole reason the catalogs are TS objects instead of JSON.
//
// Values are ICU MessageFormat (decisions/i18n): `{name}` interpolates, `{count,
// plural, one {…} other {…}}` picks the form, `#` is the number itself.
// A literal brace in copy has to be quoted as `'{'` — there is none here.
//
// The German strings are the ones the components show; their typographic
// detail is part of the design (curly quotation marks, the em dash with
// spaces, the single ellipsis character). Do not normalize them.
//
// The catalog covers the topbar incl. session chip, campaign menu, the
// five create dialogs, the fields of the edit modes, cold start and the areas
// listed in the sections below. A component not covered here still carries
// its literal strings.

export const de = {
  // --- shared verbs ---------------------------------------------------------
  "common.close": "Schließen",
  "common.cancel": "Abbrechen",
  "common.discard": "Verwerfen",
  "common.save": "Speichern",
  "common.saving": "Speichere …",
  "common.create": "Anlegen",
  "common.creating": "Lege an …",
  "common.serverDown":
    "Server nicht erreichbar — Grimoire-Server auf Port 3000 starten.",

  // --- not-found view (components/NotFound.tsx) -----------------------------
  "notFound.title": "Diese Seite gibt es nicht",
  "notFound.body":
    "Unter dieser Adresse liegt nichts. Vielleicht ist der Link vertippt, oder das Verlinkte wurde gelöscht.",
  "notFound.toCampaign": "Zur Kapitelübersicht",
  "notFound.toStart": "Zum Anfang",

  // --- language switch (components/LanguageSwitch.tsx) ----------------------
  "language.heading": "Sprache",
  "language.de": "Deutsch",
  "language.en": "English",

  // --- topbar ---------------------------------------------------------------
  "topbar.brand": "Grimoire",
  "topbar.search": "Suchen …",
  "topbar.generator": "Generator",
  // The campaign's generator job in one sentence — what it is about and
  // where it stands (topbar, generator page).
  "generatorJob.scene.running": "Die KI schreibt gerade Szenen.",
  "generatorJob.scene.ready": "Die vorgeschlagenen Szenen warten auf deine Prüfung.",
  "generatorJob.scene.failed": "Der Lauf für neue Szenen ist fehlgeschlagen.",
  "generatorJob.npc.running": "Die KI schreibt gerade einen NPC.",
  "generatorJob.npc.ready": "Der vorgeschlagene NPC wartet auf deine Prüfung.",
  "generatorJob.npc.failed": "Der Lauf für einen neuen NPC ist fehlgeschlagen.",
  "generatorJob.augment.running": "Die KI ergänzt gerade {name}.",
  "generatorJob.augment.ready": "Der Vorschlag für {name} wartet auf deine Prüfung.",
  "generatorJob.augment.failed": "Die Ergänzung von {name} ist fehlgeschlagen.",
  // What the model and Grimoire itself noted about one proposal — under its
  // card's header — and about the whole run, above the stages
  // (generator-job/PartNotes.tsx). From three on a list starts folded, and
  // its summary counts both.
  "generatorJob.notes.label": "Hinweise des Modells",
  "generatorJob.notes.summary":
    "{count, plural, one {# Hinweis} other {# Hinweise}} zu diesem Vorschlag",
  "generatorJob.runNotes.summary":
    "{count, plural, one {# Hinweis zum ganzen Lauf} other {# Hinweise zum ganzen Lauf}}",
  // What Grimoire itself noted about a reply — no model note, so nobody
  // answers it. {title} is the scene's title.
  "generatorJob.serverNotes.label": "Hinweise von Grimoire",
  "generatorJob.serverNote.reply_repaired":
    "Die Antwort des Modells zu diesem Vorschlag war kein gültiges JSON und wurde repariert, bevor sie gelesen wurde.",
  "generatorJob.serverNote.source_excerpt_unmatched":
    "Der Quelltext-Ausschnitt für „{title}“ ließ sich nicht wörtlich zuordnen, deshalb wurde diese Szene aus dem ganzen Quelltext geschrieben.",
  "generatorJob.runServerNote.reply_repaired":
    "Die Gliederung des Modells war kein gültiges JSON und wurde repariert, bevor sie gelesen wurde.",
  // The patch round of one proposal (generator-job/PartRound.tsx): the DM
  // answers the model's notes (and may keep an answer as campaign knowledge),
  // the model changes the proposal, and the DM takes or discards each change.
  "generatorJob.round.answer": "Deine Antwort auf diesen Hinweis",
  "generatorJob.round.answerPlaceholder": "Antworte, wenn der Hinweis etwas am Vorschlag ändern soll",
  "generatorJob.round.keepAsKnowledge":
    "Diese Antwort als Kampagnenwissen behalten, damit auch jeder weitere Lauf sie kennt.",
  "generatorJob.round.send": "Antworten senden",
  "generatorJob.round.sending": "Wird gesendet …",
  "generatorJob.round.running": "Das Modell arbeitet deine Antworten gerade in diesen Vorschlag ein.",
  "generatorJob.round.failed":
    "Das Modell konnte deine Antworten nicht einarbeiten, der Vorschlag ist unverändert. Sende die Antworten noch einmal.",
  "generatorJob.round.changes":
    "{count, plural, one {Eine Änderung aus deinen Antworten wartet auf deine Entscheidung.} other {# Änderungen aus deinen Antworten warten auf deine Entscheidung.}}",
  "generatorJob.round.conflict":
    "Der Lauf wurde inzwischen anderswo geändert. Er ist neu geladen — sieh ihn dir an und entscheide noch einmal.",
  "generatorJob.round.sendFailed": "Die Antworten konnten nicht gesendet werden. Versuche es noch einmal.",
  "generatorJob.round.decideFailed": "Die Entscheidung konnte nicht gespeichert werden. Versuche es noch einmal.",
  // What the server could not apply of a patch round, one whole sentence per
  // finding; {anchor} is the block the change named, on one line.
  "generatorJob.finding.unreadable":
    "Eine Änderung des Modells ließ sich nicht lesen und wurde nicht übernommen.",
  "generatorJob.finding.anchor_missing":
    "Eine Änderung wurde nicht übernommen, weil dieser Block nicht im Text steht: „{anchor}“",
  "generatorJob.finding.anchor_ambiguous":
    "Eine Änderung wurde nicht übernommen, weil dieser Block mehrmals im Text steht: „{anchor}“",
  "generatorJob.finding.text_empty":
    "Eine Änderung am Block „{anchor}“ wurde nicht übernommen, weil sie keinen Text mitbrachte.",
  "generatorJob.finding.callouts_unknown":
    "Eine Änderung am Block „{anchor}“ wurde nicht übernommen, weil sie Callouts nennt, die es nicht gibt: {callouts}.",
  "generatorJob.finding.refs_unknown":
    "Eine Änderung am Block „{anchor}“ wurde nicht übernommen, weil sie auf etwas verweist, das es weder in der Kampagne noch in diesem Lauf gibt: {ids}.",
  "generatorJob.finding.field_unknown":
    "Eine Änderung wurde nicht übernommen, weil der Vorschlag kein Feld „{field}“ hat.",
  "generatorJob.finding.field_empty":
    "Der neue Wert für {field} wurde nicht übernommen, weil das Feld nicht leer sein darf.",
  "generatorJob.finding.field_invalid":
    "Der neue Wert für {field} wurde nicht übernommen, weil er nicht in dieses Feld passt.",
  "generatorJob.finding.chapter_outside":
    "Eine Änderung wurde nicht übernommen, weil die Szene im Kapitel „{chapter}“ dieses Laufs bleibt.",
  "generatorJob.finding.ids_unknown":
    "Der neue Wert für {field} wurde nicht übernommen, weil er etwas nennt, das es weder in der Kampagne noch in diesem Lauf gibt: {ids}.",
  // A naming hint where it sits: at the field it names, at the block its line
  // is in, or — where the card shows neither — in the card, naming the text.
  // Never a blocker: the check is a plain text search, the DM decides. The
  // sentence is built here because the server stays language-free.
  "generatorJob.hint.field": "Im Feld „{field}“ steht noch „{from}“ — die Namenskonvention sagt „{to}“.",
  "generatorJob.hint.block": "In diesem Block steht noch „{from}“ — die Namenskonvention sagt „{to}“.",
  "generatorJob.hint.text": "Im Text steht noch „{from}“ — die Namenskonvention sagt „{to}“.",
  "generatorJob.hint.proposal":
    "Der Vorschlag schreibt noch „{from}“ — die Namenskonvention sagt „{to}“.",
  "topbar.generator.progress": "{written} von {total} übernommen",
  "topbar.session.back": "Zur Session",

  // --- campaign menu (components/CampaignMenu.tsx) ---------------------------
  // The trigger's accessible name; on a view with no area it names only the
  // campaign.
  "campaignMenu.trigger": "Kampagne: {name}",
  "campaignMenu.triggerInArea": "Kampagne: {name}, Bereich: {area}",
  "campaignMenu.title": "Kampagnenmenü",
  "campaignMenu.campaigns": "Kampagnen",
  "campaignMenu.empty": "Noch keine Kampagnen gefunden.",
  "campaignMenu.group.prepare": "Vorbereiten",
  "campaignMenu.group.lookUp": "Nachschlagen",
  "campaignMenu.group.tidyUp": "Aufräumen",
  // What the session review still has to go through, beside its entry.
  "campaignMenu.reviewPending": "{count} offen",
  // The areas of a campaign (lib/areas.ts), in the menu and in ⌘K.
  "area.chapters": "Kapitel",
  "area.scenes": "Szenen",
  "area.npcs": "NPCs",
  "area.locations": "Orte",
  "area.glossary": "Glossar",
  "area.knowledge": "Kampagnenwissen",
  "area.itemPrices": "Gegenstandspreise",
  "area.review": "Nachbereitung",
  "area.trash": "Papierkorb",

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
  "session.page.scenes": "Szenen mit Notizen",
  "session.page.scenes.empty": "In dieser Session wurde in keiner Szene notiert.",

  // --- create dialogs -------------------------------------------------------
  "create.failed": "Nicht angelegt — Server prüfen.",
  "create.useSuggestion": '„{id}“ verwenden',

  "create.campaign.title": "Kampagne anlegen",
  "create.campaign.nameLabel": "Name der Kampagne",
  "create.campaign.namePlaceholder": "Name der Kampagne",
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
    "Nur der Name — Rolle, Status und alles Weitere trägst du danach beim Bearbeiten des NPCs ein.",
  "create.npc.nameLabel": "Name",
  "create.npc.namePlaceholder": "Name des NPCs",

  "create.location.title": "Ort anlegen",
  "create.location.description":
    "Nur der Name — alles Weitere trägst du danach beim Bearbeiten des Orts ein.",
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

  // --- the fields of the edit modes ------------------------------------------
  "properties.id": "Kennung",
  "properties.discard.title": "Änderungen verwerfen?",
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

  // Field labels/hints/placeholders — a scene's (scene/SceneFields.tsx), an
  // npc's (npc/NpcFields.tsx), a location's (location/LocationEditMode.tsx)
  // and the status labels of a chapter (chapter/chapter-status.ts)
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
  "properties.scene.npcs.hint": "Nur Kennungen — den NPC muss es schon geben.",
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

  "properties.chapter.status.planned": "Geplant",
  "properties.chapter.status.active": "Aktiv",
  "properties.chapter.status.done": "Abgeschlossen",

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
  // Shared by both pages (components/EditableList.tsx): the row controls,
  // the save outcome of one row, the delete confirmation. A conflict line
  // uses the shared `editConflict.*` sentences.
  "editableList.loading": "Lade Liste …",
  "editableList.loadFailed": "Liste nicht geladen — Seite neu laden.",
  "editableList.saveFailed": "Nicht gespeichert.",
  "editableList.saving": "Speichere …",
  "editableList.saved": "Gespeichert",
  "editableList.moveUp": "Nach oben",
  "editableList.moveDown": "Nach unten",
  "editableList.edit": "„{name}“ bearbeiten",
  "editableList.remove": "„{name}“ löschen",
  "editableList.removed": "Gelöscht",
  "editableList.confirmDelete.title": "„{name}“ löschen?",
  "editableList.confirmDelete.body": "Das lässt sich nicht rückgängig machen.",
  "editableList.confirmDelete.confirm": "Löschen",

  "knowledge.title": "Kampagnenwissen",
  "knowledge.lead":
    "Namenskonventionen, Fakten und Stilregeln dieser Kampagne. Geht bei jedem Generator-Lauf mit und gilt verbindlich — auch wenn das Quellmaterial etwas anderes sagt. Die Reihenfolge ist die Reihenfolge im Prompt. Referenzen wie [[fenn]] werden zum Namen aufgelöst.",
  "knowledge.filter": "Wissen filtern",
  "knowledge.empty":
    "Noch kein Kampagnenwissen. Fang mit einer Namenskonvention, einer Tatsache oder einer Stilregel an.",
  "knowledge.noMatch": "Nichts passt zum Filter.",
  "knowledge.add": "Wissen hinzufügen",
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

  // --- item prices (item-price/ItemPricesRoute.tsx) --------------------------
  // The item names stay English, as in the guide; only the page speaks German.
  "itemPrices.title": "Preise magischer Gegenstände",
  "itemPrices.lead":
    "Was ein magischer Gegenstand kostet, wenn die Gruppe kaufen oder verkaufen will. Die Namen stehen auf Englisch wie in der Quelle.",
  "itemPrices.source":
    "Die Preise stammen aus {title} von {author}. Hat {author} für einen Gegenstand keinen Preis, steht dort der Richtwert seiner Seltenheit aus dem {srd}.",
  "itemPrices.search": "Gegenstand suchen",
  "itemPrices.list.aria": "Liste",
  "itemPrices.list.all": "Alle",
  "itemPrices.list.consumable": "Verbrauchbar",
  "itemPrices.list.combat": "Kampf",
  "itemPrices.list.noncombat": "Abseits des Kampfes",
  "itemPrices.list.summoning": "Beschwörung",
  "itemPrices.list.gamechanging": "Weltverändernd",
  "itemPrices.list.rarity": "Richtwert nach Seltenheit",
  "itemPrices.sort.aria": "Sortierung",
  "itemPrices.sort.name": "Nach Name",
  "itemPrices.sort.price": "Nach Preis",
  "itemPrices.loading": "Lade Preise …",
  "itemPrices.noMatch": "Kein Gegenstand passt zur Suche.",
  "itemPrices.rowSource": "{list} · Preis nach {author}",
  "itemPrices.rowRarity": "Richtwert für {rarity} · {title}",
  "itemPrices.rarity.common": "gewöhnlich",
  "itemPrices.rarity.uncommon": "ungewöhnlich",
  "itemPrices.rarity.rare": "selten",
  "itemPrices.rarity.veryRare": "sehr selten",
  "itemPrices.rarity.legendary": "legendär",
  "itemPrices.price": "{price, number} gp",


  // --- trash (routes/trash.tsx, components/Notices.tsx) ---------------------
  "trash.title": "Papierkorb",
  "trash.lead":
    "Was du löschst, liegt hier {days} Tage lang. Bis dahin kannst du es zurückholen, danach wird es endgültig entfernt.",
  "trash.loading": "Lade den Papierkorb …",
  "trash.loadFailed": "Der Papierkorb konnte nicht geladen werden — Server prüfen.",
  "trash.empty": "Der Papierkorb ist leer. Was du löschst, landet hier und lässt sich zurückholen.",
  "trash.group.chapters": "Kapitel",
  "trash.group.scenes": "Szenen",
  "trash.group.npcs": "NPCs",
  "trash.group.locations": "Orte",
  "trash.group.ideas": "Ideen",
  "trash.remaining":
    "{days, plural, =0 {Wird heute endgültig entfernt.} one {Wird in # Tag endgültig entfernt.} other {Wird in # Tagen endgültig entfernt.}}",
  "trash.chapter.scenes":
    "{count, plural, one {Seine # Szene kommt mit zurück.} other {Seine # Szenen kommen mit zurück.}}",
  "trash.restore": "Zurückholen",
  "trash.restore.aria": "„{name}“ zurückholen",
  "trash.restored": "„{name}“ ist zurückgeholt.",
  "trash.restore.stale":
    "Das wurde inzwischen anderswo geändert. Der Papierkorb ist neu geladen — versuch es noch einmal.",
  "trash.restore.gone":
    "Das liegt nicht mehr im Papierkorb: Es wurde schon zurückgeholt oder endgültig entfernt.",
  "trash.restore.failed": "Nicht zurückgeholt — Server prüfen.",
  "notice.region": "Hinweise",
  "notice.undo": "Rückgängig",

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
  "server.glossary_term_taken":
    "Den Begriff „{term}“ gibt es im Glossar schon — bitte den vorhandenen bearbeiten.",
  "server.scene_order_mismatch":
    "Die Reihenfolge passt nicht mehr zu den Szenen des Kapitels — bitte neu laden.",
  "server.session_running": "Eine ältere Session läuft noch — erst beenden.",
  "server.session_not_empty": "Diese Session hat Inhalt — beenden statt verwerfen.",
  "server.session_ended":
    "Diese Session ist schon beendet, deshalb wurde nichts gespeichert. Starte eine neue Session, um weiterzumachen.",
  "server.trash_blocked":
    "Das kann nicht in den Papierkorb, solange {blockers} darauf {count, plural, one {verweist} other {verweisen}}. Entferne erst diese Verweise.",
  "server.trash_blocked.played":
    "Das kann nicht in den Papierkorb, weil es in einer Session gespielt wurde: {blockers} {count, plural, one {verweist} other {verweisen}} darauf. Was gespielt wurde, bleibt stehen.",
  "server.chapter_in_trash":
    'Diese Szene kann nicht zurückgeholt werden, weil ihr Kapitel „{chapter}“ im Papierkorb liegt. Hol zuerst das Kapitel zurück.',
  "server.restore_blocked":
    "Das kann nicht zurückgeholt werden, solange {blockers} im Papierkorb {count, plural, one {liegt} other {liegen}}. Hol {count, plural, one {das} other {sie}} zuerst zurück.",
  // A scene of a generator run is written only once every npc and location
  // of the run it names exists. Nothing was written.
  "server.proposal_not_written":
    "Nicht geschrieben — diese Szene nennt einen NPC oder Ort des Laufs, der nicht angenommen ist. Nimm ihn zuerst an oder entferne ihn aus der Szene.",
  // A change of a patch round is about a block that is no longer in the
  // proposal's text as it was. Nothing was written.
  "server.patch_anchor_missing":
    "Nicht übernommen — der Block, den diese Änderung betrifft, steht nicht mehr so im Text. Verwirf die Änderung und bearbeite den Text selbst.",
  // One row in the way of a trash or a restore, as it stands inside the
  // sentences above; several of them are joined into one list.
  "server.blocker.chapter": 'das Kapitel „{name}“',
  "server.blocker.scene": 'die Szene „{name}“',
  "server.blocker.npc": 'der NPC „{name}“',
  "server.blocker.location": 'der Ort „{name}“',
  "server.blocker.log-entry": 'die Notiz „{name}“',
  "server.rev_conflict": "Inzwischen geändert — neu laden vor dem Speichern.",
  "server.nothing_to_write": "Nichts zu speichern.",
  "server.body_not_editable":
    "Diese Liste hat keinen bearbeitbaren Text — sie wird Zeile für Zeile gepflegt.",
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

  "server.kind.fallback": "Die Kennung",
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

  // --- list pages (/campaigns/:campaign/scenes, …/npcs, …/locations) -------
  "browse.title.scenes": "Szenen",
  "browse.title.npcs": "NPCs",
  "browse.title.locations": "Orte",

  // --- the shared write layer (lib/write-with-rev.ts, lib/use-rev-write.ts) -
  "write.stale": "Inzwischen geändert — neu laden",
  "write.failed": "Nicht gespeichert — Server prüfen",
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
  // --- the chapter's action in the chapter overview --------------------------
  // The chapter's status control (the active option sets `active`, and the
  // server takes it off the chapter that held it in the same write) carries its
  // labels under `properties.chapter.status.*`. The edit action opens the
  // chapter's edit mode.
  "chapterOverview.chapter.edit": "Kapitel bearbeiten",
  // The quiet second half of the contingency-scenes heading row — the `· `
  // separator stays markup in the JSX.
  "chapterOverview.contingencies.hint": "nur wenn der Auslöser feuert",
  "chapterOverview.scene.trigger": "Wenn: {trigger}",
  // Up/down on a scene row (decisions/scene-order). The title is IN the name: a list of
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
  "browse.loading": "Lade …",
  "browse.empty.scenes": "Noch keine Szenen.",
  "browse.empty.npcs": "Noch keine NPCs.",
  "browse.empty.locations": "Noch keine Orte.",

  // --- the reading views (scene/, chapter/, npc/, location/) ----------------
  "reading.loading": "Wird geladen …",
  "reading.notLoadable": "Nicht ladbar — Server prüfen und neu laden.",
  "scene.npcs.heading": "NPCs dieser Szene",

  // --- context line (components/PageContext.tsx) ----------------------------
  "context.aria": "Kontext",

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

  // The one step of the evening, under the open scene, and the box beside it
  // that marks the scene being left as played.
  "live.next": "Nächste Szene: {title}",
  "live.next.played": "gespielt",
  "live.next.changedElsewhere":
    "Diese Szene wurde inzwischen anderswo geändert und ist neu geladen. Klicke noch einmal auf „Nächste Szene“, um sie als gespielt zu markieren.",
  "live.next.failed": "Die nächste Szene ließ sich nicht öffnen, weil die Szene nicht als gespielt gespeichert wurde — Server prüfen.",

  "live.scene.none":
    "Keine Szene im aktiven Kapitel — Szenen in der Kapitelübersicht anlegen.",
  "live.scene.loading": "Lade Szene …",
  "live.scene.unloadable": "Diese Szene ließ sich nicht laden.",
  "live.scene.locationHeading": "Ort",
  "live.scene.npcsHeading": "NPCs",
  "live.scene.noNpcs": "Keine NPCs in dieser Szene.",

  "live.log.heading": "Log",
  "live.log.empty": "Noch keine Notizen — die Schnellnotiz unten landet hier.",
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
  // An idea ticked off against a stale state: nothing was written, the ideas
  // were read again (review and live aside).
  "idea.tick.stale": "Diese Idee wurde inzwischen geändert. Die Liste ist neu geladen.",
  "idea.trash.aria": "Idee „{text}“ löschen",
  "idea.trash.done": "Die Idee liegt im Papierkorb.",
  "idea.trash.failed": "Die Idee wurde nicht gelöscht — Server prüfen.",
  "idea.restore.failed":
    "Die Idee konnte nicht zurückgeholt werden und liegt weiter im Papierkorb. Du findest sie dort.",
  // A log line reviewed against a stale state: nothing was written, the
  // session was read again (review and live aside).
  "session.log.review.stale":
    "Diese Notiz wurde inzwischen anderswo geändert. Die Session ist neu geladen.",

  // --- live detail drawer (components/LiveDrawer.tsx) ------------------------
  "live.drawer.loading": "Lade Details …",
  "live.drawer.unloadable": "Nicht ladbar — {path} prüfen.",
  "live.drawer.open": "Vollständig öffnen",

  // --- review (the session wrap-up; the harvest metaphor lives in the code
  // names only, not in the UI)
  // routes/review.tsx, lib/use-review.ts ------------------------------------
  "review.title": "Session-Nachbereitung",
  "review.sessionFailed": "Session nicht ladbar — Server prüfen und neu laden.",
  "review.noSession": "Es gibt keine Session zum Sichten.",
  "review.lead":
    "Die Notizen der Session durchgehen — als Handlungsstrang übernehmen, NPC anlegen oder verwerfen. Der Rest bleibt im Log.",
  // Topbar and the mobile page read the same line (two parameters).
  "review.progress": "{seen} von {total} gesichtet",
  "review.loading": "Lade Notizen …",
  "review.empty": "Keine markierten Notizen in dieser Session — nichts zu sichten.",

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
  "review.notes.title": "Ideen ohne Tag",
  "review.notes.lead":
    "Unterwegs eingeworfen, ohne Tag — übernehmen, als NPC anlegen oder abhaken.",

  // Player-character notes: `#pc` lines from the log and the ideas.
  "review.pc.title": "Spielercharaktere",
  "review.pc.lead":
    "Notizen und Ideen mit #pc — Erinnerungen für den Tisch, kein Kampagneninhalt. Abhaken oder für die nächste Nachbereitung behalten.",
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
  // not a row the search index found.
  "palette.kind.area": "Bereich",

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
  "bodyEditor.blocked": "Ein Block muss noch geklärt werden — siehe Hinweis am Block.",
  "bodyEditor.discard.title": "Änderungen verwerfen?",
  "bodyEditor.discard.description":
    "Die Änderungen sind nicht gespeichert. Verwerfen schließt den Editor und zeigt wieder den gespeicherten Stand.",

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
  "kind.itemPrice": "Gegenstandspreis",
  // The accessible name of a `[[ref]]` in a body (markdown/refs.tsx):
  // what it points at, then its current name.
  "markdown.ref.aria": "{kind}: {name}",

  // --- generator: input form (routes/generate.tsx, generator-job-state.ts) ---
  "generate.input.title.scene": "Szenen generieren",
  "generate.input.title.npc": "NPC generieren",
  "generate.input.lead.scene":
    "Englisches Quellmaterial rein, deutsche Szenen-Entwürfe raus. Immer als Entwurf, immer mit Prüfung — geschrieben wird erst beim Übernehmen.",
  "generate.input.lead.npc":
    "Quellmaterial zu einer Figur rein, ein NPC nach Format raus — Will, Weiß, Beziehungen. Immer mit Prüfung; geschrieben wird erst beim Übernehmen.",
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
  "generate.input.extend": "Bestehende NPCs und Orte ergänzen",
  "generate.input.extendHint":
    "Der Lauf darf NPCs und Orte, die es schon gibt, um das ergänzen, was der Quelltext über sie sagt. Jede Änderung prüfst du, bevor sie geschrieben wird.",
  "generate.input.contextLabel": "Mitgeschickter Kontext:",
  // The two counts that come from the tree. The knowledge and the glossary
  // are LINKS to their own pages now, so
  // the view composes the line from three pieces (generator-job-state.ts).
  "generate.input.contextEntities":
    "{npcs, plural, one {# NPC} other {# NPCs}} \u00b7 {locations, plural, one {# Ort} other {# Orte}}",
  // The knowledge COUNT — the number is what tells the DM
  // whether the rules they just wrote arrived.
  "generate.input.knowledgeCount":
    "{count, plural, =0 {kein Kampagnenwissen} one {# Punkt Kampagnenwissen} other {# Punkte Kampagnenwissen}}",
  "generate.input.glossary": "Glossar",
  "generate.input.noGlossary": "kein Glossar",
  "generate.input.submit.scene": "Entwürfe generieren",
  "generate.input.submit.npc": "NPC generieren",

  // --- generator: the two id fields' own rules (generator-job-state.ts) ------
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
    "NPC existiert schon — ein bestehender NPC wird nie überschrieben.",

  // --- generator: the run's own errors (routes/generate.tsx) ---------------
  // The failed JOB's body is rendered by serverErrorBodyMessage (server.*) —
  // these are the app's own sentences about a status.
  "generate.error.treeScene": "Kapitel nicht ladbar — Grimoire-Server auf Port 3000 starten.",
  "generate.error.treeNpc": "Kampagne nicht ladbar — Grimoire-Server auf Port 3000 starten.",
  "generate.error.lostJob":
    "Der Lauf ist nicht mehr vorhanden (Server-Neustart?) — erneut starten.",
  "generate.error.noApiKey": "ANTHROPIC_API_KEY fehlt — siehe server/.env",
  "generate.error.npcExists":
    "NPC existiert schon — andere Kennung wählen; ein bestehender NPC wird nie überschrieben.",
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
  "generate.augment.title": "Gerade läuft eine Ergänzung",
  "generate.augment.lead":
    "Eine Ergänzung wird dort geprüft, wo das Ergänzte steht. Solange sie offen ist, startet hier "
    + "kein neuer Lauf.",
  "generate.augment.open": "Zur Ergänzung",
  "generate.working.correction":
    "Der Server validiert die Antwort mechanisch; Formfehler gehen automatisch als Korrektur ans Modell zurück.",
  "generate.working.background":
    "Läuft auf dem Server weiter — dieser Tab darf zu. Das Ergebnis wartet hier, bis es übernommen oder verworfen wird.",

  // --- generator: review (routes/generate.tsx, generator-job-state.ts) -------
  "generate.review.title": "Entwürfe prüfen",
  // The NPC run reviews ONE proposed NPC, not a set of drafts.
  "generate.review.titleNpc": "Vorschlag prüfen",
  "generate.review.summary":
    "{scenes, plural, one {# Szene} other {# Szenen}} · {stubs, plural, one {# vorgeschlagener NPC oder Ort} other {# vorgeschlagene NPCs und Orte}}",
  "generate.review.pending": "{summary} · noch nichts geschrieben",
  "generate.review.pendingNpc": "1 NPC · noch nichts geschrieben",
  "generate.review.lead":
    "Die Prüfung geht den Lauf in Schritten durch: erst die neuen Orte, dann die neuen NPCs, dann die Szenen. Jeder Vorschlag wird einzeln entschieden, und Annehmen schreibt genau diesen einen — nie überschreibend.",
  "generate.review.leadNpc":
    "Prüfen und anpassen. Erst „Übernehmen“ schreibt den NPC — bestehende NPCs werden nie überschrieben.",
  "generate.review.conflicts": "Diese Szenen, NPCs oder Orte gibt es schon — nichts geschrieben:",
  "generate.review.conflictsNpc": "Diesen NPC gibt es schon — nichts geschrieben:",
  "generate.review.applyFailed": "Nicht geschrieben — Server prüfen.",
  // A 409 that is not a rev conflict: the run moved on, this part is no
  // longer open or has nothing finished yet. Nothing was written.
  "generate.review.applyStale":
    "Nicht geschrieben — der Lauf hat sich geändert. Die Ansicht wird neu geladen.",
  "generate.review.discardFailed": "Nicht verworfen — Server prüfen.",
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
  "generate.review.applyScenes":
    "{count, plural, one {Die offene Szene übernehmen} other {Die # offenen Szenen übernehmen}}",
  "generate.review.discardRest": "Rest verwerfen",
  "generate.review.allDecided": "Alles entschieden.",
  "generate.review.plannedScene": "Geplante Szene",
  "generate.review.contingency": "Eventualszene",
  "generate.review.statblock": "Statblock: {statblock}",
  // The editor of a review card: the fields in the form of the fields
  // dialog, the body on the surfaces of the body editor.
  "generate.review.propertiesHeading": "Eigenschaften",
  "generate.review.bodyHeading": "Text",
  "generate.review.bodyLabel": "Text von {path}",
  // A new-chapter run's outline describes the chapter; accepting makes it the
  // chapter's text. Shown read-only above the drafts.
  "generate.review.chapterDescription": "Beschreibung des Kapitels",
  // The run's token spend; the grouping SEPARATOR is locale data, not copy
  // (generator-job-state.ts groups by hand — Intl would need full ICU data).
  "generate.usage": "~{tokens} Tokens · {attempts, plural, one {# Versuch} other {# Versuche}}",
  "generate.usage.group": ".",
  // --- generator: the pipeline ---------------------------------------------
  // A run is the outline call plus one call per scene and per proposed npc or location, so the
  // review fills up while the run is still going. What the DM reads is the
  // PARTS — the outline itself is never shown.
  "generate.pipeline.cost":
    "~{tokens} Tokens · {calls, plural, one {# Aufruf} other {# Aufrufe}}",
  "generate.pipeline.progress":
    "{done} von {total, plural, one {# Szene} other {# Szenen}} fertig",
  // Counted over EVERY part of the run — so the wording says parts rather
  // than scenes as soon as the run has proposed npcs or locations next to its scenes.
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
  "generate.stub.rejected": "Abgelehnt",
  "generate.stub.acceptAnyway": "Doch annehmen",

  // --- generator: the stages of a scene run's review ------------------------
  // A scene names npcs and locations, so the review decides those first: the
  // locations, then the npcs, then the scenes. A stage without proposals is
  // skipped.
  "generate.stage.nav": "Schritte der Prüfung",
  "generate.stage.locations": "Orte",
  "generate.stage.npcs": "NPCs",
  "generate.stage.scenes": "Szenen",
  "generate.stage.decided": "{decided} von {total} entschieden",
  "generate.stage.locked":
    "Die Szenen kommen, sobald jeder neue Ort und jeder neue NPC entschieden ist.",
  "generate.stage.lead.locations":
    "Der Lauf schlägt diese neuen Orte vor. Nimm jeden einzeln an oder lehne ihn ab — eine Szene kann nur an einem Ort spielen, den es gibt.",
  "generate.stage.lead.npcs":
    "Der Lauf schlägt diese neuen NPCs vor. Nimm jeden einzeln an oder lehne ihn ab — eine Szene kann nur einen NPC nennen, den es gibt.",
  "generate.stage.lead.scenes":
    "Jeder neue Ort und NPC ist entschieden. Eine Szene zu übernehmen schreibt diese Szene und sonst nichts.",
  "generate.stage.open":
    "{count, plural, one {# Vorschlag ist noch nicht entschieden.} other {# Vorschläge sind noch nicht entschieden.}}",
  "generate.stage.next.npcs": "Weiter zu den NPCs",
  "generate.stage.next.scenes": "Weiter zu den Szenen",
  "generate.stage.back.locations": "Zurück zu den Orten",
  "generate.stage.back.npcs": "Zurück zu den NPCs",
  "generate.stage.extend.locations":
    "Der Lauf schlägt Änderungen an Orten vor, die es schon gibt. Übernimm oder verwirf jede Änderung einzeln — sie halten die Szenen nicht auf.",
  "generate.stage.extend.npcs":
    "Der Lauf schlägt Änderungen an NPCs vor, die es schon gibt. Übernimm oder verwirf jede Änderung einzeln — sie halten die Szenen nicht auf.",

  // --- generator: changes a scene run proposes to an existing npc or location
  "generate.extension.reason.npc": "Änderungen an einem bestehenden NPC",
  "generate.extension.reason.location": "Änderungen an einem bestehenden Ort",
  "generate.extension.apply":
    "{count, plural, =0 {Keine Änderung übernommen} one {Die Änderung schreiben} other {Die # Änderungen schreiben}}",
  "generate.extension.changes":
    "{count, plural, one {Die vorgeschlagene Änderung} other {Die # vorgeschlagenen Änderungen}}",
  "generate.extension.taken":
    "{count, plural, one {{taken} von # Änderung wird übernommen.} other {{taken} von # Änderungen werden übernommen.}} Sie werden auf den Stand geschrieben, der beim Übernehmen gespeichert ist.",
  "generate.extension.unchanged.npc":
    "Der Quelltext fügt dem NPC „{name}“ nichts hinzu — hier ist nichts zu entscheiden.",
  "generate.extension.unchanged.location":
    "Der Quelltext fügt dem Ort „{name}“ nichts hinzu — hier ist nichts zu entscheiden.",

  // --- generator: a scene that names a rejected proposal --------------------
  "generate.incomplete.npc":
    "Diese Szene nennt den NPC „{name}“, den du abgelehnt hast — es gibt ihn nicht, so kann die Szene nicht übernommen werden.",
  "generate.incomplete.location":
    "Diese Szene spielt am Ort „{name}“, den du abgelehnt hast — es gibt ihn nicht, so kann die Szene nicht übernommen werden.",
  "generate.incomplete.acceptNpc": "{name} doch annehmen",
  "generate.incomplete.removeNpc": "{name} aus der Szene entfernen",
  "generate.incomplete.acceptLocation": "{name} doch annehmen",
  "generate.incomplete.removeLocation": "Den Ort aus der Szene entfernen",
  "generate.incomplete.drop": "Szene verwerfen",

  // --- generator: what was written (routes/generate.tsx) ------------------
  "generate.written.title.scene": "Geschrieben — alles als Entwurf",
  "generate.written.title.npc": "Geschrieben — NPC angelegt",
  "generate.written.hint.scene":
    "Die Szenen erscheinen unter ihrem Kapitel mit Status „Entwurf“. Bestehende Szenen, NPCs und Orte werden nie überschrieben — bei Konflikt schreibt der Server nichts.",
  "generate.written.hint.npc":
    "Der NPC erscheint in der NPC-Liste und in der Suche. Bestehende NPCs werden nie überschrieben — bei Konflikt schreibt der Server nichts.",
  "generate.written.openNpc": "NPC ansehen",
  "generate.written.toChapters": "Zu den Kapiteln",

  // --- the markdown format's own vocabulary (markdown/callout-labels.ts holds the KEY
  //     per callout kind, markdown/Callout.tsx and markdown/Markdown.tsx show
  //     them; lib/block-labels.ts names the same blocks in the composer) -----------
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

  // --- the Block-Composer (components/BlockComposer.tsx, @grimoire/shared/blocks,
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

  // --- edit mode of a reading view (components/EditMode.tsx, components/FieldChips.tsx)
  "editMode.changes": "{count, plural, one {# Änderung} other {# Änderungen}}",
  "editMode.chip.aria": "{field}: {value}",
  "editMode.chip.changedAria": "{field}: {value}, geändert",
  "editMode.chip.unset": "nicht gesetzt",
  "editMode.allFields.chip": "Alle Felder · {count}",
  "editMode.allFields.title": "Alle Felder",
  "editMode.done": "Fertig",
  "editMode.blocked.fields": "Ein Feld lässt sich so nicht speichern — der markierte Chip sagt, warum.",
  // Putting the row in the trash from its edit mode (components/TrashDialog.tsx);
  // the title and the sentence of the dialog are the entity's own.
  "editMode.delete": "Löschen",
  "editMode.delete.confirm": "In den Papierkorb legen",
  "editMode.delete.deleting": "Lege in den Papierkorb …",
  "editMode.delete.unsaved": "Deine ungespeicherten Änderungen gehen dabei verloren.",
  "editMode.delete.done": "„{name}“ liegt im Papierkorb.",
  "editMode.delete.stale":
    "„{name}“ wurde inzwischen anderswo geändert, deshalb ist nichts gelöscht. Brich die Bearbeitung ab und öffne sie neu, um den gespeicherten Stand zu sehen.",
  "editMode.delete.gone": "„{name}“ wurde inzwischen anderswo gelöscht.",
  "editMode.delete.failed": "Es wurde nichts gelöscht. Prüf den Server und versuch es noch einmal.",
  "editMode.restore.failed":
    "„{name}“ konnte nicht zurückgeholt werden und liegt weiter im Papierkorb. Dort kannst du „{name}“ selbst zurückholen.",

  // --- edit mode of a scene (scene/SceneEditMode.tsx) ------------------------
  // Field labels are the shared `properties.scene.*.label`, the type labels
  // `sceneArticle.type.*`.
  "sceneEdit.heading": "Szene bearbeiten",
  "sceneEdit.title.aria": "Titel der Szene",
  "sceneEdit.blocked.title": "Eine Szene braucht einen Titel.",
  "sceneEdit.trigger.placeholder": "Wann tritt die Szene ein?",
  "sceneEdit.trigger.add": "Auslöser",
  "sceneEdit.type.planned.hint": "steht in der Reihenfolge des Kapitels",
  "sceneEdit.type.contingency.hint": "tritt ein, wenn etwas passiert",
  "sceneEdit.location.none": "Kein Ort",
  "sceneEdit.location.search": "Ort suchen",
  "sceneEdit.location.noMatch": "Kein Ort passt zur Suche.",
  "sceneEdit.npcs.title": "NPCs in dieser Reihenfolge",
  "sceneEdit.handouts.title": "Handouts in Roll20",
  "sceneEdit.delete.title": "Diese Szene löschen?",
  "sceneEdit.delete.description":
    "„{title}“ kommt in den Papierkorb. Dort liegt die Szene {days} Tage, bis dahin kannst du sie zurückholen.",

  // --- edit mode of an npc (npc/NpcEditMode.tsx, components/FieldSection.tsx)
  // Field labels and hints are the shared `properties.npc.*`.
  "npcEdit.heading": "NPC bearbeiten",
  "npcEdit.name.aria": "Name des NPCs",
  "npcEdit.blocked.name": "Ein NPC braucht einen Namen.",
  "npcEdit.chapter.none": "Kein Kapitel",
  "npcEdit.profile.title": "Steckbrief",
  "npcEdit.profile.empty": "Der Steckbrief ist noch leer.",
  "npcEdit.delete.title": "Diesen NPC löschen?",
  "npcEdit.delete.description":
    "„{name}“ kommt in den Papierkorb. Dort liegt der NPC {days} Tage, bis dahin kannst du ihn zurückholen.",

  // --- edit mode of a location (location/LocationEditMode.tsx)
  // Field labels and hints are the shared `properties.location.*`.
  "locationEdit.heading": "Ort bearbeiten",
  "locationEdit.name.aria": "Name des Orts",
  "locationEdit.blocked.name": "Ein Ort braucht einen Namen.",
  "locationEdit.chapter.none": "Kein Kapitel",
  "locationEdit.atmosphere.empty": "Die Atmosphäre ist noch nicht beschrieben.",
  "locationEdit.delete.title": "Diesen Ort löschen?",
  "locationEdit.delete.description":
    "„{name}“ kommt in den Papierkorb. Dort liegt der Ort {days} Tage, bis dahin kannst du ihn zurückholen.",

  // --- edit mode of a chapter (chapter/ChapterEditMode.tsx)
  // The status labels are the shared `properties.chapter.status.*`.
  "chapterEdit.heading": "Kapitel bearbeiten",
  "chapterEdit.title.aria": "Titel des Kapitels",
  "chapterEdit.blocked.title": "Ein Kapitel braucht einen Titel.",
  "chapterEdit.activate.hint":
    "Beim Speichern wird dieses Kapitel das aktive — das bisher aktive Kapitel steht danach wieder auf geplant.",
  "chapterEdit.delete.title": "Dieses Kapitel löschen?",
  "chapterEdit.delete.description":
    "„{title}“ kommt in den Papierkorb. Dort liegt das Kapitel {days} Tage, bis dahin kannst du es zurückholen.",
  // What goes to the trash with the chapter, as a sentence of its own after
  // the one above; none of them when the chapter has neither.
  "chapterEdit.delete.along.both":
    "Seine {scenes, plural, one {# Szene} other {# Szenen}} und seine {threads, plural, one {# Handlungsstrang} other {# Handlungsstränge}} gehen mit und kommen mit ihm zurück.",
  "chapterEdit.delete.along.scenes":
    "{scenes, plural, one {Seine # Szene geht mit und kommt mit ihm zurück.} other {Seine # Szenen gehen mit und kommen mit ihm zurück.}}",
  "chapterEdit.delete.along.threads":
    "{threads, plural, one {Sein # Handlungsstrang geht mit und kommt mit ihm zurück.} other {Seine # Handlungsstränge gehen mit und kommen mit ihm zurück.}}",

  // --- the aside cards (npc/NpcCard.tsx, location/LocationCard.tsx) ---------
  "npcCard.noId": "{id} ist keine NPC-Kennung, deshalb gibt es dazu keinen NPC.",
  "npcCard.unloadable": "{id} — NPC nicht ladbar, Server prüfen.",
  "npcCard.will.inline": "Will:",
  "npcCard.will": "Will",
  "npcCard.voice": "Stimme",
  "locationCard.unloadable": "{id} — Ort nicht ladbar, Server prüfen.",
  "locationCard.roll20": "Roll20-Seite: {value}",

  // --- hover preview of a `[[ref]]` (components/RefTargetPreview.tsx) --------
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

  // --- the augment-with-AI action (generator-job/AugmentAction.tsx) --------
  "augment.action": "Mit KI ergänzen",
  "augment.action.running": "KI ergänzt …",
  "augment.action.ready": "Vorschlag prüfen",
  "augment.action.failed": "Ergänzung fehlgeschlagen",
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
  "augment.running":
    "Läuft auf dem Server. Du kannst den Dialog schließen und weiterarbeiten: Oben in der Leiste "
    + "siehst du, wann der Vorschlag bereit ist, und kommst mit einem Klick hierher zurück.",
  "augment.busy": "Ein anderer KI-Lauf läuft gerade. Warte ihn ab oder verwirf ihn dort.",
  "augment.busy.review":
    "Ein anderer KI-Lauf wartet noch auf deine Prüfung. Übernimm oder verwirf ihn erst, "
    + "denn ein neuer Lauf würde ihn löschen.",
  "augment.busy.open": "Zum anderen Lauf",
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
  // One change — the model's value or block against what stands there: take
  // it, or discard it and keep what stands.
  "augment.decision.aria": "Änderung übernehmen oder verwerfen",
  "augment.decision.take": "Änderung übernehmen",
  "augment.decision.keep": "Änderung verwerfen",
  "augment.decision.takeUnit": "Änderung übernehmen: {label}",
  "augment.decision.keepUnit": "Änderung verwerfen: {label}",
  "augment.diff.added": "hinzugefügt",
  "augment.diff.removed": "entfernt",
  "augment.diff.changed": "geändert",
  "augment.review.aria": "Vorschlag prüfen",
  "augment.accept": "Übernehmen",
  "augment.reject": "Vorschlag verwerfen",

} as const;
