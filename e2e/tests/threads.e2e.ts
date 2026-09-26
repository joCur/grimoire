// Critical paths 1 and 5: a thread is its own resource (decisions/resources) —
// `…/threads/:id`, `{ id, chapter, text, done, rev }` — kept in the chapter
// overview. See CLAUDE.md.
//
// The review adopts a thread by creating one (review.e2e.ts). Here the
// threads are kept by hand, where the design reference puts them — under the
// chapter's text: add a thread, tick it, reword it, delete it. Every one of
// those writes answers the one thread it wrote and moves only that thread's
// own guard; the CHAPTER — its text and its `rev` — stays exactly as it was,
// so an open chapter editor never runs into a conflict over a thread.
//
// A write against a thread that moved is a 409 that writes nothing, and the
// overview answers it with the conflict line and its reload action.

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";
import type { Api } from "../support/api";
import { chapterPath, getChapter } from "../support/chapter";
import { createThread, getThread, getThreads, patchThread, threadPath } from "../support/thread";
import { ui, uiExact } from "../support/ui";

const CHAPTER = "01-salzhafen";
// The seeded thread of the example campaign.
const SEEDED = "Wer bezahlt die Schmuggler?";

function threadList(page: Page) {
  return page.getByRole("list", { name: ui("chapterOverview.threads.label") });
}

/** The done checkbox of the thread with the given text. */
function doneBox(page: Page, text: string) {
  return page.getByRole("checkbox", { name: ui("chapterOverview.threads.done.aria", { text }) });
}

/** The edit action of the thread with the given text. */
function editAction(page: Page, text: string) {
  return page.getByRole("button", { name: ui("chapterOverview.threads.edit.aria", { text }) });
}

/** The field a thread with the given text is reworded in. */
function editField(page: Page, text: string) {
  return page.getByRole("textbox", { name: ui("chapterOverview.threads.edit.aria", { text }) });
}

/** The save action of the reworded row. */
function saveAction(page: Page) {
  return page.getByRole("button", { name: uiExact("common.save") });
}

async function stored(api: Api): Promise<Array<[string, boolean]>> {
  return (await getThreads(api, CHAPTER)).map((row) => [row.text, row.done]);
}

test("the chapter overview keeps the threads: add, tick, reword, delete — the chapter never moves", async ({
  page,
  api,
}) => {
  const chapterBefore = await getChapter(api, CHAPTER);
  await page.goto("/campaigns/beispiel");

  // The seeded thread is a row under the chapter's text, open.
  const list = threadList(page);
  await expect(list.getByRole("listitem")).toHaveText([SEEDED]);
  await expect(doneBox(page, SEEDED)).not.toBeChecked();

  // --- add one by hand -------------------------------------------------------
  const added = "Who put out the beacon?";
  await page.getByRole("button", { name: ui("chapterOverview.threads.add") }).click();
  const input = page.getByRole("textbox", { name: ui("chapterOverview.threads.input") });
  await input.fill(added);
  await page.getByRole("button", { name: uiExact("chapterOverview.threads.addSubmit") }).click();
  await expect(list.getByRole("listitem")).toHaveText([SEEDED, added]);
  // The add line stays open and empty for the next one; Escape closes it.
  await expect(input).toHaveValue("");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect.poll(() => stored(api)).toEqual([
    [SEEDED, false],
    [added, false],
  ]);

  // --- tick it off, and back ---------------------------------------------------
  const tick = doneBox(page, added);
  await tick.check();
  await expect(tick).toBeChecked();
  await expect.poll(() => stored(api)).toEqual([
    [SEEDED, false],
    [added, true],
  ]);
  await tick.uncheck();
  await expect(tick).not.toBeChecked();
  await expect.poll(() => stored(api)).toEqual([
    [SEEDED, false],
    [added, false],
  ]);

  // --- reword it ----------------------------------------------------------------
  const reworded = "Who really put out the beacon?";
  await editAction(page, added).click();
  const field = editField(page, added);
  await expect(field).toHaveValue(added);
  await field.fill(reworded);
  await saveAction(page).click();
  await expect(list.getByRole("listitem")).toHaveText([SEEDED, reworded]);
  await expect.poll(() => stored(api)).toEqual([
    [SEEDED, false],
    [reworded, false],
  ]);

  // --- delete it — it asks first, naming the thread ------------------------------
  await page
    .getByRole("button", { name: ui("chapterOverview.threads.remove.aria", { text: reworded }) })
    .click();
  const dialog = page.getByRole("dialog", { name: ui("chapterOverview.threads.confirmDelete.title") });
  await expect(dialog).toContainText(reworded);
  await dialog
    .getByRole("button", { name: uiExact("chapterOverview.threads.confirmDelete.confirm") })
    .click();
  await expect(list.getByRole("listitem")).toHaveText([SEEDED]);
  await expect.poll(() => stored(api)).toEqual([[SEEDED, false]]);

  // Five writes to threads, none to the chapter; the seeded thread's own
  // guard never moved.
  const chapterAfter = await getChapter(api, CHAPTER);
  expect(chapterAfter.body).toBe(chapterBefore.body);
  expect(chapterAfter.rev).toBe(chapterBefore.rev);
  expect((await getThreads(api, CHAPTER))[0]!.rev).toBe(1);
});

