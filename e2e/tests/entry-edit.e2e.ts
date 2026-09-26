// Critical path 9: editing a markdown body in the app — open → change the body
// → save → rendered; 409 on a CONCURRENT SECOND WRITE offers the two answers
// instead of silently overwriting; see CLAUDE.md.
//
// The database is the only truth (decisions/sqlite), so "someone changed the scene
// outside" cannot happen — the conflict this path is about is a second write
// through the API while the editor stands open. A scene is written through its
// own resource, PATCH …/scenes/<id> with `rev` (decisions/resources); a text
// save must leave its other fields untouched, and every assertion reads the
// scene back through the API. The scene's text is edited in its edit mode,
// together with its other fields (tests/scene-edit-mode.e2e.ts covers those);
// this spec covers the text half.
//
// Unlike the status control (critical path 7) the conflict is DETERMINISTIC:
// the editing session holds the version it started from and sends it with every
// attempt, so the ~5s version poll cannot heal the staleness while the DM
// types. No retry loop.
//
// Because fields and text share ONE row and ONE version, a second write that
// touched only the status is a conflict just like a text one — a status set
// elsewhere is not adopted behind the DM's back. A refused save keeps the
// draft and offers exactly two answers, and the spec drives both: reloading
// adopts the stored scene, forcing writes only the fields this request
// carries, so the other writer's status survives a forced text save.
//
// A location keeps one prose FIELD beside its text — `atmosphere`
// (decisions/data-shape) — and the edit surface carries it, saved in the same
// write as the text; the fields dialog does not show it. An npc's text is
// edited in its edit mode together with all of its fields
// (tests/npc-edit-mode.e2e.ts covers those); this spec covers the text half.
//
// Two more ways to lose text are covered here as well — a navigation must not
// leave edit mode armed, and a failing background refetch must not tear the
// open editor down.
//
// The edit action opens the BLOCK COMPOSER, so this spec covers the raw
// markdown half of edit mode: the textarea, its preview and the whole
// save/409/discard machinery as seen from the fallback surface. The composer
// itself — and the fact that it is the default — is
// `tests/block-composer.e2e.ts`, on the same critical path.
//
// Elements are found by role and catalog key (decisions/testing).

import type { Page } from "@playwright/test";

import type { Api } from "../support/api";
import { campaignPath, getCampaign } from "../support/campaign";
import { chapterPath, getChapter, patchChapter } from "../support/chapter";
import { createGlossaryTerm, getGlossaryTerms } from "../support/glossary-term";
import { getLocation } from "../support/location";
import { getNpc, npcExists } from "../support/npc";
import { getScene, patchScene, scenePath } from "../support/scene";
import { expect, test } from "../support/test";
import { ui, uiPattern } from "../support/ui";

const SCENE = "lighthouse-arrival";
const SCENE_URL = `/campaigns/beispiel/scenes/${SCENE}`;
const SCENE_TITLE = "Ankunft am Leuchtturm";
/** The npc the npc cases edit — its own resource and route (decisions/resources). */
const NPC = "jorna";
const NPC_URL = `/campaigns/beispiel/npcs/${NPC}`;
const NPC_NAME = "Hafenmeisterin Jorna";
const CHAPTER = "01-salzhafen";
const CHAPTER_URL = `/campaigns/beispiel/chapters/${CHAPTER}`;
const CHAPTER_TITLE = "Kapitel 1: Der Leuchtturm von Salzhafen";
/** The read-aloud line of the scene's text, as the reading view renders it. */
const READ_ALOUD = "Der Turm ragt schwarz gegen den Abendhimmel auf.";

/**
 * Read a scene: its text, and every other field beside it — what a text save
 * has to leave alone.
 */
async function sceneSplit(api: Api, id: string = SCENE) {
  const { body, rev: _rev, ...fields } = await getScene(api, id);
  return { fields, body };
}

/** A scene's text. */
async function sceneBody(api: Api, id: string = SCENE): Promise<string> {
  return (await getScene(api, id)).body;
}

