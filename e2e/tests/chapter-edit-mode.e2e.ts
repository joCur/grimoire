// Critical paths 7 and 9 for the chapter: its EDIT MODE. The edit action
// turns the reading view into the chapter's edit mode — the title editable in
// place, the status beside the heading, and the text editor below. A chapter
// has no further fields, so there are no chips. Everything on the page is one
// draft over the chapter's one row with its one guard (decisions/writes), so
// a save is ONE PATCH with exactly the fields that changed. Picking `active`
// is part of that save: the server puts the chapter that held it back to
// `planned` in the same write.
//
// A second writer makes the save a 409: the draft stays, the shared conflict
// line stands above the title, reloading takes the stored chapter and saving
// anyway writes only the changed fields, so a field changed elsewhere
// survives — a status another writer set included. Leaving with unsaved work
// asks first, through the cancel action and through a navigation. The chapter
// overview's edit action opens this edit mode; there is no fields dialog.
//
// Elements are found by role and catalog key (decisions/testing); every claim
// about what was written reads the chapter back through the API.

import type { Page, Request } from "@playwright/test";

import type { Api } from "../support/api";
import { getChapter, patchChapter } from "../support/chapter";
import { expect, test } from "../support/test";
import { ui } from "../support/ui";

const CHAPTER = "01-salzhafen";
const CHAPTER_URL = `/campaigns/beispiel/chapters/${CHAPTER}`;
/** A second chapter, seeded where a test needs one. */
const OTHER_CHAPTER = "02-nordbucht";
const OTHER_CHAPTER_TITLE = "Chapter 2: The north cove";
const OTHER_CHAPTER_SEED = {
  seed: {
    chapters: [
      {
        id: OTHER_CHAPTER,
        title: OTHER_CHAPTER_TITLE,
        status: "planned" as const,
        body: "What waits in the north cove.\n",
      },
    ],
  },
};

/** The chapter without its guard. */
async function chapterFields(api: Api, id: string = CHAPTER) {
  const { rev: _rev, ...fields } = await getChapter(api, id);
  return fields;
}

/** Every PATCH of a chapter the page sends, as the request body it carried. */
function recordChapterPatches(page: Page, id: string = CHAPTER): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "PATCH") return;
    if (!request.url().endsWith(`/chapters/${id}`)) return;
    sent.push(request.postDataJSON() as Record<string, unknown>);
  });
  return sent;
}

/** The stored chapters of the campaign that are active. */
async function activeChapters(api: Api): Promise<string[]> {
  const tree = await api.get<{ chapters: { id: string; status?: string }[] }>(
    "campaigns/beispiel/tree",
  );
  return tree.chapters.filter((chapter) => chapter.status === "active").map((chapter) => chapter.id);
}

function titleInput(page: Page) {
  return page.getByRole("textbox", { name: ui("chapterEdit.title.aria") });
}

function saveButton(page: Page) {
  // exact: the conflict line's "save anyway" contains the same word.
  return page.getByRole("button", { name: ui("common.save"), exact: true });
}

function cancelButton(page: Page) {
  return page.getByRole("button", { name: ui("common.cancel"), exact: true });
}

function editAction(page: Page) {
  return page.getByRole("button", { name: ui("common.edit"), exact: true });
}

type ChapterStatus = "planned" | "active" | "done";

/** The status control, named by the value it shows. */
function statusControl(page: Page, current: ChapterStatus) {
  return page.getByRole("button", {
    name: ui("status.change.aria", { current: ui(`properties.chapter.status.${current}`) }),
  });
}

/** Pick a status in the edit mode's status control. */
async function pickStatus(page: Page, from: ChapterStatus, to: ChapterStatus) {
  await statusControl(page, from).click();
  await page
    .getByRole("menuitemradio", { name: ui(`properties.chapter.status.${to}`) })
    .click();
  await expect(statusControl(page, to)).toBeVisible();
}

