// Critical path 7: the fields dialog of a chapter — one dialog over its typed
// fields, including the 409 conflict. It also touches path 2 (the reading
// view must show the new values the moment the dialog closes) and path 8
// (the dialog has to be usable at 390px). A scene, an npc and a location have
// no such dialog: their fields are edited in their edit modes
// (tests/scene-edit-mode.e2e.ts, tests/npc-edit-mode.e2e.ts,
// tests/location-edit-mode.e2e.ts). See CLAUDE.md.
//
// The sibling spec on this path is tests/status-control.e2e.ts: the status
// control patches ONE key, this dialog patches any of them. What makes the
// dialog the harder case, and what this spec is about:
//
//   1. It is a PATCH, not a write of the whole row. Only the fields the DM
//      actually changed may travel — a field the dialog knows but the DM did
//      not touch, and the whole body, have to come out of a save untouched.
//   2. The conflict is DETERMINISTIC here, unlike the status control: the
//      dialog freezes the rev it opened with on purpose, so the ~5s version
//      poll cannot heal the staleness while the DM types. No retry loop.
//   3. Everything the save uses is frozen at open, so the dialog belongs to
//      ONE row: a navigation under the open modal (⌘K works over it) has to
//      close it, or the next save writes row A's change into row B. And what
//      is typed does not vanish without a question.
//
// Elements are found by role and catalog key (decisions/testing). Every
// assertion about stored state reads the row back through the API. An
// external change means a SECOND WRITER through the same API, which is what
// bumps the row's guard token.

import type { Locator, Page } from "@playwright/test";

import { getChapter, patchChapter } from "../support/chapter";
import { getScene, scenePath } from "../support/scene";
import { expect, test } from "../support/test";
import { ui } from "../support/ui";

const SCENE = "lighthouse-arrival";
const CHAPTER = "01-salzhafen";
const CHAPTER_URL = `/campaigns/beispiel/chapters/${CHAPTER}`;
const CHAPTER_TITLE = "Kapitel 1: Der Leuchtturm von Salzhafen";
/** A second chapter, seeded where a test needs one to navigate to. */
const OTHER_CHAPTER = "02-nordbucht";
const OTHER_CHAPTER_TITLE = "Kapitel 2: Die Nordbucht";

/** Open the header's fields action and hand back the dialog. */
async function openProperties(page: Page) {
  await page.getByRole("button", { name: ui("properties.action") }).click();
  const dialog = page.getByRole("dialog", {
    name: ui("properties.title", { kind: ui("kind.chapter") }),
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

function saveButton(dialog: Locator) {
  // exact: the conflict line's "save anyway" contains the same word.
  return dialog.getByRole("button", { name: ui("common.save"), exact: true });
}

/** The chapter's title field — it cannot be emptied, so its label carries the marker that says so. */
function titleField(dialog: Locator) {
  return dialog.getByLabel(
    `${ui("properties.chapter.title.label")}${ui("properties.field.required")}`,
    { exact: true },
  );
}

function statusField(dialog: Locator) {
  return dialog.getByLabel(ui("properties.chapter.status.label"));
}

/** The dialog's conflict line with its two actions — the only alert of the app. */
function conflict(dialog: Locator) {
  const line = dialog.getByRole("alert");
  return {
    line,
    reload: line.getByRole("button", { name: ui("editConflict.reload") }),
    force: line.getByRole("button", { name: ui("editConflict.force") }),
  };
}

async function openChapter(page: Page) {
  await page.goto(CHAPTER_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CHAPTER_TITLE);
}

test("a chapter's dialog: a second writer is the conflict line, and a forced save keeps the text", async ({
  page,
  api,
}) => {
  // The chapter is its own resource (decisions/resources): its dialog writes
  // the chapter's PATCH, fields flat, against the chapter's `rev`.
  const before = await getChapter(api, CHAPTER);
  const theirs = "Changed by a second writer.\n";
  const title = "Chapter 1: The beacon goes dark";

  await openChapter(page);
  const dialog = await openProperties(page);
  await titleField(dialog).fill(title);

  // The second writer touches only the TEXT.
  await patchChapter(api, CHAPTER, { body: theirs });

  await saveButton(dialog).click();
  const conflicted = conflict(dialog);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  // Nothing was written by the refused save.
  expect((await getChapter(api, CHAPTER)).title).toBe(before.title);

  // Forcing writes the dialog's field on top of the row as it stands — the
  // text it never saw survives.
  await conflicted.force.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getChapter(api, CHAPTER)).title).toBe(title);
  const after = await getChapter(api, CHAPTER);
  expect(after.body).toBe(theirs);
  expect(after.status).toBe(before.status);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
});

test("a second writer: reloading shows what is stored, and the next save keeps the other text", async ({
  page,
  api,
}) => {
  const theirTitle = "Chapter 1 (renamed elsewhere)";
  const theirs = "Changed by a second writer.\n";

  await openChapter(page);
  const dialog = await openProperties(page);
  await titleField(dialog).fill("A title that is never written");

  // A second writer changes title AND body under the open dialog — in ONE
  // request, because that is what the chapter's one write path is.
  await patchChapter(api, CHAPTER, { title: theirTitle, body: theirs });
  await saveButton(dialog).click();

  // Refused: the typed value stays, nothing was written.
  const conflicted = conflict(dialog);
  await expect(conflicted.line).toBeVisible();
  await expect(titleField(dialog)).toHaveValue("A title that is never written");
  const stored = await getChapter(api, CHAPTER);
  expect(stored.title).toBe(theirTitle);

  // Reloading shows the CURRENT values and writes nothing on the way.
  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(titleField(dialog)).toHaveValue(theirTitle);
  await expect(statusField(dialog)).toHaveValue("active");
  expect(await getChapter(api, CHAPTER)).toEqual(stored);

  // From the adopted version the DM's change saves in one click, and it is
  // still a patch of the dialog's fields only: the other writer's text stays.
  await statusField(dialog).selectOption("done");
  await saveButton(dialog).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getChapter(api, CHAPTER)).status).toBe("done");
  const after = await getChapter(api, CHAPTER);
  expect(after.title).toBe(theirTitle);
  expect(after.body).toBe(theirs);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(theirTitle);
});