test("a second writer changed the thread: the save is refused, the reload action takes the stored state", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  await expect(threadList(page).getByRole("listitem")).toHaveText([SEEDED]);

  // The row is opened for rewording — on the thread as it stood then.
  await editAction(page, SEEDED).click();
  const field = editField(page, SEEDED);
  await field.fill("My draft");

  // Meanwhile another tab ticks the very same thread.
  const [seeded] = await getThreads(api, CHAPTER);
  await patchThread(api, seeded!.id, { rev: seeded!.rev, done: true });

  // The save carries the `rev` the row was opened with: 409, nothing written.
  await saveAction(page).click();
  const conflict = page.getByRole("status").filter({ hasText: ui("editConflict.line") });
  await expect(conflict).toBeVisible();
  expect(await stored(api)).toEqual([[SEEDED, true]]);

  // The reload action drops the draft and shows the threads as they are stored.
  await conflict.getByRole("button", { name: ui("editConflict.reload") }).click();
  await expect(conflict).toHaveCount(0);
  await expect(field).toHaveCount(0);
  await expect(doneBox(page, SEEDED)).toBeChecked();

  // From there the same edit lands.
  await editAction(page, SEEDED).click();
  await editField(page, SEEDED).fill("Who pays?");
  await saveAction(page).click();
  await expect.poll(() => stored(api)).toEqual([["Who pays?", true]]);
});

test("a thread write is no conflict for an open chapter editor — two guards", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: ui("chapterOverview.chapter.edit") }).click();
  const dialog = page.getByRole("dialog");
  const chapterText = dialog.getByRole("textbox", { name: ui("chapterBody.field.body") });
  // The editor opens on the stored text.
  await expect(chapterText).toHaveValue((await getChapter(api, CHAPTER)).body);
  await chapterText.fill("Light the lighthouse again.");

  // A thread is appended underneath — the write that adopting a plot thread in the review makes.
  const NOTED = "Noted in passing";
  const chapterRev = (await getChapter(api, CHAPTER)).rev;
  await createThread(api, { chapter: CHAPTER, text: NOTED });
  expect((await getChapter(api, CHAPTER)).rev).toBe(chapterRev);

  // So the chapter save lands, and the thread stands beside it.
  await dialog.getByRole("button", { name: ui("common.save") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getChapter(api, CHAPTER)).body).toContain("Light the lighthouse again.");
  expect((await stored(api)).map(([text]) => text)).toEqual([SEEDED, NOTED]);
  await expect(threadList(page).getByRole("listitem")).toHaveText([SEEDED, NOTED]);
});

test("the thread resource: flat answers, its own guard, strict fields, and nothing under the chapter", async ({
  api,
}) => {
  // Flat: every field of the thread, its chapter among them — no list around it.
  const [seeded] = await getThreads(api, CHAPTER);
  expect(seeded).toEqual({ id: seeded!.id, chapter: CHAPTER, text: SEEDED, done: false, rev: 1 });
  expect(await getThread(api, seeded!.id)).toEqual(seeded);

  // The address under the chapter names nothing.
  expect((await api.fetch(`${chapterPath(api, CHAPTER)}/threads`)).status).toBe(404);

  const send = (method: string, id: string, body: unknown) =>
    api.fetch(threadPath(api, id), {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // A key that is no field of a thread is a 400 that names it, and writes nothing.
  const unknown = await send("PATCH", seeded!.id, { rev: 1, done: true, pos: 3 });
  expect(unknown.status).toBe(400);
  expect(await unknown.text()).toContain("pos");

  // A stale `rev` is 409 with the current thread, and writes nothing.
  const ticked = await patchThread(api, seeded!.id, { rev: 1, done: true });
  const stale = await send("PATCH", seeded!.id, { rev: 1, text: "Overwritten?" });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "rev_conflict", rev: 2, thread: ticked });
  const deleted = await send("DELETE", seeded!.id, { rev: 1 });
  expect(deleted.status).toBe(409);
  expect(await getThread(api, seeded!.id)).toEqual(ticked);
});