/** The raw markdown surface of the text editor, named by the stored title. */
async function markdownSurface(page: Page, title: string) {
  await page.getByRole("button", { name: ui("composer.mode.markdown"), exact: true }).click();
  return page.getByRole("textbox", { name: ui("bodyEditor.markdown.aria", { path: title }) });
}

/** The conflict line with its two answers — the only alert of the app. */
function conflict(page: Page) {
  const line = page.getByRole("alert");
  return {
    line,
    reload: line.getByRole("button", { name: ui("editConflict.reload") }),
    force: line.getByRole("button", { name: ui("editConflict.force") }),
  };
}

/** Open the reading view of a chapter and switch it into edit mode. */
async function openEditMode(page: Page, api: Api, id: string = CHAPTER) {
  const { title } = await getChapter(api, id);
  await page.goto(`/campaigns/beispiel/chapters/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await editAction(page).click();
  await expect(titleInput(page)).toHaveValue(title);
  return title;
}

test("title and text change together and are ONE patch of exactly those fields", async ({
  page,
  api,
}) => {
  const before = await getChapter(api, CHAPTER);
  const sent = recordChapterPatches(page);
  const title = "Chapter 1: The beacon goes dark";
  const added = "Whoever puts out the fire does not want to be seen.";

  await page.goto(CHAPTER_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(before.title);
  // The reading view's header carries the edit action and nothing else: the
  // chapter's fields are its edit mode.
  await expect(page.getByRole("article").getByRole("button")).toHaveCount(1);
  await editAction(page).click();

  // The heading gave way to the editable title; nothing to save yet.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
  // The status stands beside the heading, showing the stored value.
  await expect(statusControl(page, "active")).toBeVisible();

  await titleInput(page).fill(title);
  const textarea = await markdownSurface(page, before.title);
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}\n${added}\n`);

  // Two fields changed: title and text.
  await expect(page.getByText(ui("editMode.changes", { count: 2 }))).toBeVisible();
  expect(sent).toEqual([]);
  await saveButton(page).click();

  // Back in the reading view, already on the written chapter.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByRole("article")).toContainText(added);

  // ONE request, carrying exactly the changed fields beside the guard.
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0] ?? {}).sort()).toEqual(["body", "rev", "title"]);
  const after = await getChapter(api, CHAPTER);
  expect(after.rev).toBe(before.rev + 1);
  expect(after).toMatchObject({
    title,
    status: before.status,
    body: `${before.body}\n${added}\n`,
  });
});

test("a blank title blocks the save and says why", async ({ page, api }) => {
  const before = await chapterFields(api);

  await openEditMode(page, api);
  await titleInput(page).fill("   ");
  await expect(page.getByText(ui("chapterEdit.blocked.title"))).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  expect(await chapterFields(api)).toEqual(before);
});

