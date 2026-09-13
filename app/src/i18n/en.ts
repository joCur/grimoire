// The English catalog (issue #69). Typed as `Messages`, so it is complete by
// construction: a missing key and a key that only exists here both fail the
// typecheck.
//
// DM vocabulary, not a literal translation: Session · Scene · Chapter ·
// Location · Harvest (Ernte) · Read-aloud (Vorlesen) · Handout. Ids and
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
  "topbar.review.pending": "Review · {count} open",
  "topbar.session.back": "To the session",

  // --- campaign switcher ----------------------------------------------------
  "campaign.switcher.current": "Campaign: {name}",
  "campaign.switcher.empty": "No campaigns yet.",

  // --- the session chip -----------------------------------------------------
  "session.start": "Start session",
  "session.start.failed": "Session not started — check the server",
  "session.start.olderRunning": "An older session is still running — end it in live mode",
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
  "create.campaign.description":
    "The name becomes the campaign's id — it appears in every address and stays as it is. Chapters and scenes come into being inside it afterwards.",
  "create.campaign.nameLabel": "Campaign name",
  "create.campaign.namePlaceholder": "Campaign name",
  "create.campaign.idPrefix": "id: ",
  "create.campaign.descriptionLabel": "Description (optional)",
  "create.campaign.descriptionPlaceholder": "One sentence that places the campaign",

  "create.chapter.title": "Create chapter",
  "create.chapter.description":
    "The title becomes the chapter's id — it appears in every scene address and stays as it is. The goal is optional and lands under “Ziel des Kapitels”.",
  "create.chapter.nameLabel": "Title",
  "create.chapter.namePlaceholder": "Chapter title",
  "create.chapter.goalLabel": "Goal of the chapter (optional)",
  "create.chapter.goalPlaceholder": "What the party is meant to achieve here",

  "create.scene.title": "Create scene",
  "create.scene.description":
    "The scene is created as a draft in this chapter and opens straight in the editor. The title becomes the id — and it stays.",
  "create.scene.nameLabel": "Title",
  "create.scene.namePlaceholder": "Scene title",

  "create.npc.title": "Create NPC",
  "create.npc.description":
    "Just the name — role, status and everything else follow in the properties dialog. The name becomes the id, and that id stays.",
  "create.npc.nameLabel": "Name",
  "create.npc.namePlaceholder": "NPC name",

  "create.location.title": "Create location",
  "create.location.description":
    "Just the name — everything else follows in the properties dialog. The name becomes the id, and that id stays.",
  "create.location.nameLabel": "Name",
  "create.location.namePlaceholder": "Location name",

  // --- cold start -----------------------------------------------------------
  "home.opening": "Opening the campaign …",
  "home.serverDown": "Server unreachable — start the Grimoire server on port 3000.",
  "coldstart.title": "Welcome to Grimoire",
  "coldstart.lead":
    "No campaign yet. Create one — chapters and scenes come into being inside it afterwards.",
  "coldstart.id": "id: {id}",

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

  "properties.kind.scene": "Scene",
  "properties.kind.npc": "NPC",
  "properties.kind.location": "Location",
  "properties.kind.chapter": "Chapter",

  "properties.field.required": " · required",
  "properties.field.unset": "— not set —",
  "properties.field.chipsPlaceholder": "add, Enter",
  "properties.field.addRow": "Add row",
  "properties.field.remove.aria": "Remove {item}",
  "properties.field.row": "Row {row}",
  "properties.field.row.name.aria": "{label}, row {row}: name",
  "properties.field.row.value.aria": "{label}, row {row}: value",
  "properties.ref.unknownChapter": "Unknown — the chapter has to exist.",
  "properties.ref.freeText": "Free text — no entry.",
  "properties.ref.new": "New — will be created on save.",
  "properties.issue.notAnId": "“{id}” is not an id — lowercase letters, digits and hyphens only.",
  "properties.issue.namelessRow": "Row without a name — add a name or remove the row.",
  "properties.issue.duplicateName": "Name “{name}” twice — every name may appear only once.",

  "properties.scene.title.label": "Title",
  "properties.scene.type.label": "Type",
  "properties.scene.type.planned": "planned",
  "properties.scene.type.contingency": "contingency",
  "properties.scene.trigger.label": "Trigger",
  "properties.scene.trigger.hint": "Contingency only: when does the scene fire?",
  "properties.scene.chapter.label": "Chapter",
  "properties.scene.location.label": "Location",
  "properties.scene.location.hint": "An id from Locations, or free text.",
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
  "properties.npc.quickstats.label": "Quickstats",
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
    "The value active marks the chapter the live view opens.",

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
  "rename.error.reserved": "npcs, locations and sessions are reserved names.",
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
};