/** Read the npc: its fields, `body` among them, without its guard. */
async function npcFields(api: Api) {
  const { rev: _rev, ...fields } = await getNpc(api, NPC);
  return fields;
}

/** The raw markdown textarea of the row named `name`. */
function textareaOf(page: Page, name: string) {
  return page.getByRole("textbox", { name: ui("bodyEditor.markdown.aria", { path: name }) });
}

function saveButton(page: Page) {
  // exact: the conflict line's "save anyway" contains the same word.
  return page.getByRole("button", { name: ui("common.save"), exact: true });
}

function cancelButton(page: Page) {
  return page.getByRole("button", { name: ui("common.cancel"), exact: true });
}

/** The edit action of a reading view. */
function editAction(page: Page) {
  return page.getByRole("button", { name: ui("common.edit"), exact: true });
}

/** The editable title of the scene's edit mode. */
function sceneTitleInput(page: Page) {
  return page.getByRole("textbox", { name: ui("sceneEdit.title.aria") });
}

/** The status control of a scene, named by the value it shows. */
function sceneStatus(page: Page, key: "status.scene.ready" | "status.scene.played") {
  return page.getByRole("button", { name: ui("status.change.aria", { current: ui(key) }) });
}

/**
 * The conflict line of the surface under test, with its two actions — the
 * only alert of the app.
 */
function conflict(page: Page) {
  const line = page.getByRole("alert");
  return {
    line,
    reload: line.getByRole("button", { name: ui("editConflict.reload") }),
    force: line.getByRole("button", { name: ui("editConflict.force") }),
  };
}

/**
 * Enter edit mode and switch to the raw markdown surface.
 *
 * The edit action opens the block composer, so everything the fallback
 * surface owns costs one more click: the raw-markdown side of the mode
 * toggle. Switching is lossless by construction (the draft round-trips through
 * serializeBlocks/parseBlocks), which is why the textarea below is still
 * seeded with the row's body byte for byte and the save button is still
 * disabled right after opening.
 */
async function openMarkdownEditor(page: Page): Promise<void> {
  await editAction(page).click();
  // exact: the composer's per-card controls carry a numbered block name of
  // their own that starts with the same word.
  await page.getByRole("button", { name: ui("composer.mode.markdown"), exact: true }).click();
}

test("editing the body: save writes the scene and the reading view shows it", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const added = "A tarnished brass whistle lies in the sand at the foot of the stairs.";

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);

  // Raw markdown is the fallback surface this spec is about.
  await openMarkdownEditor(page);

  const textarea = textareaOf(page, SCENE_TITLE);
  await expect(textarea).toBeVisible();
  // Seeded with the body, byte for byte.
  await expect(textarea).toHaveValue(before.body);
  // The page around it is the scene's edit mode: its title editable in place
  // and its status control beside the heading.
  await expect(sceneTitleInput(page)).toHaveValue(SCENE_TITLE);
  await expect(sceneStatus(page, "status.scene.ready")).toBeVisible();
  // The raw surface's own toggle offers the OTHER side: the preview.
  await expect(page.getByRole("button", { name: ui("editor.preview") })).toBeVisible();

  // Nothing changed yet, so there is nothing to save.
  const save = saveButton(page);
  await expect(save).toBeDisabled();

  await textarea.fill(`${before.body}\n${added}\n`);
  await expect(save).toBeEnabled();
  await save.click();

  // The editor closes and the reading view renders the new body.
  await expect(textarea).toHaveCount(0);
  await expect(editAction(page)).toBeVisible();
  await expect(page.getByRole("article")).toContainText(added);
  // The old text is still there — this was an append, not a replace.
  await expect(page.locator("[data-callout='readaloud']")).toContainText(READ_ALOUD);

  // Stored: every other field untouched, body exactly what was typed.
  await expect.poll(() => sceneBody(api)).toContain(added);
  const after = await sceneSplit(api);
  expect(after.fields).toEqual(before.fields);
  expect(after.body).toBe(`${before.body}\n${added}\n`);
});