test.describe("with a second chapter", () => {
  test.use(OTHER_CHAPTER_SEED);

  test("status, title and text in one save; activating puts the previously active chapter back to planned", async ({
    page,
    api,
  }) => {
    const before = await getChapter(api, OTHER_CHAPTER);
    const sent = recordChapterPatches(page, OTHER_CHAPTER);
    const title = "Chapter 2: Into the cove";
    const added = "The smugglers land at low tide.";
    expect(await activeChapters(api)).toEqual([CHAPTER]);

    await openEditMode(page, api, OTHER_CHAPTER);
    await titleInput(page).fill(title);
    await pickStatus(page, "planned", "active");
    // The edit mode says what activating does before the save.
    await expect(page.getByText(ui("chapterEdit.activate.hint"))).toBeVisible();
    const textarea = await markdownSurface(page, OTHER_CHAPTER_TITLE);
    await textarea.fill(`${before.body}\n${added}\n`);

    await expect(page.getByText(ui("editMode.changes", { count: 3 }))).toBeVisible();
    await saveButton(page).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    // ONE request with the three changed fields.
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0] ?? {}).sort()).toEqual(["body", "rev", "status", "title"]);
    expect(await getChapter(api, OTHER_CHAPTER)).toMatchObject({
      title,
      status: "active",
      body: `${before.body}\n${added}\n`,
    });
    // The server kept the rule: exactly one active chapter, and it is this one.
    expect((await getChapter(api, CHAPTER)).status).toBe("planned");
    expect(await activeChapters(api)).toEqual([OTHER_CHAPTER]);

    // The overview shows it at once: one active chapter, the other planned.
    await page.goto("/campaigns/beispiel");
    await expect(statusControl(page, "active")).toHaveCount(1);
    await expect(statusControl(page, "planned")).toHaveCount(1);
  });

  test("an untouched status is not written, not even a stale active", async ({ page, api }) => {
    const sent = recordChapterPatches(page);
    const title = "Chapter 1: Salt Harbour";

    // The edit mode opens on the active chapter …
    await openEditMode(page, api);
    await expect(statusControl(page, "active")).toBeVisible();
    // … and another writer activates the second chapter under it.
    await patchChapter(api, OTHER_CHAPTER, { status: "active" });
    expect((await getChapter(api, CHAPTER)).status).toBe("planned");

    // Only the title is touched. The frozen rev is stale: the first attempt
    // is the 409 of decisions/writes, nothing written.
    await titleInput(page).fill(title);
    await saveButton(page).click();
    const conflicted = conflict(page);
    await expect(conflicted.line).toBeVisible();
    await conflicted.force.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    // The title is written, the status is not even mentioned — and the
    // chapter the other writer activated keeps it.
    expect((await getChapter(api, CHAPTER)).title).toBe(title);
    expect(await activeChapters(api)).toEqual([OTHER_CHAPTER]);
    expect(sent).toHaveLength(2);
    // Both attempts sent the title and nothing else (the second one forced).
    for (const body of sent) {
      expect(Object.keys(body).filter((key) => key !== "force").sort()).toEqual(["rev", "title"]);
    }
  });

  test("the chapter overview's edit action opens the chapter's edit mode", async ({
    page,
    api,
  }) => {
    await page.goto("/campaigns/beispiel");
    // The active chapter is open by default; its edit action leads to its edit mode.
    await page.getByRole("button", { name: ui("chapterOverview.chapter.edit") }).click();
    await expect(page).toHaveURL(new RegExp(`${CHAPTER_URL}$`));
    await expect(titleInput(page)).toHaveValue((await getChapter(api, CHAPTER)).title);

    // Leaving without a change needs no question, and a reload does not
    // reopen the edit mode — the flag was an instruction for one navigation.
    await cancelButton(page).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(titleInput(page)).toHaveCount(0);
  });

  test("leaving with unsaved work asks first — cancel and navigation alike", async ({
    page,
    api,
  }) => {
    const before = await chapterFields(api);
    const discardDialog = page.getByRole("dialog", { name: ui("bodyEditor.discard.title") });

    // Nothing typed: cancel leaves at once.
    const title = await openEditMode(page, api);
    await cancelButton(page).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    // Something typed: cancel asks, and keeping on editing keeps it.
    await editAction(page).click();
    await titleInput(page).fill("A title that is never saved");
    await cancelButton(page).click();
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
    await expect(discardDialog).toHaveCount(0);
    await expect(titleInput(page)).toHaveValue("A title that is never saved");

    // A navigation asks the same question: ⌘K works over the edit mode.
    const leaveDialog = page.getByRole("dialog", { name: ui("properties.discard.title") });
    await page.keyboard.press("ControlOrMeta+KeyK");
    await page.getByRole("combobox").fill("north cove");
    await page.getByRole("option").filter({ hasText: OTHER_CHAPTER_TITLE }).first().click();
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
    await expect(page).toHaveURL(new RegExp(`${CHAPTER_URL}$`));
    await expect(titleInput(page)).toHaveValue("A title that is never saved");

    // Discarding goes on to the other chapter, which opens in its reading view.
    await page.keyboard.press("ControlOrMeta+KeyK");
    await page.getByRole("combobox").fill("north cove");
    await page.getByRole("option").filter({ hasText: OTHER_CHAPTER_TITLE }).first().click();
    await leaveDialog.getByRole("button", { name: ui("common.discard") }).click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/beispiel/chapters/${OTHER_CHAPTER}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(OTHER_CHAPTER_TITLE);
    await expect(titleInput(page)).toHaveCount(0);
    expect(await chapterFields(api)).toEqual(before);

    // Back on the first chapter: the reading view, never an edit mode seeded anew.
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(titleInput(page)).toHaveCount(0);
  });
});

