// The English catalog (issue #69). Typed as `Messages`, so it is complete by
// construction: a missing key and a key that only exists here both fail the
// typecheck.
//
// DM vocabulary, not a literal translation: Session · Scene · Chapter ·
// Location · Session review (Nachbereitung) · Read-aloud (Vorlesen) · Handout. Ids and
// frontmatter keys stay as they are on the wire — `id`, `active`, `insight +2`
// are data, not copy.

import type { Messages } from "./messages";

export const en: Messages = {
  // --- shared verbs ---------------------------------------------------------
  "common.cancel": "Cancel",
  "common.discard": "Discard",
  "common.save": "Save",
  "common.saving": "Saving …",
  "common.create": "Create",
  "common.creating": "Creating …",
  "common.serverDown":
    "Server unreachable — start the Grimoire server on port 3000.",

  // --- language switch ------------------------------------------------------
  "language.heading": "Language",
  "language.de": "Deutsch",
  "language.en": "English",

  // --- topbar ---------------------------------------------------------------
  "topbar.brand": "Grimoire",
  "topbar.nav.aria": "Chapters, NPCs and locations",
  "topbar.nav.chapters": "Chapters",
  "topbar.nav.npcs": "NPCs",
  "topbar.nav.locations": "Locations",
  "topbar.search": "Search …",
  "topbar.generator": "Generator",
  "topbar.generator.running": "Generating …",
  "topbar.generator.progress": "{written} of {total} applied",
  "topbar.review.pending": "Session review · {count} open",
  "topbar.review.pendingShort": "{count} open",
  "topbar.session.back": "To the session",

  // --- campaign switcher ----------------------------------------------------
  "campaign.switcher.current": "Campaign: {name}",
  "campaign.switcher.empty": "No campaigns yet.",

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
    "The goal is optional and appears in the chapter as the “Ziel des Kapitels” section.",
  "create.chapter.nameLabel": "Title",
  "create.chapter.namePlaceholder": "Chapter title",
  "create.chapter.goalLabel": "Goal of the chapter (optional)",
  "create.chapter.goalPlaceholder": "What the party is meant to achieve here",

  "create.scene.title": "Create scene",
  "create.scene.description":
    "The scene is created as a draft in this chapter and opens straight in the editor.",
  "create.scene.nameLabel": "Title",
  "create.scene.namePlaceholder": "Scene title",

  "create.npc.title": "Create NPC",
  "create.npc.description":
    "Just the name — role, status and everything else follow in the properties dialog.",
  "create.npc.nameLabel": "Name",
  "create.npc.namePlaceholder": "NPC name",

  "create.location.title": "Create location",
  "create.location.description":
    "Just the name — everything else follows in the properties dialog.",
  "create.location.nameLabel": "Name",
  "create.location.namePlaceholder": "Location name",

  // --- cold start -----------------------------------------------------------
  "home.opening": "Opening the campaign …",
  "coldstart.title": "Welcome to Grimoire",
  "coldstart.lead":
    "No campaign yet. Create one — chapters and scenes come into being inside it afterwards.",

  // --- properties dialog ----------------------------------------------------
  "properties.action": "Properties",
  "properties.title": "{kind}: properties",
  "properties.description":
    "Every property of this entry. Only what you changed is saved — everything else stays exactly as it is.",
  "properties.id": "id",
  "properties.id.viaRename": " · below via “Change id”",
  "properties.changeId": "Change id",
  "properties.discard.title": "Discard changes?",
  "properties.discard.close":
    "The changed properties are not saved. Discarding closes the dialog and leaves the entry as it is stored.",
  "properties.discard.rename":
    "The changed properties are not saved. Discarding opens the id change and leaves the entry as it is stored.",
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
  "properties.ref.new": "New — will be created on save.",
  "properties.ref.locationNew": 'New — will be created as location “{name}”.',
  "properties.issue.locationUnusable":
    'Not a usable name — “{value}” yields no location id.',
  "properties.issue.notAnId": "“{id}” is not an id — lowercase letters, digits and hyphens only.",
  "properties.issue.namelessRow": "Row without a name — add a name or remove the row.",
  "properties.issue.duplicateName": "Name “{name}” twice — every name may appear only once.",

  "properties.scene.title.label": "Title",
  "properties.scene.type.label": "Type",
  "properties.scene.type.planned": "planned scene",
  "properties.scene.type.contingency": "contingency scene",
  "properties.scene.trigger.label": "Trigger",
  "properties.scene.trigger.hint": "Contingency scenes only: when does the scene fire?",
  "properties.scene.chapter.label": "Chapter",
  "properties.scene.location.label": "Location",
  "properties.scene.location.hint":
    "A location from the list or a new name — the chapter groups the scene under it.",
  "properties.scene.npcs.label": "NPCs",
  "properties.scene.npcs.hint": "Ids only — unknown ones are created on save.",
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

  "properties.location.name.label": "Name",
  "properties.location.chapter.label": "Chapter",
  "properties.location.roll20.label": "Roll20 page",
  "properties.location.roll20.hint": "A reference to the page, not a copy of the map.",

  "properties.chapter.title.label": "Title",
  "properties.chapter.status.label": "Status",
  "properties.chapter.status.placeholder": "active",
  "properties.chapter.status.hint":
    "The value active marks the chapter the session view opens.",

  // --- rename dialog --------------------------------------------------------
  "rename.title": "{kind}: change id",
  "rename.description":
    "The new id takes every reference with it: properties, session log and relationship lists. Mentions in running text stay untouched.",
  "rename.newId.label": "new id (currently {oldId})",
  "rename.preview": "Preview",
  "rename.previewing": "Checking …",
  "rename.commit": "Rename",
  "rename.committing": "Renaming …",

  "rename.kind.npc": "NPC",
  "rename.kind.location": "Location",
  "rename.kind.scene": "Scene",
  "rename.kind.chapter": "Chapter",

  "rename.error.unchanged": "Unchanged — that is already the current id.",
  "rename.error.slug": "An id needs lowercase letters, digits and single hyphens.",
  "rename.error.reserved":
    "“npcs”, “locations” and “sessions” are reserved names.",
  "rename.failed": "Rename failed — check the server.",
  "rename.conflict.ambiguous": "Several entries claim this id — a conflict in the database.",
  "rename.conflict.path": "{path} already exists — pick another id.",
  "rename.notFound": "Not found — reload the view.",
  "rename.badId": "id rejected — lowercase letters, digits and single hyphens.",

  "rename.changed": "affects {count, plural, one {# entry} other {# entries}}",
  "rename.usage.total": "{count, plural, one {# use} other {# uses}}",
  "rename.usage.none": "No references — nothing hangs off this id.",
  "rename.usage.sceneNpcs": "{count, plural, one {# scene} other {# scenes}}",
  "rename.usage.npcRelations": "{count, plural, one {# relationship} other {# relationships}}",
  "rename.usage.sceneLocation": "{count, plural, one {# scene} other {# scenes}}",
  "rename.usage.scenesPlayed": "{count, plural, one {# session entry} other {# session entries}}",
  "rename.usage.logEntries": "{count, plural, one {# log line} other {# log lines}}",
  "rename.usage.chapterScenes": "{count, plural, one {# scene} other {# scenes}}",
  "rename.usage.chapterNpcs": "{count, plural, one {# NPC} other {# NPCs}}",
  "rename.usage.chapterLocations": "{count, plural, one {# location} other {# locations}}",
  "rename.usage.bodyRefs": "{count, plural, one {# passage} other {# passages}}",

  // --- settings page (/settings) --------------------------------------------
  "settings.title": "Settings",
  "settings.lead":
    "Settings for this Grimoire instance. Changes take effect at once and live on the server.",
  "settings.language.heading": "Language",
  "settings.language.hint": "Language of the interface. Applies to this instance, not to the campaign data.",

  // --- the two campaign-content pages (issue #53) --------------------------
  "entryList.loading": "Loading the list …",
  "entryList.loadFailed": "List not loaded — reload the page.",
  "entryList.saveFailed": "Not saved.",
  "entryList.saving": "Saving …",
  "entryList.saved": "Saved",
  "entryList.moveUp": "Move up",
  "entryList.moveDown": "Move down",
  "entryList.edit": "Edit “{name}”",
  "entryList.remove": "Delete \u201c{name}\u201d",
  "entryList.removed": "Entry deleted",
  "entryList.reload": "Reload",
  "entryList.applyDraft": "Keep the draft and apply it to the current list",
  "entryList.confirmDelete.title": "Delete this entry?",
  "entryList.confirmDelete.body": "\u201c{name}\u201d will be removed from the list. This cannot be undone.",
  "entryList.confirmDelete.confirm": "Delete",

  "knowledge.title": "Campaign knowledge",
  "knowledge.lead":
    "Naming conventions, facts and style rules of this campaign. Travels with every generator run and is binding \u2014 even when the source material says otherwise. The order here is the order in the prompt. References like [[fenn]] are resolved to the name.",
  "knowledge.filter": "Filter the knowledge",
  "knowledge.empty":
    "No campaign knowledge yet \u2014 add the first entry (a naming convention, say).",
  "knowledge.noMatch": "No entry matches the filter.",
  "knowledge.add": "New entry",
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

  "lookup.heading": "Look up",

  // --- server error bodies (code -> sentence, see i18n/server-errors.ts) ----
  "server.slug_taken": '{kind} “{id}” already exists — suggestion: “{suggestion}”',
  "server.slug_reserved": '“{id}” is a reserved name — suggestion: “{suggestion}”',
  "server.slug_empty": "{field} yields no id — please use letters or digits.",
  "server.location_not_an_id":
    'Location “{value}” is not a location id — use “{suggestion}”; the entry is created for you.',
  "server.location_not_an_id.noSuggestion":
    'Location “{value}” is not a location id — please use lowercase letters, digits and dashes.',
  "server.glossary_duplicate_term":
    'Glossary term “{term}” appears more than once — please merge the entries.',
  "server.session_running": "An older session is still running — end it first.",
  "server.session_not_empty": "This session has content — end it instead of discarding it.",
  "server.rev_conflict": "Changed elsewhere in the meantime — reload before saving.",
  "server.job_restarted": "The server was restarted while the job was running — start it again.",
  "server.llm_truncated":
    "The model's reply was cut off — raise LLM_MAX_TOKENS (currently: {max}) or shorten the source text.",
  "server.llm_invalid": "The reply did not pass the mechanical validation.",
  "server.llm_truncated.defaultCap": "the endpoint default",

  "server.kind.entry": "The entry",
  "server.kind.campaign": "Campaign",
  "server.kind.chapter": "Chapter",
  "server.kind.scene": "Scene",
  "server.kind.npc": "NPC",
  "server.kind.location": "Location",
  "server.field.name": "The name",
  "server.field.title": "The title",


  // --- status enum labels (lib/scene-status.ts, lib/entity.ts) --------------
  "status.scene.ready": "ready",
  "status.scene.draft": "draft",
  "status.scene.played": "played",
  "status.scene.dropped": "dropped",
  "status.npc.alive": "alive",
  "status.npc.dead": "dead",
  "status.npc.missing": "missing",
  "status.npc.unknown": "unknown",

  // --- browse list pages (/:campaign/list/:kind) ---------------------------
  "browse.title.scenes": "Scenes",
  "browse.title.npcs": "NPCs",
  "browse.title.locations": "Locations",


  // --- the shared write layer (lib/write-with-rev.ts, lib/use-rev-write.ts) -
  "write.stale": "Changed in the meantime — reload",
  "write.failed": "Not saved — check the server",
  "write.properties.failed": "Properties not saved — check the server",
  "write.status.failed": "Status not saved — check the server",
  "status.change.aria": "Change status, currently {current}",
  "status.sceneUnloadable": "Scene not loadable",


  // --- the scene pool ("/:campaign", routes/pool.tsx) -----------------------
  "pool.loading": "Loading scenes …",
  "pool.empty":
    "No chapters yet. A chapter is the bracket around scenes — the first scene goes inside one.",
  "pool.chapterCount": "{count, plural, one {# chapter} other {# chapters}}",
  // The chapter's leftovers section: the scenes that name no location (#100).
  "pool.group.noLocation": "No location",
  "pool.sceneCount": "{count, plural, =0 {no scenes} one {# scene} other {# scenes}}",
  "pool.chapter.goal": "Goal: {goal}",
  "pool.chapter.empty": "No scenes in this chapter yet.",
  "pool.chapter.status.active": "active",
  "pool.contingencies.hint": "only when the trigger fires",
  "pool.scene.trigger": "When: {trigger}",

  // --- browse list pages (routes/browse.tsx) --------------------------------
  "browse.fallbackTitle": "Look up",
  "browse.unknown": "No such list.",
  "browse.loading": "Loading …",
  "browse.empty.scenes": "No scenes yet.",
  "browse.empty.npcs": "No NPCs yet.",
  "browse.empty.locations": "No locations yet.",

  // --- the reading view ("/:campaign/file/*", routes/scene.tsx) -------------
  "scene.loading": "Loading entry …",
  "scene.notLoadable": "Entry not loadable — check the path or start the server.",
  "scene.npcs.heading": "NPCs in this scene",

  // --- context line + mobile back row ---------------------------------------
  "context.aria": "Context",
  "mobileBack.pool": "Chapters",


  // --- shared scene-group headings (routes/live.tsx + routes/pool.tsx) ------
  // Neutral prefix on purpose: the live nav and the pool list show the SAME
  // two group headings — one key, not one per view.
  "scene.planned.heading": "Planned",
  "scene.contingencies.heading": "Contingency scenes",

  // --- live mode (routes/live.tsx) ------------------------------------------
  // Below md there is no live mode (UI-BRIEF §4) — just the pointer.
  "live.mobile.note": "The session view is made for the desktop.",
  "live.mobile.read": "Read scene: {title}",

  "live.nav.aria": "Scenes of the session",
  "live.nav.noPlanned": "No planned scenes in this chapter.",
  // The collapsed group of scenes that are behind us (issue #73): the heading
  // alone names the group for a screen reader, `playedGroup` is the visible
  // trigger where the count is PART of the sentence.
  "live.nav.played": "Played",
  "live.nav.playedGroup": "Played {count}",

  "live.scene.none":
    "No scene in the active chapter — create scenes on the chapters page.",
  "live.scene.loading": "Loading scene …",
  "live.scene.unloadable": "Scene not loadable — check the path.",
  "live.scene.locationHeading": "Location",
  "live.scene.npcsHeading": "NPCs",
  "live.scene.noNpcs": "No NPCs in this scene.",

  "live.log.heading": "Log",
  "live.log.empty": "No entries yet — the quick note below lands here.",
  "live.note.aria": "Quick note",
  "live.note.placeholder": "Quick note … #thread #npc #loot",
  "live.note.hint": "Enter sends · time and scene are set automatically",
  "live.note.failed": "Note not saved — check the server.",

  "live.session.loading": "Loading session …",
  "live.session.unloadable": "Session not loadable — check the server and reload.",
  "live.session.none": "No session is running.",
  // The one start conflict the live route turns into a question: an OLDER
  // session nobody ended. One sentence per variant — the path is a parameter,
  // never a fragment between two halves.
  "live.session.olderRunning": "An older session is still running — end it first.",
  "live.session.olderRunning.withPath": "An older session is still running ({path}) — end it first.",
  "live.session.endOld": "End the old session",

  // The "For the players" reminder list of the aside (issue #86).
  "live.pc.heading": "For the players",
  "live.pc.done": "Mark \u201c{text}\u201d done",
  "live.pc.allDone": "All done.",
  "live.pc.failed": "Not saved — check the server.",

  // --- live detail drawer (components/LiveEntityDrawer.tsx) -----------------
  "live.drawer.loading": "Loading details …",
  "live.drawer.unloadable": "Not loadable — check {path}.",
  "live.drawer.open": "Open entry",


  // --- review (the session review, formerly the "five-minute harvest" —
  // issue #10; the harvest metaphor stayed in the code, not in the UI)
  // routes/review.tsx, lib/use-review.ts ------------------------------------
  "review.title": "Session review",
  "review.sessionFailed": "Session not loadable — check the server and reload.",
  "review.noSession": "There is no session to review.",
  "review.backToPool": "Back to the chapters",
  "review.lead":
    "Go through the entries of the session — adopt as a storyline, create an NPC or discard. The rest stays in the log.",
  // Topbar and the mobile page read the same line (two parameters, #69).
  "review.progress": "{seen} of {total} reviewed",
  "review.hashUnavailable":
    "Reviewed state of the log lines unavailable — open Grimoire via localhost or https.",
  "review.loading": "Loading entries …",
  "review.empty": "No tagged entries in this session — nothing to review.",

  // The card's source chip — the scene travels INSIDE the sentence.
  "review.source.log": "Log",
  "review.source.logScene": "Log · {scene}",
  "review.source.inbox": "Idea",

  "review.action.thread": "Adopt as storyline",
  "review.action.resolve": "Done",
  "review.action.failed": "Action not saved — check the server.",
  "review.npc.failed": "NPC not created — check the server.",

  // The done row: the action of THIS sitting, or the neutral fallback after a
  // reload (the server only stores done/not-done).
  "review.done.thread": "Adopted as storyline",
  "review.done.npc": "NPC created",
  "review.done.dismiss": "Discarded",
  "review.done.resolved": "Done",
  "review.done.seen": "reviewed",

  "review.notes.title": "Untagged entries",
  "review.notes.lead":
    "Untagged entries from the ideas — adopt them, create an NPC or tick them off.",

  // Player-character notes (issue #86): `#pc` lines from log and inbox.
  "review.pc.title": "Player characters",
  "review.pc.lead":
    "Entries tagged #pc — reminders for the table, not campaign content. Tick them off or keep them for the next review.",
  "review.pc.groupTag": "#{tag}",
  "review.pc.groupGeneral": "General",
  "review.action.keep": "Keep",
  "review.action.keepHint": "Stays open for the next review.",

  "review.threads.title": "Open storylines of the chapter",
  "review.threads.empty": "No open storylines in this chapter yet.",
  "review.threads.new": "new",
  "review.finish": "Done — back to the chapters",

  // --- NPC stub dialog of the review (components/NpcCreateDialog.tsx) -------
  // `status: unknown` and `## Notizen` are FORMAT tokens on the wire (README),
  // so they stand verbatim in both languages.
  "npcCreate.description":
    "Creates the NPC entry with status: unknown; the text lands under ## Notizen. If the id already exists, the existing entry is linked instead.",
  "npcCreate.idLabel": "id (appears in the path)",
  "npcCreate.idPlaceholder": "npc-id",
  "npcCreate.nameLabel": "Name (optional)",


  // --- shared verbs: ADD to the existing common block --------------------
  "common.edit": "Edit",

  // --- mobile start surface (routes/mobile-start.tsx) ----------------------
  "mobileStart.search": "Search scenes, NPCs, locations …",
  "mobileStart.count.scenes": "{count, plural, one {# scene} other {# scenes}}",
  "mobileStart.count.npcs": "{count, plural, one {# NPC} other {# NPCs}}",
  "mobileStart.count.locations": "{count, plural, one {# location} other {# locations}}",
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
  "palette.kind.page": "Page",

  // --- stale-bundle banner (components/UpdateBanner.tsx) -------------------
  "update.available": "New version available — reload",
  "update.reload": "Reload",

  // --- campaign metadata dialog (components/CampaignMetaAction.tsx) --------
  "campaignMeta.title": "Edit campaign",
  "campaignMeta.description":
    "Name and description live in _campaign. The id stays as it is — it is part of every address and does not change here.",
  "campaignMeta.field.name": "Name",
  "campaignMeta.field.description": "Description",
  "campaignMeta.field.description.placeholder": "One sentence that places the campaign",
  "campaignMeta.unreachable": "Campaign not loadable — check the server",

  // --- body editor (components/FileBodyEditor.tsx) -------------------------
  "bodyEditor.raw.aria": "Markdown text of {path}",
  "bodyEditor.hint": "The body only — the properties stay unchanged.",
  "bodyEditor.blocked": "One block still needs a decision — see the note on the block.",
  "bodyEditor.discard.title": "Discard changes?",
  "bodyEditor.discard.description":
    "The changes are not saved. Discarding closes the editor and shows the entry as it is stored again.",


  // --- entity-kind labels ---------------------------------------------------
  // ONE set for every place a kind is named to the DM: the ⌘K result rows
  // (lib/search.ts) and the properties dialog's title (lib/properties-form.ts).
  // An unknown kind is shown verbatim — the wire value is the truth.
  "kind.scene": "Scene",
  "kind.npc": "NPC",
  "kind.location": "Location",
  "kind.chapter": "Chapter",
  "kind.campaign": "Campaign",
  "markdown.ref.aria": "{kind}: {name}",


  // --- generator: input form (routes/generate.tsx, lib/generate.ts) --------
  "generate.input.title.scene": "Generate scenes",
  "generate.input.title.npc": "Generate NPC",
  "generate.input.lead.scene":
    "English source material in, German scene drafts out. Always status draft, always with a check — nothing is written before you apply.",
  "generate.input.lead.npc":
    "Source material about a character in, one NPC entry in format out — wants, knows, relations. Always with a check; nothing is written before you apply.",
  "generate.input.modeGroup": "Generator mode",
  "generate.input.mode.scene": "Scenes",
  "generate.input.mode.npc": "NPC",
  "generate.input.npc.sourceLabel": "Source text",
  "generate.input.npc.sourcePlaceholder": "Bio, background, notes on the NPC …",
  "generate.input.npc.idLabel": "id (optional)",
  "generate.input.npc.idPlaceholder": "e.g. grella",
  "generate.input.npc.idHint": "leave empty — then the model picks the id",
  "generate.input.npc.idPreview": "will be created as: npcs/{id}",
  "generate.input.targetLabel": "Target chapter",
  "generate.input.newChapter": "New chapter",
  "generate.input.newTitleLabel": "Chapter title",
  "generate.input.newTitlePlaceholder": "Chapter title, e.g. The Smugglers' Cove",
  "generate.input.titleMissing": "Title missing — it becomes the new chapter's display name.",
  "generate.input.chapterIdLabel": "Chapter id",
  "generate.input.chapterIdPlaceholder": "e.g. 03-schmugglerbucht",
  "generate.input.chapterIdSuggested": "suggested from the title",
  "generate.input.chapterIdPreview": "will be created as: {id}/",
  "generate.input.chapterExists": "chapter exists — scenes are created in it",
  "generate.input.sourceLabel": "Source text (EN)",
  "generate.input.sourcePlaceholder":
    "Paste adventure text — paragraphs, boxed text, statblock references …",
  "generate.input.contextLabel": "Context sent along:",
  "generate.input.contextEntities":
    "{npcs, plural, one {# NPC} other {# NPCs}} \u00b7 {locations, plural, one {# location} other {# locations}}",
  "generate.input.knowledgeCount":
    "{count, plural, =0 {no campaign knowledge} one {# knowledge entry} other {# knowledge entries}}",
  "generate.input.glossary": "glossary",
  "generate.input.noGlossary": "no glossary",
  "generate.input.submit.scene": "Generate drafts",
  "generate.input.submit.npc": "Generate NPC",

  // --- generator: the two id fields' own rules (lib/generate.ts) -----------
  "generate.input.chapterId.missing": "Chapter id missing.",
  "generate.input.chapterId.slash": "No slashes — the chapter id is a single segment.",
  "generate.input.chapterId.dots": "No “..” in the chapter id.",
  "generate.input.chapterId.leadingDot": "No leading dot.",
  "generate.input.chapterId.space": "No spaces — separate words with a hyphen.",
  "generate.input.chapterId.charset": "Lowercase letters, digits and hyphens only.",
  "generate.input.chapterId.reserved":
    "“npcs”, “locations” and “sessions” are reserved — not a chapter name.",
  "generate.input.npcId.slash": "No slashes — the id is a single segment.",
  "generate.input.npcId.space": "No spaces — separate words with a hyphen.",
  "generate.input.npcId.charset":
    "Lowercase letters, digits and hyphens only; no hyphen at the start.",
  "generate.input.npcId.exists": "NPC already exists — existing entries are never overwritten.",

  // --- generator: the run's own errors (routes/generate.tsx) ---------------
  "generate.error.treeScene": "Chapters not loadable — start the Grimoire server on port 3000.",
  "generate.error.treeNpc": "Campaign not loadable — start the Grimoire server on port 3000.",
  "generate.error.lostJob": "The run is gone (server restart?) — start it again.",
  "generate.error.noApiKey": "ANTHROPIC_API_KEY missing — see server/.env",
  "generate.error.npcExists":
    "NPC already exists — pick another id; existing entries are never overwritten.",
  "generate.error.chapterMissing": "Chapter not found — pick another target.",
  "generate.error.failed": "Not generated — check the server.",
  "generate.error.validation": "The model failed the format check — nothing generated.",
  "generate.error.unusable": "The model returned nothing usable — nothing generated.",
  "generate.error.validationHint":
    "Shorten the source text or structure it more clearly, then generate again.",
  "generate.error.rawReply": "Show unprocessed reply",

  // --- generator: working state (routes/generate.tsx) ----------------------
  "generate.working.title": "Generating drafts …",
  "generate.working.correction":
    "The server validates the reply mechanically; format errors go back to the model as a correction.",
  "generate.working.background":
    "Keeps running on the server — this tab may close. The result waits here until it is applied or discarded.",

  // --- generator: review (routes/generate.tsx, lib/generate.ts) -----------
  "generate.review.title": "Check drafts",
  // The NPC run reviews ONE suggested entry, not a set of drafts (#88).
  "generate.review.titleNpc": "Check the proposal",
  "generate.review.summary":
    "{scenes, plural, one {# scene} other {# scenes}} · {stubs, plural, one {# suggested entry} other {# suggested entries}}",
  "generate.review.pending": "{summary} · nothing written yet",
  "generate.review.pendingNpc": "1 NPC · nothing written yet",
  "generate.review.lead":
    "Check, adjust, decide the suggested entries one by one. Only “Apply” writes to the database — as drafts, never overwriting.",
  "generate.review.leadNpc":
    "Check and adjust. Only “Apply” writes the entry — existing NPCs are never overwritten.",
  "generate.review.stubsHeading": "Suggested entries — decide one by one",
  // --- naming hints of the post-run check (issue #53 AK3) -------------------
  "generate.review.namingHeading":
    "{count, plural, one {# naming hint} other {# naming hints}} — not a blocker",
  "generate.review.namingHint": '“{from}” is still there — the convention says “{to}”',
  "generate.review.namingWhereBody": "{path}, line {line}",
  "generate.review.namingWhereField": "{path}, field {field}",
  "generate.review.conflicts": "These entries already exist — nothing written:",
  "generate.review.conflictsNpc": "This entry already exists — nothing written:",
  "generate.review.applyFailed": "Not written — check the server.",
  "generate.review.applyStale":
    "Not written — the run has moved on. Reloading the view.",
  "generate.review.discardFailed": "Not discarded — check the server.",
  "generate.review.apply": "Apply ({count})",
  "generate.review.applyNpc": "Apply",
  // --- generator: review state on the job (issue #97) ----------------------
  "generate.review.saving": "Saving …",
  "generate.review.saved": "Saved",
  "generate.review.saveConflict": "Changed in another tab — reloaded.",
  "generate.review.saveFailed": "Not saved — check the server.",
  "generate.review.progress": "{written} of {total} applied · the rest waits here",
  "generate.review.acceptOne": "Apply this one",
  "generate.review.partWritten": "Applied",
  "generate.review.drop": "Drop from the run",
  "generate.review.undrop": "Put back",
  "generate.review.applyRest": "Apply the rest ({count})",
  "generate.review.discardRest": "Discard the rest",
  "generate.review.allDecided": "Everything decided.",
  "generate.review.plannedScene": "Planned scene",
  "generate.review.contingency": "Contingency scene",
  "generate.review.statblock": "Statblock: {statblock}",
  "generate.review.rawLabel": "Markdown of {title}",
  "generate.usage": "~{tokens} tokens · {attempts, plural, one {# attempt} other {# attempts}}",
  "generate.usage.group": ",",
  // --- generator: the pipeline (issue #102) --------------------------------
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

  // --- generator: stub rows (routes/generate.tsx) -------------------------
  "generate.stub.reason.run": "from this run",
  "generate.stub.reason.scene": "from {title}",
  "generate.stub.reason.scenes": "from {title} and others",
  "generate.stub.accept": "Accept",
  "generate.stub.reject": "Reject",
  "generate.stub.undo": "Undo decision",
  "generate.stub.accepted": "Accepted",
  "generate.stub.rejected": "Rejected",

  // --- generator: what was written (routes/generate.tsx) ------------------
  "generate.written.title.scene": "Written — all as draft",
  "generate.written.title.npc": "Written — NPC entry created",
  "generate.written.hint.scene":
    "The scenes show up under their chapter with status “draft”. Existing entries are never overwritten — on a conflict the server writes nothing.",
  "generate.written.hint.npc":
    "The NPC shows up in the NPC list and in search. Existing entries are never overwritten — on a conflict the server writes nothing.",
  "generate.written.openNpc": "Open NPC",
  "generate.written.toPool": "To the chapters",


  // --- the markdown format's own vocabulary (markdown/grammar.ts holds the KEY
  //     per callout kind, markdown/Callout.tsx and markdown/Markdown.tsx show
  //     them; lib/blocks.ts names the same blocks in the composer) -----------
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

  // --- the Block-Composer (components/BlockComposer.tsx, lib/blocks.ts,
  //     lib/composer.ts) ----------------------------------------------------
  "composer.mode.aria": "Edit mode",
  "composer.mode.blocks": "Blocks",
  "composer.mode.raw": "Markdown",
  "composer.picker.title": "Insert block",
  "composer.picker.cancel.aria": "Cancel insert",

  "composer.blockType.ifSection": "If-section",
  "composer.blockType.heading": "Heading",
  "composer.blockType.text": "Text",
  "composer.blockType.raw": "Markdown block",

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
  "composer.block.raw.placeholder": "Markdown",
  "composer.raw.hint": "Markdown with its markers — taken over unchanged.",
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

  // --- the aside cards (components/NpcCard.tsx, components/LocationCard.tsx) -
  "npcCard.noId": "{id} — not an NPC id, so not an entry.",
  "npcCard.unloadable": "{id} — NPC not loadable, check the server.",
  "npcCard.will.inline": "Wants:",
  "npcCard.will": "Wants",
  "npcCard.voice": "Voice",
  "locationCard.unloadable": "{id} — location not loadable, check the server.",
  "locationCard.roll20": "Roll20 page: {value}",

  // --- entity reading view (components/EntityArticle.tsx) -------------------
  "entity.npc.statblock": "Statblock: {value}",
  "entity.location.roll20": "Roll20 page: {value}",

  // --- the DEV markdown harness ("/dev/markdown", routes/harness.tsx) -------
  "harness.title": "Markdown harness",
  "harness.lead": "Renders the reference fixtures from examples/ without a running server.",
  "harness.properties": "Show properties",


  // --- "Augment with AI" (components/AugmentAction.tsx, issue #36) ---------
  "augment.action": "Augment with AI",
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
  "augment.running": "Running on the server. You can close the tab — the result stays.",
  "augment.busy": "Another generator run is going. Wait for it, or discard it there.",
  "augment.busy.review":
    "Another generator run is still waiting for a check. Accept or discard it in the "
    + "generator first — a new run would delete it.",
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
  "augment.body.raw": "Markdown",
  "augment.body.none": "No change to the text proposed.",
  "augment.body.showUnchanged": "Show unchanged blocks",
  "augment.body.hideUnchanged": "Hide unchanged blocks",
  "augment.state.new": "New",
  "augment.state.changed": "Changed",
  "augment.state.removed": "Dropped",
  "augment.decision.aria": "Accept or keep",
  "augment.decision.take": "Accept",
  "augment.decision.keep": "Keep",
  "augment.decision.takeUnit": "Accept: {label}",
  "augment.decision.keepUnit": "Keep: {label}",
  "augment.diff.added": "added",
  "augment.diff.removed": "removed",
  "augment.diff.changed": "changed",
  "augment.review.aria": "Check the proposal",
  "augment.accept": "Accept",
  "augment.reject": "Discard proposal",
  "augment.review.namingHeading":
    "{count, plural, one {# naming-convention hint} other {# naming-convention hints}} — not a blocker",
  "augment.review.namingHint": "\u201c{from}\u201d is still there; the convention says \u201c{to}\u201d.",

};