test("a mention in the text stays text — nothing created, no error", async ({ page, api }) => {
  // A reference names something that exists (decisions/constraints) — but a MENTION in
  // the body is not a reference: `[[nobody]]` and a relations line are
  // prose. Saving them is a normal save: nothing is created, nothing is
  // refused, and the text comes back as written.
  const before = await npcFields(api);
  const mention = "She speaks of [[nobody]] and means it.";
  const relation = "- holm: still owes her harbour dues";

  await page.goto(NPC_URL);
  await openMarkdownEditor(page);
  const textarea = textareaOf(page, NPC_NAME);
  await textarea.fill(`${before.body}\n${mention}\n\n## Relations\n\n${relation}\n`);
  await saveButton(page).click();

  // Saved, rendered, and readable as typed — the unknown slug included.
  await expect(textarea).toHaveCount(0);
  const article = page.getByRole("article");
  await expect(article).toContainText("[[nobody]]");
  // Rendered as the list item it is, so without the markdown dash.
  await expect(article).toContainText("holm: still owes her harbour dues");
  // …and neither mention brought an npc into existence.
  expect(await npcExists(api, "nobody")).toBe(false);
  expect(await npcExists(api, "holm")).toBe(false);
  const after = await npcFields(api);
  expect(after.body).toContain(mention);
  expect(after.body).toContain(relation);
});

test("a scene whose location changed stays at its route and stays editable", async ({
  page,
  api,
}) => {
  // A scene is reached by its id (decisions/resources): correcting its location changes a
  // field, not the link — a bookmark written before still opens it, and the
  // text saves through it like any other edit.
  // The location has to exist before a scene can name it (decisions/constraints).
  await api.send("POST", "campaigns/beispiel/locations", { name: "North Cove" });
  await patchScene(api, SCENE, { location: "north-cove" });

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);
  await expect(page).toHaveURL(new RegExp(`${SCENE_URL}$`));

  const before = await sceneSplit(api);
  const added = "The path to the North Cove is dry at low tide.";
  await openMarkdownEditor(page);
  const textarea = textareaOf(page, SCENE_TITLE);
  await textarea.fill(`${before.body}\n${added}\n`);
  await saveButton(page).click();

  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(added);
  await expect.poll(() => sceneBody(api)).toContain(added);
  // …and the other fields are untouched, the changed `location` included.
  const after = await sceneSplit(api);
  expect(after.fields).toEqual(before.fields);
});

test("the preview toggle renders the draft through the real markdown pipeline", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const loot = "> [!loot] A tarnished brass whistle, engraved: “North Cove”.";

  await page.goto(SCENE_URL);
  // The rendered body is on screen before edit mode …
  await expect(page.locator("[data-callout='readaloud']")).toHaveCount(1);
  await openMarkdownEditor(page);

  const textarea = textareaOf(page, SCENE_TITLE);
  await expect(textarea).toBeVisible();
  // … and gone while the raw markdown is being edited — never both at once.
  await expect(page.locator("[data-callout='readaloud']")).toHaveCount(0);

  await textarea.fill(`${before.body}\n${loot}\n`);

  // The preview renders the DRAFT: the callouts that were already there plus
  // the one just typed, through the same renderer the reading view uses.
  await page.getByRole("button", { name: ui("editor.preview") }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.locator("[data-callout='readaloud']")).toContainText(READ_ALOUD);
  await expect(page.locator("[data-callout='check']")).toContainText("Wisdom (Perception) DC 13");
  await expect(page.locator("[data-callout='secret']")).toBeVisible();
  const lootCallout = page.locator("[data-callout='loot']");
  await expect(lootCallout).toContainText(ui("markdown.callout.loot"));
  await expect(lootCallout).toContainText("A tarnished brass whistle");
  // Still edit mode: the save actions stand, only the surface swapped.
  await expect(cancelButton(page)).toBeVisible();

  // Back to the text, unchanged by the round trip. This edit action is the raw
  // markdown surface's own preview/edit toggle — the header trigger is gone
  // while edit mode runs, and the blocks switch is a button of its own, so
  // the name stays unambiguous.
  await editAction(page).click();
  await expect(textarea).toHaveValue(`${before.body}\n${loot}\n`);

  // … and saved, the callout is part of the scene.
  await saveButton(page).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.locator("[data-callout='loot']")).toContainText("A tarnished brass whistle");
  const after = await sceneSplit(api);
  expect(after.fields).toEqual(before.fields);
  expect(after.body).toContain(loot);
});