test("a second writer: the conflict line stands above the title and saving anyway keeps the other text", async ({
  page,
  api,
}) => {
  const before = await chapterFields(api);
  const theirs = "Changed by a second writer.\n";
  const title = "Chapter 1: The beacon goes dark";

  await openEditMode(page, api);
  await titleInput(page).fill(title);

  // The second writer touches only the text, with a fresh guard.
  await patchChapter(api, CHAPTER, { body: theirs });
  await saveButton(page).click();

  // Refused: the conflict line with both answers, ABOVE the title.
  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  const lineBox = await conflicted.line.boundingBox();
  const titleBox = await titleInput(page).boundingBox();
  expect(lineBox?.y ?? Infinity).toBeLessThan(titleBox?.y ?? 0);
  // The draft stands and nothing of it was written.
  await expect(titleInput(page)).toHaveValue(title);
  expect(await chapterFields(api)).toEqual({ ...before, body: theirs });

  // Saving anyway writes the changed field only: the other writer's text stays.
  await conflicted.force.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(conflicted.line).toHaveCount(0);
  expect(await chapterFields(api)).toEqual({ ...before, title, body: theirs });
  await expect(page.getByRole("article")).toContainText("Changed by a second writer.");
});

test("a second writer's status change is a conflict too; reloading takes the stored chapter", async ({
  page,
  api,
}) => {
  const theirTitle = "Chapter 1 (renamed elsewhere)";

  const title = await openEditMode(page, api);
  await titleInput(page).fill("A title that is never written");
  const textarea = await markdownSurface(page, title);
  await textarea.fill("My draft.\n");

  // The second writer: title and status of the same row, its own fresh rev.
  await patchChapter(api, CHAPTER, { title: theirTitle, status: "done" });
  await saveButton(page).click();

  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  await expect(textarea).toHaveValue("My draft.\n");
  const stored = await chapterFields(api);
  expect(stored.body).not.toContain("My draft.");

  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  // Every part of the page now shows what is stored, and there is nothing to save.
  await expect(titleInput(page)).toHaveValue(theirTitle);
  await expect(statusControl(page, "done")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: ui("bodyEditor.markdown.aria", { path: theirTitle }) }),
  ).toHaveValue(stored.body);
  await expect(saveButton(page)).toBeDisabled();
  expect(await chapterFields(api)).toEqual(stored);
});

// Critical path 8's width: the phone. The editor takes the full width, the
// save actions are at the bottom of the screen, and nothing scrolls sideways.
test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** How far the page scrolls sideways — nothing at all is the rule. */
  async function overflow(page: Page): Promise<number> {
    return page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  }

  test("title, status and the save at the bottom", async ({ page, api }) => {
    const before = await chapterFields(api);
    const title = "Chapter 1 at night";

    await openEditMode(page, api);
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // The save sits at the bottom of the screen.
    const save = saveButton(page);
    const box = await save.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(844 - 80);

    await titleInput(page).fill(title);
    await pickStatus(page, "active", "done");
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    await expect(page.getByText(ui("editMode.changes", { count: 2 })).first()).toBeVisible();
    await save.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    expect(await chapterFields(api)).toEqual({ ...before, title, status: "done" });
  });
});