test("clearing a field deletes the key instead of writing an empty value", async ({
  page,
  api,
}) => {
  const before = await getChapter(api, CHAPTER);
  expect(before.status).toBe("active");

  await openChapter(page);
  const dialog = await openProperties(page);

  // The empty choice clears its field.
  await statusField(dialog).selectOption("");
  await saveButton(dialog).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // In the stored row the status is GONE, not an empty string, and every
  // other field stands, the body byte-identical.
  await expect
    .poll(async () => Object.hasOwn(await getChapter(api, CHAPTER), "status"))
    .toBe(false);
  const { rev: _before, status: _cleared, ...rest } = before;
  const { rev: _after, ...after } = await getChapter(api, CHAPTER);
  expect(after).toEqual(rest);
});

test("cancel and Esc ask before they throw typed values away", async ({ page, api }) => {
  const before = await getChapter(api, CHAPTER);
  const discard = page.getByRole("dialog", { name: ui("properties.discard.title") });

  await openChapter(page);

  // Nothing typed, nothing to lose: the cancel action is immediate.
  let dialog = await openProperties(page);
  await dialog.getByRole("button", { name: ui("common.cancel") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // With something typed, Esc asks first — and keeping on editing keeps it.
  dialog = await openProperties(page);
  const title = titleField(dialog);
  await title.fill("A title that is never saved");
  await page.keyboard.press("Escape");
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(discard).toHaveCount(0);
  await expect(title).toHaveValue("A title that is never saved");

  // Cancelling asks the same question, and discarding closes everything.
  await dialog.getByRole("button", { name: ui("common.cancel") }).click();
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: ui("common.discard") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The reading view is as it was, and nothing was written.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CHAPTER_TITLE);
  expect(await getChapter(api, CHAPTER)).toEqual(before);
});

test.describe("with a second chapter", () => {
  test.use({
    seed: {
      chapters: [
        {
          id: OTHER_CHAPTER,
          title: OTHER_CHAPTER_TITLE,
          status: "planned",
          body: "What waits in the north cove.\n",
        },
      ],
    },
  });

  test("navigating away closes the dialog — no change of chapter A lands in chapter B", async ({
    page,
    api,
  }) => {
    const chapter = await getChapter(api, CHAPTER);
    const title = "Chapter 2, saved after the ⌘K navigation";

    await openChapter(page);

    // Type into the first chapter's dialog, then leave it WITHOUT closing it:
    // the ⌘K hotkey is a window listener, so the palette opens over the modal
    // and navigates the route underneath it — a click path, not a theory.
    const firstDialog = await openProperties(page);
    await titleField(firstDialog).fill("A title that must never be written");
    await page.keyboard.press("ControlOrMeta+KeyK");
    const search = page.getByRole("combobox");
    await expect(search).toBeFocused();
    await search.fill("Nordbucht");
    await page.getByRole("option").filter({ hasText: OTHER_CHAPTER_TITLE }).first().click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/beispiel/chapters/${OTHER_CHAPTER}$`));

    // The dialog is gone with its chapter — it may not stand over another
    // reading view, holding the frozen values (and the rev) of the one it left.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(OTHER_CHAPTER_TITLE);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // And the other chapter's own dialog opens fresh: no carried-over change.
    const otherDialog = await openProperties(page);
    await expect(titleField(otherDialog)).toHaveValue(OTHER_CHAPTER_TITLE);
    await expect(saveButton(otherDialog)).toBeDisabled();

    // A save from here writes THIS chapter only.
    await titleField(otherDialog).fill(title);
    await saveButton(otherDialog).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect.poll(async () => (await getChapter(api, OTHER_CHAPTER)).title).toBe(title);
    expect(await getChapter(api, CHAPTER)).toEqual(chapter);
  });
});

test("only the chapter has the dialog — scene, npc and location edit in place, the campaign brings its own", async ({
  page,
}) => {
  // The chapter offers its fields dialog on its own route (decisions/resources) …
  await openChapter(page);
  const dialog = await openProperties(page);
  // Clean exit — nothing changed, nothing written.
  await dialog.getByRole("button", { name: ui("common.cancel") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // … a scene, an npc and a location do not: their fields are part of their
  // edit modes.
  for (const [route, heading] of [
    ["scenes/smuggler-captured", "Von den Schmugglern erwischt"],
    ["npcs/fenn", "Fenn"],
    ["locations/leuchtturm", "Der Leuchtturm von Salzhafen"],
  ] as const) {
    await page.goto(`/campaigns/beispiel/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByRole("button", { name: ui("common.edit"), exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: ui("properties.action") })).toHaveCount(0);
  }

  // The campaign's route is the chapter overview, and its one edit action in
  // the header opens its own dialog over name, description and text.
  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Der Leuchtturm von Salzhafen");
  await page.getByRole("button", { name: ui("common.edit"), exact: true }).click();
  await expect(page.getByRole("dialog", { name: ui("campaignEdit.title") })).toBeVisible();
});

test("a status outside the closed list is refused and writes nothing", async ({ api }) => {
  // The four status columns and the scene type are CHECK constraints of their
  // columns (decisions/constraints), so the scene's write refuses a foreign
  // value with a 400 and its own code instead of letting SQLite fail. The
  // edit mode can only ever offer the allowed positions — this asserts the
  // rule on the endpoint, which is what protects the column against the
  // generator and a direct write as well.
  const current = await getScene(api, SCENE);
  const response = await api.fetch(scenePath(api, SCENE), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: current.rev, status: "half-done" }),
  });
  expect(response.status).toBe(400);
  // The body carries what the sentence in the app needs: which column, the
  // value that was written, and the positions in column order.
  expect(await response.json()).toMatchObject({
    code: "status_not_allowed",
    kind: "scene",
    value: "half-done",
    allowed: ["draft", "ready", "played", "dropped"],
  });
  // A refusal writes nothing — no field moved, and the guard token stands.
  expect(await getScene(api, SCENE)).toEqual(current);
});

// Critical path 8: the same dialog at phone size.
test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the fields dialog opens, edits and saves at phone size", async ({ page, api }) => {
    const before = await getChapter(api, CHAPTER);
    const title = "Chapter 1 at night";

    await openChapter(page);

    const dialog = await openProperties(page);
    // Nothing may scroll the page sideways while the dialog stands.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await titleField(dialog).fill(title);
    await saveButton(dialog).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    await expect.poll(async () => (await getChapter(api, CHAPTER)).title).toBe(title);
    const after = await getChapter(api, CHAPTER);
    expect(after.status).toBe(before.status);
    expect(after.body).toBe(before.body);
  });
});