test("a concurrent second write: the save reports the conflict, the second one works", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const mine = "Added by the DM in the app's editor.";
  // Same fields, different body — only the row's guard token moves, and
  // that is what the server compares against.
  const otherBody = "\n## Flow\n\nChanged by a second writer.\n";

  await page.goto(SCENE_URL);
  await openMarkdownEditor(page);
  const textarea = textareaOf(page, SCENE_TITLE);
  await expect(textarea).toHaveValue(before.body);

  // A SECOND WRITE lands while the editor stands open: the same PATCH the app
  // uses, with a token fetched a moment ago, so it succeeds and bumps the row.
  // No race to win — the editing session holds the version it started from
  // until the DM answers the conflict, so the version poll cannot make the
  // app's write succeed silently.
  await patchScene(api, SCENE, { body: otherBody });
  await textarea.fill(`${before.body}\n${mine}\n`);
  await saveButton(page).click();

  // Refused, and said so — with both honest answers as controls.
  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  await expect(conflicted.force).toBeVisible();
  // The editor stays open and the typed text survives — that is the point.
  await expect(textarea).toHaveValue(`${before.body}\n${mine}\n`);
  // Nothing was written: the other writer's body stands, untouched.
  const stored = await sceneSplit(api);
  expect(stored.body).toBe(otherBody);
  expect(stored.fields).toEqual(before.fields);

  // Reloading adopts what is stored: the draft is gone and there is nothing
  // left to save. The SURFACE stays as it was — the same textarea is still
  // standing, now holding the adopted text byte for byte. Answering a conflict
  // is not a reason to move the DM onto the other surface.
  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
  await expect(textarea).toHaveValue(otherBody);
  expect(await sceneSplit(api)).toEqual(stored);

  // And from that adopted version the DM's sentence saves in one click —
  // deliberately on top of the other writer's body: they saw it and decided.
  await textarea.fill(`${otherBody}${mine}\n`);
  await saveButton(page).click();
  await expect(textarea).toHaveCount(0);
  await expect(conflicted.line).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(mine);

  await expect.poll(() => sceneBody(api)).toContain(mine);
  const after = await sceneSplit(api);
  expect(after.fields).toEqual(before.fields);
  expect(after.body).toBe(`${otherBody}${mine}\n`);
});

