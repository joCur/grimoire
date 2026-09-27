// The English catalog. Typed as `Messages`, so it is complete by
// construction: a missing key and a key that only exists here both fail the
// typecheck.
//
// DM vocabulary, not a literal translation: Session · Scene · Chapter ·
// Location · Session review · Read-aloud · Handout. Ids and property keys stay
// as they are on the wire — `id`, `active`, `insight +2` are data, not copy.

import type { Messages } from "./messages";

export const en: Messages = {
  // --- shared verbs ---------------------------------------------------------
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.discard": "Discard",
  "common.save": "Save",
  "common.saving": "Saving …",
  "common.create": "Create",
  "common.creating": "Creating …",
  "common.serverDown":
    "Server unreachable — start the Grimoire server on port 3000.",

  // --- not-found view (components/NotFound.tsx) -----------------------------
  "notFound.title": "This page does not exist",
  "notFound.body":
    "There is nothing at this address. The link may be mistyped, or what it pointed to was deleted.",
  "notFound.toCampaign": "To the chapter overview",
  "notFound.toStart": "Back to the start",

  // --- language switch ------------------------------------------------------
  "language.heading": "Language",
  "language.de": "Deutsch",
  "language.en": "English",

  // --- topbar ---------------------------------------------------------------
  "topbar.brand": "Grimoire",
  "topbar.search": "Search …",
  "topbar.generator": "Generator",
  "generatorJob.scene.running": "The AI is writing scenes.",
  "generatorJob.scene.ready": "The proposed scenes are waiting for your review.",
  "generatorJob.scene.failed": "The run for new scenes failed.",
  "generatorJob.npc.running": "The AI is writing an NPC.",
  "generatorJob.npc.ready": "The proposed NPC is waiting for your review.",
  "generatorJob.npc.failed": "The run for a new NPC failed.",
  "generatorJob.augment.running": "The AI is augmenting {name}.",
  "generatorJob.augment.ready": "The proposal for {name} is waiting for your review.",
  "generatorJob.augment.failed": "Augmenting {name} failed.",
  "generatorJob.notes.label": "Notes from the model",
  "generatorJob.notes.summary":
    "{count, plural, one {# note} other {# notes}} on this proposal",
  "generatorJob.runNotes.summary":
    "{count, plural, one {# note on the whole run} other {# notes on the whole run}}",
  "generatorJob.serverNotes.label": "Notes from Grimoire",
  "generatorJob.serverNote.reply_repaired":
    "The model's reply for this proposal was not valid JSON and was repaired before it was read.",
  "generatorJob.serverNote.source_excerpt_unmatched":
    "The source passage for “{title}” could not be matched word for word, so this scene was written from the whole source text.",
  "generatorJob.runServerNote.reply_repaired":
    "The model's outline was not valid JSON and was repaired before it was read.",
  "generatorJob.round.answer": "Your answer to this note",
  "generatorJob.round.answerPlaceholder": "Answer if the note should change something in the proposal",
  "generatorJob.round.keepAsKnowledge": "Keep this answer as campaign knowledge so that every later run knows it too.",
  "generatorJob.round.send": "Send answers",
  "generatorJob.round.sending": "Sending …",
  "generatorJob.round.running": "The model is working your answers into this proposal.",
  "generatorJob.round.failed":
    "The model could not work your answers in, and the proposal is unchanged. Send the answers again.",
  "generatorJob.round.changes":
    "{count, plural, one {One change from your answers is waiting for your decision.} other {# changes from your answers are waiting for your decision.}}",
  "generatorJob.round.conflict":
    "The run was changed elsewhere in the meantime. It has been reloaded — look it over and decide again.",
  "generatorJob.round.sendFailed": "The answers could not be sent. Try again.",
  "generatorJob.round.decideFailed": "The decision could not be saved. Try again.",
  "generatorJob.finding.unreadable":
    "One of the model's changes could not be read and was not applied.",
  "generatorJob.finding.anchor_missing":
    "A change was not applied because this block is not in the text: “{anchor}”",
  "generatorJob.finding.anchor_ambiguous":
    "A change was not applied because this block appears more than once in the text: “{anchor}”",
  "generatorJob.finding.text_empty":
    "A change to the block “{anchor}” was not applied because it brought no text.",
  "generatorJob.finding.callouts_unknown":
    "A change to the block “{anchor}” was not applied because it names callouts that do not exist: {callouts}.",
  "generatorJob.finding.refs_unknown":
    "A change to the block “{anchor}” was not applied because it refers to something neither the campaign nor this run has: {ids}.",
  "generatorJob.finding.field_unknown":
    "A change was not applied because the proposal has no field “{field}”.",
  "generatorJob.finding.field_empty":
    "The new value for {field} was not applied because the field must not be empty.",
  "generatorJob.finding.field_invalid":
    "The new value for {field} was not applied because it does not fit the field.",
  "generatorJob.finding.chapter_outside":
    "A change was not applied because the scene stays in this run's chapter “{chapter}”.",
  "generatorJob.finding.ids_unknown":
    "The new value for {field} was not applied because it names something neither the campaign nor this run has: {ids}.",
  "generatorJob.hint.field":
    "The field “{field}” still says “{from}” — the naming convention says “{to}”.",
  "generatorJob.hint.block":
    "This block still says “{from}” — the naming convention says “{to}”.",
  "generatorJob.hint.text":
    "The text still says “{from}” — the naming convention says “{to}”.",
  "generatorJob.hint.proposal":
    "The proposal still says “{from}” — the naming convention says “{to}”.",
  "topbar.generator.progress": "{written} of {total} applied",
  "topbar.session.back": "To the session",

  // --- campaign menu (components/CampaignMenu.tsx) ---------------------------
  "campaignMenu.trigger": "Campaign: {name}",
  "campaignMenu.triggerInArea": "Campaign: {name}, area: {area}",
  "campaignMenu.title": "Campaign menu",
  "campaignMenu.campaigns": "Campaigns",
  "campaignMenu.empty": "No campaigns yet.",
  "campaignMenu.group.prepare": "Prepare",
  "campaignMenu.group.lookUp": "Look up",
  "campaignMenu.group.tidyUp": "Tidy up",
  "campaignMenu.reviewPending": "{count} open",
  "area.chapters": "Chapters",
  "area.scenes": "Scenes",
  "area.npcs": "NPCs",
  "area.locations": "Locations",
  "area.glossary": "Glossary",
  "area.itemPrices": "Item prices",
  "area.knowledge": "Campaign knowledge",
  "area.review": "Session review",
  "area.trash": "Trash",

  // --- the session chip -----------------------------------------------------
  "session.start": "Start session",
  "session.start.failed": "Session not started — check the server",
  "session.start.olderRunning": "An older session is still running — end it in the session view",
  "session.status.unknown": "Status unknown",
  "session.status.unknown.aria": "Session status unknown — check the server",
  "session.state.running": "Session running",
  "session.state.paused": "Session paused",
  "session.state.withElapsed": "{state}, {elapsed}",
  "session.chip.link.aria": "{label} — back to the running session",
  "session.chip.menu.aria": "{label} — session menu",
  "session.short.running": "running",
  "session.short.paused": "paused",
  "session.menu.pause": "Pause",
  "session.menu.continue": "Resume",
  "session.menu.end": "End session",
  "session.menu.discard": "Discard session",
  "session.write.failed": "Session unchanged — check the server.",
  "session.discard.title": "Discard the empty session?",
  "session.discard.description": "The session will be deleted.",
  "session.discard.failed": "Session not discarded — check the server and reload.",
  "session.date": "Session of {date}",
  "session.date.unknown": "Session",

  // --- the reading page of one session --------------------------------------
  "session.page.crumb": "Sessions",
  "session.page.loading": "Loading session …",
  "session.page.notLoadable": "Session not loadable — check the server and reload.",
  "session.page.started": "Start",
  "session.page.ended": "End",
  "session.page.stillRunning": "still running",
  "session.page.timeUnknown": "unknown",
  "session.page.runtime": "Play time",
  "session.page.log": "Log",
  "session.page.log.empty": "Nothing was noted down in this session.",
  "session.page.pauses": "Pauses",
  "session.page.pauseRow": "{from} – {to} ({duration})",
  "session.page.scenes": "Scenes with notes",
  "session.page.scenes.empty": "No note in this session was taken in a scene.",

  // --- create dialogs -------------------------------------------------------
  "create.failed": "Not created — check the server.",
  "create.useSuggestion": "Use “{id}”",

  "create.campaign.title": "Create campaign",
  "create.campaign.nameLabel": "Campaign name",
  "create.campaign.namePlaceholder": "Campaign name",
  "create.campaign.descriptionLabel": "Description (optional)",
  "create.campaign.descriptionPlaceholder": "One sentence that places the campaign",

  "create.chapter.title": "Create chapter",
  "create.chapter.description":
    "The description is optional. It becomes the chapter's text and appears under its title in the chapter overview.",
  "create.chapter.nameLabel": "Title",
  "create.chapter.namePlaceholder": "Chapter title",
  "create.chapter.descriptionLabel": "Description (optional)",
  "create.chapter.descriptionPlaceholder":
    "What this chapter is about and what the party is meant to achieve",

  "create.scene.title": "Create scene",
  "create.scene.description":
    "The scene is created as a draft in this chapter and opens straight in the editor.",
  "create.scene.nameLabel": "Title",
  "create.scene.namePlaceholder": "Scene title",

  "create.npc.title": "Create NPC",
  "create.npc.description":
    "Just the name — you add role, status and everything else afterwards when you edit the NPC.",
  "create.npc.nameLabel": "Name",
  "create.npc.namePlaceholder": "NPC name",

  "create.location.title": "Create location",
  "create.location.description":
    "Just the name — you add everything else afterwards when you edit the location.",
  "create.location.nameLabel": "Name",
  "create.location.namePlaceholder": "Location name",

  // --- the id line of every create surface (components/IdField.tsx) ---------
  "idField.label": "ID",
  "idField.edit": "Set the ID yourself",
  "idField.invalid": "An ID needs lowercase letters, digits and single hyphens.",

  // --- cold start -----------------------------------------------------------
  "home.opening": "Opening the campaign …",
  "coldstart.title": "Welcome to Grimoire",
  "coldstart.lead":
    "No campaign yet. Create one — chapters and scenes come into being inside it afterwards.",

  // --- the fields of the edit modes ------------------------------------------
  "properties.id": "ID",
  "properties.discard.title": "Discard changes?",
  "properties.discard.keepEditing": "Keep editing",
  "unsaved.description":
    "This page has unsaved changes. They are lost if you leave now.",


  "properties.field.required": " · required",
  "properties.field.unset": "— not set —",
  "properties.field.chipsPlaceholder": "add, Enter",
  "properties.field.addRow": "Add row",
  "properties.field.remove.aria": "Remove {item}",
  "properties.field.row": "Row {row}",
  "properties.field.row.name.aria": "{label}, row {row}: name",
  "properties.field.row.value.aria": "{label}, row {row}: value",
  "properties.ref.unknownChapter": "Unknown — the chapter has to exist.",
  "properties.ref.unknownLocation": "Unknown — the location has to exist.",
  "properties.issue.locationUnusable":
    'Not a usable name — “{value}” yields no location ID.',
  "properties.issue.notAnId": "“{id}” is not an ID — lowercase letters, digits and hyphens only.",
  "properties.issue.namelessRow": "Row without a name — add a name or remove the row.",
  "properties.issue.duplicateName": "Name “{name}” twice — every name may appear only once.",
  "properties.issue.chapterRequired": "A scene needs a chapter — it can be moved, but not removed.",

  "properties.scene.title.label": "Title",
  "properties.scene.type.label": "Type",
  "properties.scene.type.planned": "planned scene",
  "properties.scene.type.contingency": "contingency scene",
  "properties.scene.trigger.label": "Trigger",
  "properties.scene.trigger.hint": "Contingency scenes only: when does the scene fire?",
  "properties.scene.chapter.label": "Chapter",
  "properties.scene.location.label": "Location",
  "properties.scene.location.hint":
    "Pick a location from the list — the scene names it in its meta line, in the reading view and in the session view.",
  "properties.scene.npcs.label": "NPCs",
  "properties.scene.npcs.hint": "IDs only — the NPC has to exist already.",
  "properties.scene.handouts.label": "Handouts",
  "properties.scene.handouts.hint": "Name of the Roll20 handout, a reference only.",
  "properties.scene.tags.label": "Tags",
  "properties.scene.tags.hint": "Free; recommended: combat, social, stealth, travel.",
  "properties.scene.status.label": "Status",

  "properties.npc.name.label": "Name",
  "properties.npc.role.label": "Role",
  "properties.npc.role.hint": "A single line.",
  "properties.npc.chapter.label": "Chapter",
  "properties.npc.chapter.hint": "Where the NPC is introduced.",
  "properties.npc.status.label": "Status",
  "properties.npc.statblock.label": "Statblock",
  "properties.npc.statblock.placeholder": "Roll20: Fenn",
  "properties.npc.statblock.hint": "A reference to the Roll20 sheet, not a copy.",
  "properties.npc.quickstats.label": "Quick stats",
  "properties.npc.quickstats.hint":
    "Free — only what is needed socially, e.g. insight +2.",
  "properties.npc.voice.label": "Voice",
  "properties.npc.voice.hint": "What do they sound like?",
  "properties.npc.appearance.label": "Appearance",
  "properties.npc.appearance.hint": "One or two features.",
  "properties.npc.motivation.label": "Wants",
  "properties.npc.motivation.hint":
    "What the character wants — the NPC card and the preview show it. [[id]] reads as a name there.",

  "properties.location.name.label": "Name",
  "properties.location.chapter.label": "Chapter",
  "properties.location.roll20.label": "Roll20 page",
  "properties.location.roll20.hint": "A reference to the page, not a copy of the map.",
  "properties.location.atmosphere.label": "Atmosphere",
  "properties.location.atmosphere.hint":
    "How the place feels — the location card and the preview show it. [[id]] reads as a name there.",

  "properties.chapter.status.planned": "Planned",
  "properties.chapter.status.active": "Active",
  "properties.chapter.status.done": "Done",

  // --- settings page (/settings) --------------------------------------------
  "settings.title": "Settings",
  "settings.lead":
    "Settings for this Grimoire instance. Changes take effect at once and live on the server.",
  "settings.language.heading": "Language",
  "settings.language.hint": "Language of the interface. Applies to this instance, not to the campaign data.",

  // --- the two campaign-content pages --------------------------------------
  "editableList.loading": "Loading the list …",
  "editableList.loadFailed": "List not loaded — reload the page.",
  "editableList.saveFailed": "Not saved.",
  "editableList.saving": "Saving …",
  "editableList.saved": "Saved",
  "editableList.moveUp": "Move up",
  "editableList.moveDown": "Move down",
  "editableList.edit": "Edit “{name}”",
  "editableList.remove": "Delete \u201c{name}\u201d",
  "editableList.removed": "Deleted",
  "editableList.confirmDelete.title": "Delete “{name}”?",
  "editableList.confirmDelete.body": "This cannot be undone.",
  "editableList.confirmDelete.confirm": "Delete",

  "knowledge.title": "Campaign knowledge",
  "knowledge.lead":
    "Naming conventions, facts and style rules of this campaign. Travels with every generator run and is binding \u2014 even when the source material says otherwise. The order here is the order in the prompt. References like [[fenn]] are resolved to the name.",
  "knowledge.filter": "Filter the knowledge",
  "knowledge.empty":
    "No campaign knowledge yet. Start with a naming convention, a fact or a style rule.",
  "knowledge.noMatch": "Nothing matches the filter.",
  "knowledge.add": "Add knowledge",
  "knowledge.blank": "Nothing filled in yet",
  "knowledge.kindLabel": "Kind",
  "knowledge.kind.naming": "Naming convention",
  "knowledge.kind.fact": "Fact",
  "knowledge.kind.style": "Style rule",
  "knowledge.from": "Old (in the source material)",
  "knowledge.to": "New (in this campaign)",
  "knowledge.factText": "The fact that holds",
  "knowledge.styleText": "Style rule for generated text",
  "knowledge.incomplete": "Incomplete \u2014 not sent with the prompt like this.",

  "glossary.title": "Glossary",
  "glossary.lead":
    "Translations for the generator: the English term and this campaign's wording. Sorted alphabetically.",
  "glossary.filter": "Filter the terms",
  "glossary.empty": "No terms yet \u2014 add the first one.",
  "glossary.noMatch": "No term matches the filter.",
  "glossary.add": "New term",
  "glossary.term": "Term",
  "glossary.explanation": "Explanation",
  "glossary.noExplanation": "No explanation",

  "itemPrices.title": "Magic item prices",
  "itemPrices.lead":
    "What a magic item costs when the group wants to buy or sell one. The names stay as the source writes them.",
  "itemPrices.source":
    "The prices come from {title} by {author}. Where {author} has no price for an item, it shows the value of its rarity from the {srd}.",
  "itemPrices.search": "Search an item",
  "itemPrices.list.aria": "List",
  "itemPrices.list.all": "All",
  "itemPrices.list.consumable": "Consumables",
  "itemPrices.list.combat": "Combat",
  "itemPrices.list.noncombat": "Noncombat",
  "itemPrices.list.summoning": "Summoning",
  "itemPrices.list.gamechanging": "Gamechanging",
  "itemPrices.list.rarity": "Value by rarity",
  "itemPrices.sort.aria": "Order",
  "itemPrices.sort.name": "By name",
  "itemPrices.sort.price": "By price",
  "itemPrices.loading": "Loading prices …",
  "itemPrices.noMatch": "No item matches the search.",
  "itemPrices.rowSource": "{list} · priced by {author}",
  "itemPrices.rowRarity": "Value for {rarity} · {title}",
  "itemPrices.rarity.common": "common",
  "itemPrices.rarity.uncommon": "uncommon",
  "itemPrices.rarity.rare": "rare",
  "itemPrices.rarity.veryRare": "very rare",
  "itemPrices.rarity.legendary": "legendary",
  "itemPrices.price": "{price, number} gp",


  // --- trash (routes/trash.tsx, components/Notices.tsx) ---------------------
  "trash.title": "Trash",
  "trash.lead":
    "What you delete stays here for {days} days. Until then you can restore it; after that it is removed for good.",
  "trash.loading": "Loading the trash …",
  "trash.loadFailed": "The trash could not be loaded — check the server.",
  "trash.empty": "The trash is empty. Whatever you delete lands here and can be restored.",
  "trash.group.chapters": "Chapters",
  "trash.group.scenes": "Scenes",
  "trash.group.npcs": "NPCs",
  "trash.group.locations": "Locations",
  "trash.group.ideas": "Ideas",
  "trash.remaining":
    "{days, plural, =0 {Removed for good today.} one {Removed for good in # day.} other {Removed for good in # days.}}",
  "trash.chapter.scenes":
    "{count, plural, one {Its # scene comes back with it.} other {Its # scenes come back with it.}}",
  "trash.restore": "Restore",
  "trash.restore.aria": "Restore “{name}”",
  "trash.restored": "“{name}” has been restored.",
  "trash.restore.stale":
    "This was changed elsewhere in the meantime. The trash has been reloaded — try again.",
  "trash.restore.gone":
    "This is no longer in the trash: it was already restored or removed for good.",
  "trash.restore.failed": "Not restored — check the server.",
  "notice.region": "Notices",
  "notice.undo": "Undo",

  // --- server error bodies (code -> sentence, see i18n/server-errors.ts) ----
  "server.slug_taken": '{kind} “{id}” already exists — suggestion: “{suggestion}”',
  "server.slug_reserved": '“{id}” is a reserved name — suggestion: “{suggestion}”',
  "server.slug_empty": "{field} yields no ID — please use letters or digits.",
  "server.location_not_an_id":
    'Location “{value}” is not a location ID — use “{suggestion}” and create that location first.',
  "server.location_not_an_id.noSuggestion":
    'Location “{value}” is not a location ID — please use lowercase letters, digits and dashes.',
  "server.location_unknown": 'Location “{value}” does not exist — create it first.',
  "server.npc_unknown": 'NPC “{value}” does not exist — create it first.',
  "server.chapter_unknown": 'Chapter “{value}” does not exist — create it first.',
  "server.chapter_required": "A scene needs a chapter — it can be moved, but not removed.",
  "server.log_scene_unknown": 'Scene “{value}” does not exist — create it first.',
  "server.played_scene_unknown":
    'Played scene “{value}” does not exist — create it first.',
  "server.glossary_duplicate_term":
    'Glossary term “{term}” appears more than once — please merge them.',
  "server.glossary_term_taken":
    "The glossary already has the term “{term}” — please edit that one instead.",
  "server.scene_order_mismatch":
    "The order no longer matches the chapter's scenes — please reload.",
  "server.session_running": "An older session is still running — end it first.",
  "server.session_not_empty": "This session has content — end it instead of discarding it.",
  "server.session_ended":
    "This session has already ended, so nothing was saved. Start a new session to carry on.",
  "server.trash_blocked":
    "This cannot go to the trash while {blockers} still {count, plural, one {refers} other {refer}} to it. Remove those references first.",
  "server.trash_blocked.played":
    "This cannot go to the trash because it was played in a session: {blockers} {count, plural, one {refers} other {refer}} to it. What was played stays.",
  "server.chapter_in_trash":
    "This scene cannot be restored because its chapter “{chapter}” is in the trash. Restore the chapter first.",
  "server.restore_blocked":
    "This cannot be restored while {blockers} {count, plural, one {is} other {are}} in the trash. Restore {count, plural, one {it} other {them}} first.",
  "server.proposal_not_written":
    "Not written — this scene names an NPC or a location of the run that has not been accepted. Accept it first or remove it from the scene.",
  "server.patch_anchor_missing":
    "Not applied — the block this change is about is no longer in the text as it was. Discard the change and edit the text yourself.",
  // One row in the way of a trash or a restore, as it stands inside the
  // sentences above; several of them are joined into one list.
  "server.blocker.chapter": "the chapter “{name}”",
  "server.blocker.scene": "the scene “{name}”",
  "server.blocker.npc": "the NPC “{name}”",
  "server.blocker.location": "the location “{name}”",
  "server.blocker.log-entry": "the note “{name}”",
  "server.rev_conflict": "Changed in the meantime — reload before saving.",
  "server.nothing_to_write": "Nothing to save.",
  "server.body_not_editable": "This list has no editable text — it is maintained row by row.",
  "server.job_restarted": "The server was restarted while the job was running — start it again.",
  "server.job_draft_format":
    "This run predates the current draft format and cannot be accepted any more — generate it again.",
  "server.llm_truncated":
    "The model's reply was cut off — raise LLM_MAX_TOKENS (currently: {max}) or shorten the source text.",
  "server.llm_invalid": "The reply did not pass the mechanical validation.",
  "server.llm_truncated.defaultCap": "the endpoint default",
  "server.status_not_allowed": 'There is no status “{value}” — allowed are {allowed}.',
  "server.scene_type_not_allowed": 'There is no scene type “{value}” — allowed are {allowed}.',
  "server.timestamp_not_allowed":
    // The doubled apostrophes are ICU escaping: a single one would quote the
    // placeholder behind it and the sentence would read `{value}` verbatim.
    "Timestamp ''{value}'' is not of the form yyyy-mm-ddThh:mm:ss.",

  "server.kind.fallback": "The ID",
  "server.kind.campaign": "Campaign",
  "server.kind.chapter": "Chapter",
  "server.kind.scene": "Scene",
  "server.kind.npc": "NPC",
  "server.kind.location": "Location",
  "server.field.name": "The name",
  "server.field.title": "The title",


  // --- status enum labels (lib/scene-status.ts, npc/npc-status.ts) ----------
  "status.scene.ready": "ready",
  "status.scene.draft": "draft",
  "status.scene.played": "played",
  "status.scene.dropped": "dropped",
  "status.npc.alive": "alive",
  "status.npc.dead": "dead",
  "status.npc.missing": "missing",
  "status.npc.unknown": "unknown",

  // --- list pages (/campaigns/:campaign/scenes, …/npcs, …/locations) -------
  "browse.title.scenes": "Scenes",
  "browse.title.npcs": "NPCs",
  "browse.title.locations": "Locations",


  // --- the shared write layer (lib/write-with-rev.ts, lib/use-rev-write.ts) -
  "write.stale": "Changed in the meantime — reload",
  "write.failed": "Not saved — check the server",
  "write.status.failed": "Status not saved — check the server",
  "editConflict.line": "Changed in the meantime",
  "editConflict.reload": "Reload",
  "editConflict.force": "Save anyway",
  "status.change.aria": "Change status, currently {current}",
  "status.sceneUnloadable": "Scene not loadable",
  "status.chapterUnloadable": "This chapter could not be loaded.",


  // --- the chapter overview ("/campaigns/:campaign", routes/chapter-overview.tsx) ---
  "chapterOverview.loading": "Loading scenes …",
  "chapterOverview.empty":
    "No chapters yet. A chapter is the bracket around scenes — the first scene goes inside one.",
  "chapterOverview.chapterCount": "{count, plural, one {# chapter} other {# chapters}}",
  "chapterOverview.sceneCount": "{count, plural, =0 {no scenes} one {# scene} other {# scenes}}",
  "chapterOverview.chapter.empty": "No scenes in this chapter yet.",
  // --- the chapter's action in the chapter overview --------------------------
  "chapterOverview.chapter.edit": "Edit chapter",
  "chapterOverview.contingencies.hint": "only when the trigger fires",
  "chapterOverview.scene.trigger": "When: {trigger}",
  "chapterOverview.scene.moveUp.aria": "Move \u201c{title}\u201d up",
  "chapterOverview.scene.moveDown.aria": "Move \u201c{title}\u201d down",
  "chapterOverview.order.conflict": "Order changed in the meantime — the current one is loaded.",
  "chapterOverview.order.failed": "Order not saved — check the server.",
  "chapterOverview.threads.label": "Open storylines",
  "chapterOverview.threads.done.aria": "\u201c{text}\u201d done",
  "chapterOverview.threads.edit.aria": "Edit \u201c{text}\u201d",
  "chapterOverview.threads.remove.aria": "Delete \u201c{text}\u201d",
  "chapterOverview.threads.add": "Add storyline",
  "chapterOverview.threads.addSubmit": "Add",
  "chapterOverview.threads.input": "Open storyline",
  "chapterOverview.threads.new": "new from the session review",
  "chapterOverview.threads.failed": "Not saved — check the server.",
  "chapterOverview.threads.confirmDelete.title": "Delete this storyline?",
  "chapterOverview.threads.confirmDelete.body":
    "\u201c{text}\u201d will be removed from the list. This cannot be undone.",
  "chapterOverview.threads.confirmDelete.confirm": "Delete",

  // --- browse list pages (routes/browse.tsx) --------------------------------
  "browse.loading": "Loading …",
  "browse.empty.scenes": "No scenes yet.",
  "browse.empty.npcs": "No NPCs yet.",
  "browse.empty.locations": "No locations yet.",

  // --- the reading views (scene/, chapter/, npc/, location/) ----------------
  "reading.loading": "Loading …",
  "reading.notLoadable": "Not loadable — check the server and reload.",
  "scene.npcs.heading": "NPCs in this scene",

  // --- context line (components/PageContext.tsx) ----------------------------
  "context.aria": "Context",


  // --- shared scene-group headings (routes/live.tsx + routes/chapter-overview.tsx) ------
  // Neutral prefix on purpose: the live nav and the chapter overview list show the SAME
  // two group headings — one key, not one per view.
  "scene.planned.heading": "Planned",
  "scene.contingencies.heading": "Contingency scenes",

  // --- live mode (routes/live.tsx) ------------------------------------------
  // Below md there is no live mode (UI-BRIEF §4) — just the pointer.
  "live.mobile.note": "The session view is made for the desktop.",
  "live.mobile.read": "Read scene: {title}",

  "live.nav.aria": "Scenes of the session",
  "live.nav.noPlanned": "No planned scenes in this chapter.",
  // The collapsed group of scenes that are behind us: the heading
  // alone names the group for a screen reader, `playedGroup` is the visible
  // trigger where the count is PART of the sentence.
  "live.nav.played": "Played",
  "live.nav.playedGroup": "Played {count}",

  "live.next": "Next scene: {title}",
  "live.next.played": "played",
  "live.next.changedElsewhere":
    "This scene was changed elsewhere in the meantime and has been reloaded. Click “Next scene” again to mark it as played.",
  "live.next.failed": "The next scene did not open because the scene was not saved as played — check the server.",

  "live.scene.none":
    "No scene in the active chapter — create scenes on the chapters page.",
  "live.scene.loading": "Loading scene …",
  "live.scene.unloadable": "This scene could not be loaded.",
  "live.scene.locationHeading": "Location",
  "live.scene.npcsHeading": "NPCs",
  "live.scene.noNpcs": "No NPCs in this scene.",

  "live.log.heading": "Log",
  "live.log.empty": "No notes yet — the quick note below lands here.",
  "live.note.aria": "Quick note",
  "live.note.placeholder": "Quick note … #thread #npc #loot",
  "live.note.hint": "Enter sends · time and scene are set automatically",
  "live.note.failed": "Note not saved — check the server.",

  "live.session.loading": "Loading session …",
  "live.session.unloadable": "Session not loadable — check the server and reload.",
  "live.session.none": "No session is running.",
  // The one start conflict the live route turns into a question: an OLDER
  // session nobody ended. One sentence per variant — the session is a
  // parameter, never a fragment between two halves.
  "live.session.olderRunning": "An older session is still running — end it first.",
  "live.session.olderRunning.withSession":
    "An older session is still running ({session}) — end it first.",
  "live.session.endOld": "End the old session",

  // The "For the players" reminder list of the aside.
  "live.pc.heading": "For the players",
  "live.pc.done": "Mark \u201c{text}\u201d done",
  "live.pc.allDone": "All done.",
  "live.pc.failed": "Not saved — check the server.",
  "idea.tick.stale": "This idea was changed in the meantime. The list has been reloaded.",
  "idea.trash.aria": "Delete the idea “{text}”",
  "idea.trash.done": "The idea is in the trash.",
  "idea.trash.failed": "The idea was not deleted — check the server.",
  "idea.restore.failed":
    "The idea could not be restored and is still in the trash. You will find it there.",
  "session.log.review.stale":
    "This note was changed elsewhere in the meantime. The session has been reloaded.",

  // --- live detail drawer (components/LiveDrawer.tsx) ------------------------
  "live.drawer.loading": "Loading details …",
  "live.drawer.unloadable": "Not loadable — check {path}.",
  "live.drawer.open": "Open in full",


  // --- review (the session review; the harvest metaphor lives in the code,
  // not in the UI)
  // routes/review.tsx, lib/use-review.ts ------------------------------------
  "review.title": "Session review",
  "review.sessionFailed": "Session not loadable — check the server and reload.",
  "review.noSession": "There is no session to review.",
  "review.lead":
    "Go through the notes of the session — adopt as a storyline, create an NPC or discard. The rest stays in the log.",
  // Topbar and the mobile page read the same line (two parameters).
  "review.progress": "{seen} of {total} reviewed",
  "review.loading": "Loading notes …",
  "review.empty": "No tagged notes in this session — nothing to review.",

  // The card's source chip — the scene travels INSIDE the sentence.
  "review.source.log": "Log",
  "review.source.logScene": "Log · {scene}",
  "review.source.inbox": "Idea",

  "review.action.thread": "Adopt as storyline",
  "review.action.resolve": "Done",
  "review.action.failed": "Action not saved — check the server.",
  "review.npc.failed": "NPC not created — check the server.",
  "review.npc.exists":
    "The NPC “{id}” already exists, so the note was not added. Choose another ID, for example “{suggestion}”.",

  // The done row: the action of THIS sitting, or the neutral fallback after a
  // reload (the server only stores done/not-done).
  "review.done.thread": "Adopted as storyline",
  "review.done.npc": "NPC created",
  "review.done.dismiss": "Discarded",
  "review.done.resolved": "Done",
  "review.done.seen": "reviewed",

  "review.notes.title": "Ideas without a tag",
  "review.notes.lead":
    "Thrown in on the go, without a tag — adopt them, create an NPC or tick them off.",

  // Player-character notes: `#pc` lines from the log and the ideas.
  "review.pc.title": "Player characters",
  "review.pc.lead":
    "Notes and ideas tagged #pc — reminders for the table, not campaign content. Tick them off or keep them for the next review.",
  "review.pc.groupTag": "#{tag}",
  "review.pc.groupGeneral": "General",
  "review.action.keep": "Keep",
  "review.action.keepHint": "Stays open for the next review.",

  "review.threads.title": "Open storylines of the chapter",
  "review.threads.empty": "No open storylines in this chapter yet.",
  "review.threads.new": "new",
  "review.finish": "Done — back to the chapters",

  // --- NPC create dialog of the review (npc/NpcFromNoteDialog.tsx) ----------
  "npcCreate.description":
    "Creates a new NPC with the status “unknown” and uses this note as its text. If an empty NPC already has this ID, it receives the note. If an NPC with this ID already has content, nothing is written and the note stays open.",
  "npcCreate.idLabel": "ID (appears in the address)",
  "npcCreate.idPlaceholder": "npc-id",
  "npcCreate.idInvalid": "An ID needs lowercase letters, digits and single hyphens.",
  "npcCreate.nameLabel": "Name (optional)",


  // --- shared verbs: ADD to the existing common block --------------------
  "common.edit": "Edit",
  "common.showMore": "Show more",
  "common.showLess": "Show less",

  // --- mobile start surface (routes/mobile-start.tsx) ----------------------
  "mobileStart.search": "Search scenes, NPCs, locations …",
  "mobileStart.inbox.label": "Ideas",
  "mobileStart.inbox.placeholder": "Drop an idea … #thread #npc",
  "mobileStart.inbox.submit": "Drop in",
  "mobileStart.inbox.saved": "Dropped in.",
  "mobileStart.inbox.failed": "Not saved — check the server.",

  // --- ⌘K search palette (components/CommandPalette.tsx) -------------------
  "palette.title": "Search",
  "palette.placeholder": "Search scenes, NPCs, locations …",
  "palette.results.aria": "Search results",
  "palette.empty": "Nothing found.",
  "palette.kind.area": "Area",

  // --- stale-bundle banner (components/UpdateBanner.tsx) -------------------
  "update.available": "New version available — reload",
  "update.reload": "Reload",

  // --- campaign edit dialog (campaign/CampaignEditAction.tsx) --------------
  "campaignEdit.title": "Edit campaign",
  "campaignEdit.description":
    "Name, description and text of the campaign. The chapter overview shows the text under the description. The campaign’s ID stays as it is.",
  "campaignEdit.field.name": "Name",
  "campaignEdit.field.description": "Description",
  "campaignEdit.field.description.placeholder": "One sentence that places the campaign",
  "campaignEdit.field.body": "Text",
  "campaignEdit.field.body.placeholder": "What holds for the whole campaign",
  "campaignEdit.unreachable": "Campaign not loadable — check the server",

  // --- body editor (components/BodyEditor.tsx) ------------------------------
  "bodyEditor.markdown.aria": "Markdown text of {path}",
  "bodyEditor.blocked": "One block still needs a decision — see the note on the block.",
  "bodyEditor.discard.title": "Discard changes?",
  "bodyEditor.discard.description":
    "The changes are not saved. Discarding closes the editor and shows what is stored again.",


  // --- entity-kind labels ---------------------------------------------------
  // ONE set for every place a kind is named to the DM: the ⌘K result rows
  // (lib/search.ts) and the title of an entity's dialog.
  // An unknown kind is shown verbatim — the wire value is the truth.
  "kind.scene": "Scene",
  "kind.npc": "NPC",
  "kind.location": "Location",
  "kind.chapter": "Chapter",
  "kind.campaign": "Campaign",
  "kind.session": "Session",
  "kind.glossary": "Glossary",
  "kind.itemPrice": "Item price",
  "markdown.ref.aria": "{kind}: {name}",


  // --- generator: input form (routes/generate.tsx, generator-job-state.ts) ---
  "generate.input.title.scene": "Generate scenes",
  "generate.input.title.npc": "Generate NPC",
  "generate.input.lead.scene":
    "English source material in, German scene drafts out. Always status draft, always with a check — nothing is written before you apply.",
  "generate.input.lead.npc":
    "Source material about a character in, one NPC in format out — wants, knows, relations. Always with a check; nothing is written before you apply.",
  "generate.input.modeGroup": "Generator mode",
  "generate.input.mode.scene": "Scenes",
  "generate.input.mode.npc": "NPC",
  "generate.input.npc.sourceLabel": "Source text",
  "generate.input.npc.sourcePlaceholder": "Bio, background, notes on the NPC …",
  "generate.input.npc.idLabel": "ID (optional)",
  "generate.input.npc.idPlaceholder": "e.g. grella",
  "generate.input.npc.idHint": "leave empty — then the model picks the ID",
  "generate.input.npc.idPreview": "will be created as: npcs/{id}",
  "generate.input.targetLabel": "Target chapter",
  "generate.input.newChapter": "New chapter",
  "generate.input.newTitleLabel": "Chapter title",
  "generate.input.newTitlePlaceholder": "Chapter title, e.g. The Smugglers' Cove",
  "generate.input.titleMissing": "Title missing — it becomes the new chapter's display name.",
  "generate.input.chapterIdLabel": "Chapter ID",
  "generate.input.chapterIdPlaceholder": "e.g. 03-schmugglerbucht",
  "generate.input.chapterIdSuggested": "suggested from the title",
  "generate.input.chapterIdPreview": "will be created as: chapters/{id}",
  "generate.input.chapterExists": "chapter exists — scenes are created in it",
  "generate.input.sourceLabel": "Source text (EN)",
  "generate.input.sourcePlaceholder":
    "Paste adventure text — paragraphs, boxed text, statblock references …",
  "generate.input.extend": "Extend existing NPCs and locations",
  "generate.input.extendHint":
    "The run may add what the source says about NPCs and locations that already exist. You review every change before it is written.",
  "generate.input.contextLabel": "Context sent along:",
  "generate.input.contextEntities":
    "{npcs, plural, one {# NPC} other {# NPCs}} \u00b7 {locations, plural, one {# location} other {# locations}}",
  "generate.input.knowledgeCount":
    "{count, plural, =0 {no campaign knowledge} one {# piece of campaign knowledge} other {# pieces of campaign knowledge}}",
  "generate.input.glossary": "glossary",
  "generate.input.noGlossary": "no glossary",
  "generate.input.submit.scene": "Generate drafts",
  "generate.input.submit.npc": "Generate NPC",

  // --- generator: the two id fields' own rules (generator-job-state.ts) ------
  "generate.input.chapterId.missing": "Chapter ID missing.",
  "generate.input.chapterId.slash": "No slashes — the chapter ID is a single segment.",
  "generate.input.chapterId.dots": "No “..” in the chapter ID.",
  "generate.input.chapterId.leadingDot": "No leading dot.",
  "generate.input.chapterId.space": "No spaces — separate words with a hyphen.",
  "generate.input.chapterId.charset": "Lowercase letters, digits and hyphens only.",
  "generate.input.npcId.slash": "No slashes — the ID is a single segment.",
  "generate.input.npcId.space": "No spaces — separate words with a hyphen.",
  "generate.input.npcId.charset":
    "Lowercase letters, digits and hyphens only; no hyphen at the start.",
  "generate.input.npcId.exists": "NPC already exists — an existing NPC is never overwritten.",

  // --- generator: the run's own errors (routes/generate.tsx) ---------------
  "generate.error.treeScene": "Chapters not loadable — start the Grimoire server on port 3000.",
  "generate.error.treeNpc": "Campaign not loadable — start the Grimoire server on port 3000.",
  "generate.error.lostJob": "The run is gone (server restart?) — start it again.",
  "generate.error.noApiKey": "ANTHROPIC_API_KEY missing — see server/.env",
  "generate.error.npcExists":
    "NPC already exists — pick another ID; an existing NPC is never overwritten.",
  "generate.error.chapterMissing": "Chapter not found — pick another target.",
  "generate.error.failed": "Not generated — check the server.",
  "generate.error.validation": "The model failed the format check — nothing generated.",
  "generate.error.unusable": "The model returned nothing usable — nothing generated.",
  "generate.error.validationHint":
    "Shorten the source text or structure it more clearly, then generate again.",
  "generate.error.rawReply": "Show unprocessed reply",

  // --- generator: working state (routes/generate.tsx) ----------------------
  "generate.working.title": "Generating drafts …",
  "generate.augment.title": "An augment run is open",
  "generate.augment.lead":
    "An augment run is reviewed where the augmented row lives. While it is open, no new run "
    + "starts here.",
  "generate.augment.open": "Go to the augment run",
  "generate.working.correction":
    "The server validates the reply mechanically; format errors go back to the model as a correction.",
  "generate.working.background":
    "Keeps running on the server — this tab may close. The result waits here until it is applied or discarded.",

  // --- generator: review (routes/generate.tsx, generator-job-state.ts) -------
  "generate.review.title": "Check drafts",
  // The NPC run reviews ONE proposed NPC, not a set of drafts.
  "generate.review.titleNpc": "Check the proposal",
  "generate.review.summary":
    "{scenes, plural, one {# scene} other {# scenes}} · {stubs, plural, one {# suggested NPC or location} other {# suggested NPCs and locations}}",
  "generate.review.pending": "{summary} · nothing written yet",
  "generate.review.pendingNpc": "1 NPC · nothing written yet",
  "generate.review.lead":
    "The review walks through the run in steps: first the new locations, then the new NPCs, then the scenes. Every proposal is decided on its own, and accepting one writes exactly that one — never overwriting.",
  "generate.review.leadNpc":
    "Check and adjust. Only “Apply” writes the NPC — existing NPCs are never overwritten.",
  "generate.review.conflicts": "These scenes, NPCs or locations already exist — nothing written:",
  "generate.review.conflictsNpc": "This NPC already exists — nothing written:",
  "generate.review.applyFailed": "Not written — check the server.",
  "generate.review.applyStale":
    "Not written — the run has moved on. Reloading the view.",
  "generate.review.discardFailed": "Not discarded — check the server.",
  "generate.review.applyNpc": "Apply",
  // --- generator: review state on the job ----------------------------------
  "generate.review.saving": "Saving …",
  "generate.review.saved": "Saved",
  "generate.review.saveConflict": "Changed in another tab — reloaded.",
  "generate.review.saveFailed": "Not saved — check the server.",
  "generate.review.progress": "{written} of {total} applied · the rest waits here",
  "generate.review.acceptOne": "Apply this one",
  "generate.review.partWritten": "Applied",
  "generate.review.drop": "Drop from the run",
  "generate.review.undrop": "Put back",
  "generate.review.applyScenes":
    "{count, plural, one {Apply the open scene} other {Apply the # open scenes}}",
  "generate.review.discardRest": "Discard the rest",
  "generate.review.allDecided": "Everything decided.",
  "generate.review.plannedScene": "Planned scene",
  "generate.review.contingency": "Contingency scene",
  "generate.review.statblock": "Statblock: {statblock}",
  "generate.review.propertiesHeading": "Properties",
  "generate.review.bodyHeading": "Text",
  "generate.review.bodyLabel": "Text of {path}",
  "generate.review.chapterDescription": "Chapter description",
  "generate.usage": "~{tokens} tokens · {attempts, plural, one {# attempt} other {# attempts}}",
  "generate.usage.group": ",",
  // --- generator: the pipeline ---------------------------------------------
  "generate.pipeline.cost": "~{tokens} tokens · {calls, plural, one {# call} other {# calls}}",
  "generate.pipeline.progress":
    "{done} of {total, plural, one {# scene} other {# scenes}} finished",
  "generate.pipeline.progressParts":
    "{done} of {total, plural, one {# part} other {# parts}} finished",
  "generate.pipeline.partRunning": "being written …",
  "generate.pipeline.partPending": "waiting",
  "generate.pipeline.partFailed": "not written",
  "generate.pipeline.retry": "Try again",
  "generate.pipeline.retryFailed": "Not restarted — check the server.",
  "generate.pipeline.retryConflict":
    "Not restarted — this part is already running or already finished. Reloading the view.",
  "generate.pipeline.partInvalid":
    "Failed the format check — the reply stayed malformed through the correction turns.",
  "generate.pipeline.partMissing":
    "Reported finished but no draft arrived — try this part again.",
  "generate.pipeline.stillRunning":
    "The run is not finished yet — whatever is here can already be accepted.",

  // --- generator: proposal rows (routes/generate.tsx) ---------------------
  "generate.stub.reason.run": "from this run",
  "generate.stub.reason.scene": "from {title}",
  "generate.stub.reason.scenes": "from {title} and others",
  "generate.stub.accept": "Accept",
  "generate.stub.reject": "Reject",
  "generate.stub.rejected": "Rejected",
  "generate.stub.acceptAnyway": "Accept after all",

  // --- generator: the stages of a scene run's review ------------------------
  "generate.stage.nav": "Steps of the review",
  "generate.stage.locations": "Locations",
  "generate.stage.npcs": "NPCs",
  "generate.stage.scenes": "Scenes",
  "generate.stage.decided": "{decided} of {total} decided",
  "generate.stage.locked":
    "The scenes come once every new location and every new NPC is decided.",
  "generate.stage.lead.locations":
    "The run proposes these new locations. Accept or reject each one — a scene can only be set at a location that exists.",
  "generate.stage.lead.npcs":
    "The run proposes these new NPCs. Accept or reject each one — a scene can only name an NPC that exists.",
  "generate.stage.lead.scenes":
    "Every new location and NPC is decided. Accepting a scene writes that scene and nothing else.",
  "generate.stage.open":
    "{count, plural, one {# proposal is still undecided.} other {# proposals are still undecided.}}",
  "generate.stage.next.npcs": "Continue to the NPCs",
  "generate.stage.next.scenes": "Continue to the scenes",
  "generate.stage.back.locations": "Back to the locations",
  "generate.stage.back.npcs": "Back to the NPCs",
  "generate.stage.extend.locations":
    "The run proposes changes to locations that already exist. Take or discard each change on its own — they do not hold up the scenes.",
  "generate.stage.extend.npcs":
    "The run proposes changes to NPCs that already exist. Take or discard each change on its own — they do not hold up the scenes.",

  // --- generator: changes a scene run proposes to an existing npc or location
  "generate.extension.reason.npc": "Changes to an existing NPC",
  "generate.extension.reason.location": "Changes to an existing location",
  "generate.extension.apply":
    "{count, plural, =0 {No change taken} one {Write the change} other {Write the # changes}}",
  "generate.extension.changes":
    "{count, plural, one {The proposed change} other {The # proposed changes}}",
  "generate.extension.taken":
    "{count, plural, one {{taken} of # change is taken.} other {{taken} of # changes are taken.}} They are written onto what is stored when you accept.",
  "generate.extension.unchanged.npc":
    "The source adds nothing to the NPC “{name}” — there is nothing to decide here.",
  "generate.extension.unchanged.location":
    "The source adds nothing to the location “{name}” — there is nothing to decide here.",

  // --- generator: a scene that names a rejected proposal --------------------
  "generate.incomplete.npc":
    "This scene names the NPC “{name}”, which you rejected — it does not exist, so the scene cannot be applied like this.",
  "generate.incomplete.location":
    "This scene is set at the location “{name}”, which you rejected — it does not exist, so the scene cannot be applied like this.",
  "generate.incomplete.acceptNpc": "Accept {name} after all",
  "generate.incomplete.removeNpc": "Remove {name} from the scene",
  "generate.incomplete.acceptLocation": "Accept {name} after all",
  "generate.incomplete.removeLocation": "Remove the location from the scene",
  "generate.incomplete.drop": "Drop the scene",

  // --- generator: what was written (routes/generate.tsx) ------------------
  "generate.written.title.scene": "Written — all as draft",
  "generate.written.title.npc": "Written — NPC created",
  "generate.written.hint.scene":
    "The scenes show up under their chapter with status “draft”. Existing scenes, NPCs and locations are never overwritten — on a conflict the server writes nothing.",
  "generate.written.hint.npc":
    "The NPC shows up in the NPC list and in search. Existing NPCs are never overwritten — on a conflict the server writes nothing.",
  "generate.written.openNpc": "Open NPC",
  "generate.written.toChapters": "To the chapters",


  // --- the markdown format's own vocabulary (markdown/callout-labels.ts holds the KEY
  //     per callout kind, markdown/Callout.tsx and markdown/Markdown.tsx show
  //     them; lib/block-labels.ts names the same blocks in the composer) -----------
  "markdown.callout.readaloud": "Read-aloud",
  "markdown.callout.check": "Check",
  "markdown.callout.secret": "Secret",
  "markdown.callout.outcome": "Outcome",
  "markdown.callout.loot": "Loot",
  "markdown.callout.note": "Note",
  "markdown.ifSection.prefix": "If:",
  "markdown.readaloud.copy": "Copy",
  "markdown.readaloud.copied": "Copied",
  "markdown.readaloud.copy.aria": "Copy read-aloud text",
  "markdown.readaloud.copied.aria": "Read-aloud text copied",
  "markdown.table.aria": "Table",

  // --- the Block-Composer (components/BlockComposer.tsx, @grimoire/shared/blocks,
  //     lib/composer.ts) ----------------------------------------------------
  "composer.mode.aria": "Edit mode",
  "composer.mode.blocks": "Blocks",
  "composer.mode.markdown": "Markdown",
  "composer.picker.title": "Insert block",
  "composer.picker.cancel.aria": "Cancel insert",

  "composer.blockType.ifSection": "If-section",
  "composer.blockType.heading": "Heading",
  "composer.blockType.text": "Text",
  "composer.blockType.markdown": "Markdown block",

  "composer.heading.level": "Level {depth}",
  "composer.heading.level.aria": "Heading level",
  "composer.heading.text.aria": "Heading text",
  "composer.heading.text.placeholder": "Flow",
  "composer.ifSection.condition.aria": "Condition of the if-section",
  "composer.ifSection.condition.placeholder": "they admit they work for Jorna",
  "composer.ifSection.hint":
    'Written as "## If: …" and collapsible in the reading view.',
  "composer.block.content.aria": "Content: {label}",
  "composer.block.text.placeholder": "Text of the block",
  "composer.block.markdown.placeholder": "Markdown",
  "composer.markdown.hint": "Markdown with its markers — taken over unchanged.",
  "composer.list.aria": "Blocks: {label}",
  "composer.empty": 'No blocks yet — add the first one with "+".',
  "composer.insert.aria": "Insert block at position {position}",
  "composer.insert.section.aria": "Insert block in the if-section at position {position}",
  "composer.card.name": "{label} {position}",
  "composer.card.moveUp.aria": "Move {name} up",
  "composer.card.moveDown.aria": "Move {name} down",
  "composer.card.collapse.aria": "Collapse {name}",
  "composer.card.edit.aria": "Edit {name}",
  "composer.card.delete.aria": "Delete {name}",
  "composer.summary.empty": "empty",
  "composer.issue.sectionEscape":
    'A "##" heading ends the if-section — use a deeper level (###) or move the block out of it.',

  // --- the raw-markdown editor (components/MarkdownEditor.tsx) --------------
  "editor.preview": "Preview",

  // --- scene article (components/SceneArticle.tsx) --------------------------
  "sceneArticle.type.planned": "Planned scene",
  "sceneArticle.type.contingency": "Contingency scene",
  "sceneArticle.trigger.inline": "If: {trigger}",
  "sceneArticle.trigger.label": "Trigger",
  "sceneArticle.tag": "#{tag}",
  "sceneArticle.handout": "Handout: {handout}",

  // --- edit mode of a reading view (components/EditMode.tsx, components/FieldChips.tsx)
  "editMode.changes": "{count, plural, one {# change} other {# changes}}",
  "editMode.chip.aria": "{field}: {value}",
  "editMode.chip.changedAria": "{field}: {value}, changed",
  "editMode.chip.unset": "not set",
  "editMode.allFields.chip": "All fields · {count}",
  "editMode.allFields.title": "All fields",
  "editMode.done": "Done",
  "editMode.blocked.fields": "A field cannot be saved like this — the marked chip says why.",
  "editMode.delete": "Delete",
  "editMode.delete.confirm": "Move to trash",
  "editMode.delete.deleting": "Moving to trash …",
  "editMode.delete.unsaved": "Your unsaved changes will be discarded.",
  "editMode.delete.done": "“{name}” is in the trash.",
  "editMode.delete.stale":
    "“{name}” was changed elsewhere in the meantime, so nothing was deleted. Cancel editing and open it again to see what is stored.",
  "editMode.delete.gone": "“{name}” was deleted elsewhere in the meantime.",
  "editMode.delete.failed": "Nothing was deleted. Check the server and try again.",
  "editMode.restore.failed":
    "“{name}” could not be restored and is still in the trash. You can restore “{name}” there yourself.",

  // --- edit mode of a scene (scene/SceneEditMode.tsx) ------------------------
  "sceneEdit.heading": "Edit scene",
  "sceneEdit.title.aria": "Scene title",
  "sceneEdit.blocked.title": "A scene needs a title.",
  "sceneEdit.trigger.placeholder": "When does the scene happen?",
  "sceneEdit.trigger.add": "Trigger",
  "sceneEdit.type.planned.hint": "stands in the chapter's order",
  "sceneEdit.type.contingency.hint": "happens when something occurs",
  "sceneEdit.location.none": "No location",
  "sceneEdit.location.search": "Search locations",
  "sceneEdit.location.noMatch": "No location matches the search.",
  "sceneEdit.npcs.title": "NPCs in this order",
  "sceneEdit.handouts.title": "Handouts in Roll20",
  "sceneEdit.delete.title": "Delete this scene?",
  "sceneEdit.delete.description":
    "“{title}” goes to the trash. The scene stays there for {days} days, and until then you can restore it.",

  // --- edit mode of an npc (npc/NpcEditMode.tsx, components/FieldSection.tsx)
  "npcEdit.heading": "Edit NPC",
  "npcEdit.name.aria": "NPC name",
  "npcEdit.blocked.name": "An NPC needs a name.",
  "npcEdit.chapter.none": "No chapter",
  "npcEdit.profile.title": "Profile",
  "npcEdit.profile.empty": "The profile is still empty.",
  "npcEdit.delete.title": "Delete this NPC?",
  "npcEdit.delete.description":
    "“{name}” goes to the trash. The NPC stays there for {days} days, and until then you can restore it.",

  // --- edit mode of a location (location/LocationEditMode.tsx) --------------
  "locationEdit.heading": "Edit location",
  "locationEdit.name.aria": "Location name",
  "locationEdit.blocked.name": "A location needs a name.",
  "locationEdit.chapter.none": "No chapter",
  "locationEdit.atmosphere.empty": "The atmosphere is not described yet.",
  "locationEdit.delete.title": "Delete this location?",
  "locationEdit.delete.description":
    "“{name}” goes to the trash. The location stays there for {days} days, and until then you can restore it.",

  // --- edit mode of a chapter (chapter/ChapterEditMode.tsx) ----------------
  "chapterEdit.heading": "Edit chapter",
  "chapterEdit.title.aria": "Chapter title",
  "chapterEdit.blocked.title": "A chapter needs a title.",
  "chapterEdit.activate.hint":
    "Saving makes this chapter the active one — the chapter that was active until now goes back to planned.",
  "chapterEdit.delete.title": "Delete this chapter?",
  "chapterEdit.delete.description":
    "“{title}” goes to the trash. The chapter stays there for {days} days, and until then you can restore it.",
  "chapterEdit.delete.along.both":
    "Its {scenes, plural, one {# scene} other {# scenes}} and its {threads, plural, one {# storyline} other {# storylines}} go with it and come back with it.",
  "chapterEdit.delete.along.scenes":
    "{scenes, plural, one {Its # scene goes with it and comes back with it.} other {Its # scenes go with it and come back with it.}}",
  "chapterEdit.delete.along.threads":
    "{threads, plural, one {Its # storyline goes with it and comes back with it.} other {Its # storylines go with it and come back with it.}}",

  // --- the aside cards (npc/NpcCard.tsx, location/LocationCard.tsx) ---------
  "npcCard.noId": "{id} is not an NPC ID, so there is no NPC for it.",
  "npcCard.unloadable": "{id} — NPC not loadable, check the server.",
  "npcCard.will.inline": "Wants:",
  "npcCard.will": "Wants",
  "npcCard.voice": "Voice",
  "locationCard.unloadable": "{id} — location not loadable, check the server.",
  "locationCard.roll20": "Roll20 page: {value}",

  // --- hover preview of a `[[ref]]` (components/RefTargetPreview.tsx) --------
  // Everything else it says comes from the shared labels: `kind.*`,
  // `status.*`, `sceneArticle.type.*`, `sceneArticle.trigger.label`,
  // `npcCard.will.inline` and `locationCard.roll20`. Only the scene's
  // location row has a label of its own.
  "refPreview.scene.location": "Location",

  // --- npc and location reading views (npc/NpcArticle.tsx,
  //     location/LocationArticle.tsx) ------------------------------------------
  "entity.npc.statblock": "Statblock: {value}",
  "entity.location.roll20": "Roll20 page: {value}",

  // --- the DEV markdown harness ("/dev/markdown", routes/harness.tsx) -------
  "harness.title": "Markdown harness",
  "harness.lead": "Renders the reference fixtures from fixtures/ without a running server.",
  "harness.properties": "Show properties",


  // --- "Augment with AI" (generator-job/AugmentAction.tsx) -----------------
  "augment.action": "Augment with AI",
  "augment.action.running": "AI is augmenting …",
  "augment.action.ready": "Review the proposal",
  "augment.action.failed": "Augmenting failed",
  "augment.title": "Augment with AI",
  "augment.description":
    "Source text and/or an instruction — the AI augments {name}. Nothing is overwritten "
    + "until you accept it.",
  "augment.description.running": "The AI is augmenting {name}.",
  "augment.description.review": "Proposal for {name} — you decide every spot yourself.",
  "augment.announce.running": "The run is going.",
  "augment.announce.ready": "The proposal is ready.",
  "augment.source.label": "Source text (EN)",
  "augment.source.placeholder": "A section from the adventure, notes, background …",
  "augment.instruction.label": "Instruction (optional)",
  "augment.instruction.placeholder": "e.g. Introduce a new storyline",
  "augment.input.hint": "At least one of the two is needed.",
  "augment.start": "Augment",
  "augment.starting": "Starting …",
  "augment.start.failed": "Run not started — check the server.",
  "augment.running":
    "Running on the server. You can close this dialog and keep working: the bar at the top "
    + "shows when the proposal is ready and brings you back here with one click.",
  "augment.busy": "Another AI run is going. Wait for it, or discard it there.",
  "augment.busy.review":
    "Another AI run is still waiting for your review. Accept or discard it first, "
    + "because a new run would delete it.",
  "augment.busy.open": "Go to the other run",
  "augment.discard": "Discard run",
  "augment.discard.failed": "Could not discard the run — check the server.",

  // the review
  "augment.properties.heading": "Properties",
  "augment.properties.none": "No change to the properties proposed.",
  "augment.field.current": "Current",
  "augment.field.proposed": "Proposed",
  "augment.field.empty": "empty",
  "augment.body.heading": "Text",
  "augment.body.modeGroup": "Proposal view",
  "augment.body.blocks": "Blocks",
  "augment.body.markdown": "Markdown",
  "augment.body.none": "No change to the text proposed.",
  "augment.body.showUnchanged": "Show unchanged blocks",
  "augment.body.hideUnchanged": "Hide unchanged blocks",
  "augment.state.new": "New",
  "augment.state.changed": "Changed",
  "augment.state.removed": "Dropped",
  "augment.decision.aria": "Take or discard the change",
  "augment.decision.take": "Take change",
  "augment.decision.keep": "Discard change",
  "augment.decision.takeUnit": "Take change: {label}",
  "augment.decision.keepUnit": "Discard change: {label}",
  "augment.diff.added": "added",
  "augment.diff.removed": "removed",
  "augment.diff.changed": "changed",
  "augment.review.aria": "Check the proposal",
  "augment.accept": "Accept",
  "augment.reject": "Discard proposal",

};