// Fields and text are ONE row and ONE version (decisions/writes), so a write that
// touched only the status makes an open editor's version stale exactly like
// a text write does. That is deliberate: there is no "text-neutral" change the
// editor may adopt on its own, because adopting one means writing the draft
// against a row the DM has not seen.
//
// These two tests are the same setup and the two answers.
test("a status-only second write conflicts too — reloading adopts it", async ({
  page,
  api,
}) => {
  const opened = await getScene(api, SCENE);
  const before = { body: opened.body };
  const mine = "Written while the status changed.";

  await page.goto(SCENE_URL);
  await openMarkdownEditor(page);
  const textarea = textareaOf(page, SCENE_TITLE);
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}\n${mine}\n`);

  // The status of THIS scene is set out of band, with a token fetched a moment
  // ago: one field, not one byte of the body — and the row's version moves
  // all the same.
  const bumped = (await patchScene(api, SCENE, { status: "played" })).rev;
  expect(bumped).toBe(opened.rev + 1);

  await saveButton(page).click();

  // Refused, with both answers offered.
  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  await expect(conflicted.force).toBeVisible();
  await expect(textarea).toHaveValue(`${before.body}\n${mine}\n`);
  // Nothing of the draft was written.
  const stored = await sceneSplit(api);
  expect(stored.body).toBe(before.body);
  expect(stored.fields.status).toBe("played");

  // Reloading drops the draft and continues from what is stored: the saved
  // text is back in the textarea and the changed status is on the page.
  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
  await expect(sceneStatus(page, "status.scene.played")).toBeVisible();
  // Still the same textarea: reseeding keeps the surface.
  await expect(textarea).toHaveValue(before.body);
  // The sentence is gone, as the DM asked — nothing was written at all.
  expect(await sceneSplit(api)).toEqual(stored);
});

test("a forced save writes only the text — the other writer's status survives", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const mine = "Saved despite the status change.";

  await page.goto(SCENE_URL);
  await openMarkdownEditor(page);
  const textarea = textareaOf(page, SCENE_TITLE);
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}\n${mine}\n`);

  await patchScene(api, SCENE, { status: "played" });
  await saveButton(page).click();

  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();

  // Forcing writes the refused fields on top of the row as it stands — and
  // only the text changed here, so the status set in between is untouched.
  await conflicted.force.click();
  await expect(textarea).toHaveCount(0);
  await expect(conflicted.line).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(mine);

  await expect.poll(() => sceneBody(api)).toContain(mine);
  const after = await sceneSplit(api);
  expect(after.body).toBe(`${before.body}\n${mine}\n`);
  expect(after.fields).toEqual({ ...before.fields, status: "played" });
  // And the page agrees, without a reload.
  await expect(sceneStatus(page, "status.scene.played")).toBeVisible();
});

// Fields and text in ONE request are asserted here on the write path itself;
// the edit modes send them together (tests/scene-edit-mode.e2e.ts,
// tests/npc-edit-mode.e2e.ts). One PATCH, one
// transaction, ONE step of the version — how much a request carried is not
// readable from `rev`.
test("fields and body in ONE write are one version step", async ({ api }) => {
  const opened = await getScene(api, SCENE);
  const before = await sceneSplit(api);
  const rev = opened.rev;
  const body = `${before.body}\nWritten in one go with the fields.\n`;

  const written = await patchScene(api, SCENE, {
    rev,
    status: "played",
    tags: ["social", "travel", "together"],
    body,
  });

  expect(written.rev).toBe(rev + 1);
  expect(written.body).toBe(body);
  expect(written.status).toBe("played");

  const after = await sceneSplit(api);
  expect(after.body).toBe(body);
  expect(after.fields).toEqual({
    ...before.fields,
    status: "played",
    tags: ["social", "travel", "together"],
  });

  // A request that names no field is refused rather than counted as a write.
  const empty = await api.fetch(scenePath(api, SCENE), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: written.rev }),
  });
  expect(empty.status).toBe(400);
  expect(await empty.json()).toMatchObject({ code: "nothing_to_write" });
  expect((await getScene(api, SCENE)).rev).toBe(written.rev);
});

test("navigating away ends edit mode — coming back never re-opens it", async ({ page, api }) => {
  const before = await sceneSplit(api);
  const other = await sceneSplit(api, "smuggler-captured");

  await page.goto(SCENE_URL);
  await openMarkdownEditor(page);
  const textarea = textareaOf(page, SCENE_TITLE);
  await textarea.fill(`${before.body}\nA sentence that does not survive the navigation.\n`);

  // In-app navigation to ANOTHER SCENE through ⌘K: the same route with another
  // path, so the view is not remounted and could carry edit mode over. The
  // unsaved work makes it ask first; discarding goes on.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill("Schmugglern");
  await page.getByRole("option").filter({ hasText: "Von den Schmugglern erwischt" }).first().click();
  const leave = page.getByRole("dialog", { name: ui("properties.discard.title") });
  await leave.getByRole("button", { name: ui("common.discard") }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Von den Schmugglern erwischt");
  // The other scene opens in its reading view, not in an edit mode seeded
  // from it.
  await expect(sceneTitleInput(page)).toHaveCount(0);
  await expect(editAction(page)).toBeVisible();

  // Back on the first scene: the reading view. An editor seeded from the
  // server would look exactly like the one the DM left — with their paragraph
  // silently missing.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);
  await expect(textarea).toHaveCount(0);
  await expect(editAction(page)).toBeVisible();
  await expect(page.locator("[data-callout='readaloud']")).toBeVisible();
  expect(await sceneSplit(api)).toEqual(before);
  expect(await sceneSplit(api, "smuggler-captured")).toEqual(other);
});

test("a failing background refetch leaves the open editor standing", async ({ page, api }) => {
  const before = await sceneSplit(api);
  const draft = `${before.body}\nWritten while the server was away.\n`;

  await page.goto(SCENE_URL);
  await openMarkdownEditor(page);
  const textarea = textareaOf(page, SCENE_TITLE);
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(draft);

  // Every further READ of this scene fails — a restarted server, a network
  // blip. Only GET is blocked, so the write endpoint stays reachable.
  let aborted = 0;
  await page.route("**/api/campaigns/beispiel/scenes/**", (route) => {
    if (route.request().method() !== "GET") {
      void route.fallback();
      return;
    }
    if (route.request().url().includes(SCENE)) aborted++;
    void route.abort();
  });
  // The version poll (~5s) notices the second writer's change and refetches,
  // so the scene query runs into the abort (retry: 1 -> two attempts, then
  // 'error'). The write goes through the API: only the app's own READ of this
  // scene is blocked, the server stays reachable.
  await patchScene(api, SCENE, { body: "\n## Flow\n\nChanged by a second writer.\n" });
  await expect.poll(() => aborted, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  // The cached scene is still there, so the PAGE must not swap itself for its
  // error line and take the unsaved text with it.
  await expect(page.getByText(ui("reading.notLoadable"))).toHaveCount(0);
  await expect(sceneTitleInput(page)).toHaveValue(SCENE_TITLE);
  await expect(textarea).toHaveValue(draft);
});

test("cancel asks before it throws work away", async ({ page, api }) => {
  const before = await sceneSplit(api);
  const discard = page.getByRole("dialog", { name: ui("bodyEditor.discard.title") });
  const unsaved = "A sentence that is never saved.";

  await page.goto(SCENE_URL);

  // Without changes there is nothing to lose: no dialog, straight out — the
  // detour through raw markdown and back is no change either (lossless round trip).
  await openMarkdownEditor(page);
  const textarea = textareaOf(page, SCENE_TITLE);
  await expect(textarea).toBeVisible();
  await cancelButton(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(textarea).toHaveCount(0);

  // With changes it asks — and continuing to edit keeps the text.
  await openMarkdownEditor(page);
  await textarea.fill(`${before.body}\n${unsaved}\n`);
  await cancelButton(page).click();
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(textarea).toHaveValue(`${before.body}\n${unsaved}\n`);

  // Discarding closes the editor and the reading view is as it was.
  await cancelButton(page).click();
  await discard.getByRole("button", { name: ui("common.discard") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(textarea).toHaveCount(0);
  await expect(page.locator("[data-callout='readaloud']")).toContainText(READ_ALOUD);
  await expect(page.getByRole("article")).not.toContainText(unsaved);
  // Nothing was written.
  expect(await sceneSplit(api)).toEqual(before);
});

test("the npc reading view edits its body the same way", async ({ page, api }) => {
  const before = await npcFields(api);
  const added = "- metta: owes Jorna a favour since last autumn";

  await page.goto(NPC_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);

  await openMarkdownEditor(page);
  const textarea = textareaOf(page, NPC_NAME);
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}${added}\n`);
  await saveButton(page).click();

  await expect(textarea).toHaveCount(0);
  // The npc header (quickstats, voice) stands untouched around the new body.
  await expect(page.getByRole("article")).toContainText(String(before.voice));
  await expect(page.getByRole("article")).toContainText("owes Jorna a favour");

  await expect.poll(async () => (await getNpc(api, NPC)).body).toContain(added);
  // Every other field of the npc is as it was.
  const { body: _before, ...fieldsBefore } = before;
  const { body: _after, ...fieldsAfter } = await npcFields(api);
  expect(fieldsAfter).toEqual(fieldsBefore);
});

test("a location and a chapter offer the editor on their own routes", async ({ page }) => {
  // The entities whose prose the DM maintains offer the body editor — each on
  // its own route (decisions/resources).
  for (const [url, name] of [
    ["/campaigns/beispiel/locations/leuchtturm", "Der Leuchtturm von Salzhafen"],
    [CHAPTER_URL, CHAPTER_TITLE],
  ] as const) {
    await page.goto(url);
    await openMarkdownEditor(page);
    await expect(textareaOf(page, name)).toBeVisible();
    // Clean exit — no dialog, nothing written.
    await cancelButton(page).click();
    await expect(textareaOf(page, name)).toHaveCount(0);
  }
});

test("a chapter's text is edited on its reading view; its other fields stay", async ({
  page,
  api,
}) => {
  const before = await getChapter(api, CHAPTER);
  const added = "Whoever puts out the fire does not want to be seen.";

  await page.goto(CHAPTER_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CHAPTER_TITLE);
  await openMarkdownEditor(page);
  const textarea = textareaOf(page, CHAPTER_TITLE);
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}\n${added}\n`);
  await saveButton(page).click();

  // The editor closes and the reading view renders the new text.
  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(added);
  const after = await getChapter(api, CHAPTER);
  expect(after.body).toBe(`${before.body}\n${added}\n`);
  // Only the text was sent: title and status are as they were.
  expect({ title: after.title, status: after.status }).toEqual({
    title: before.title,
    status: before.status,
  });
});

test("a chapter's text and a second writer: the conflict line, and reloading adopts it", async ({
  page,
  api,
}) => {
  await page.goto(CHAPTER_URL);
  await openMarkdownEditor(page);
  const textarea = textareaOf(page, CHAPTER_TITLE);
  await textarea.fill("My draft.\n");

  // The second writer: a status change of the same row, its own fresh rev.
  await patchChapter(api, CHAPTER, { status: "done" });
  await saveButton(page).click();

  // Nothing written — the draft stays, the conflict line asks.
  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  await expect(textarea).toHaveValue("My draft.\n");
  expect((await getChapter(api, CHAPTER)).body).not.toContain("My draft.");

  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(textarea).toHaveValue((await getChapter(api, CHAPTER)).body);
  expect((await getChapter(api, CHAPTER)).status).toBe("done");
});

test("the chapter and the campaign are their own resources; the entry addresses are gone", async ({
  api,
}) => {
  // Every field flat, `body` among them, beside the guard — no `kind`, no
  // `path`, no `properties`.
  const chapter = await getChapter(api, CHAPTER);
  expect(Object.keys(chapter).sort()).toEqual(["body", "id", "rev", "status", "title"]);
  expect(chapter).toMatchObject({ id: CHAPTER, title: CHAPTER_TITLE, status: "active" });
  const campaign = await getCampaign(api);
  expect(Object.keys(campaign).sort()).toEqual([
    "body",
    "description",
    "glossaryIntro",
    "id",
    "name",
    "rev",
  ]);
  expect(campaign.name).toBe("Der Leuchtturm von Salzhafen");

  // A stale rev is 409 with the current state and writes nothing.
  const staleChapter = await api.fetch(chapterPath(api, CHAPTER), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: chapter.rev - 1, title: "Stale" }),
  });
  expect(staleChapter.status).toBe(409);
  expect(((await staleChapter.json()) as { chapter: { title: string } }).chapter.title).toBe(
    chapter.title,
  );
  const staleCampaign = await api.fetch(campaignPath(api), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: campaign.rev - 1, name: "Stale" }),
  });
  expect(staleCampaign.status).toBe(409);
  expect((await getCampaign(api)).name).toBe(campaign.name);

  // A field the entity does not have is a 400 that names it.
  const unknownChapter = await api.fetch(chapterPath(api, CHAPTER), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: chapter.rev, location: "leuchtturm" }),
  });
  expect(unknownChapter.status).toBe(400);
  expect(await unknownChapter.text()).toContain("location");
  const unknownCampaign = await api.fetch(campaignPath(api), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: campaign.rev, title: "No field of the campaign" }),
  });
  expect(unknownCampaign.status).toBe(400);
  expect(await unknownCampaign.text()).toContain("title");
  expect(await getChapter(api, CHAPTER)).toEqual(chapter);

  // There is no general endpoint over several entities: every address the
  // former `…/entries/*` spelled answers 404 — the chapter, the campaign, the
  // lists, and the npc, location and scene that have their own resources. No
  // redirect and no alias — this is the ONE place the suite asserts it.
  for (const rel of [
    CHAPTER,
    "campaign",
    "sessions/2026-01-15",
    "inbox",
    "glossary",
    "npcs/jorna",
    "locations/leuchtturm",
    `${CHAPTER}/${SCENE}`,
  ]) {
    const address = rel.split("/").map(encodeURIComponent).join("/");
    for (const method of ["GET", "PATCH"] as const) {
      const res = await api.fetch(`campaigns/beispiel/entries/${address}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify({ rev: 1, body: "\nAll new.\n" }),
      });
      expect(res.status).toBe(404);
    }
  }
});

test("a glossary term is a row of its own, kept on the glossary page", async ({ page, api }) => {
  // A glossary term is its own resource (decisions/resources) and has no text to edit as
  // markdown. The glossary page is where the DM keeps the terms — row by
  // row, never as markdown.
  const created = await createGlossaryTerm(api, { term: "tide flat", explanation: "Tidal flat" });
  expect((await getGlossaryTerms(api)).map((term) => term.id)).toContain(created.id);

  // The glossary page shows the term, and carries no markdown editor.
  await page.goto("/campaigns/beispiel/glossary");
  await expect(page.getByText("Tidal flat")).toBeVisible();
  await expect(
    page.getByRole("textbox", {
      name: uiPattern("bodyEditor.markdown.aria", { path: /.*/ }, { exact: true }),
    }),
  ).toHaveCount(0);
});

// --- the prose field beside the text ------------------------------------------

test("the location edit surface carries the atmosphere; the fields dialog does not", async ({
  page,
  api,
}) => {
  const before = await getLocation(api, "leuchtturm");
  const mine = "Cold lamp oil, and the wind whistles through the spiral stairs.";
  const atmosphere = ui("properties.location.atmosphere.label");

  await page.goto("/campaigns/beispiel/locations/leuchtturm");
  // Not in the dialog: it is edited where the prose is edited.
  await page.getByRole("button", { name: ui("properties.action") }).click();
  const dialog = page.getByRole("dialog", {
    name: ui("properties.title", { kind: ui("kind.location") }),
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: atmosphere })).toHaveCount(0);
  await dialog.getByRole("button", { name: ui("common.cancel") }).click();
  await expect(dialog).toHaveCount(0);

  await openMarkdownEditor(page);
  const field = page.getByRole("textbox", { name: atmosphere, exact: true });
  await expect(field).toHaveValue(String(before.atmosphere));
  await field.fill(mine);
  await saveButton(page).click();
  await expect(field).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(mine);
  const after = await getLocation(api, "leuchtturm");
  expect(after.atmosphere).toBe(mine);
  // The text was not touched, so it was not sent.
  expect(after.body).toBe(before.body);
});
