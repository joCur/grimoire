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
// overview answers it with the conflict line and „Neu laden".

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";
import type { Api } from "../support/api";
import { chapterPath, getChapter } from "../support/chapter";
import { createThread, getThread, getThreads, patchThread, threadPath } from "../support/thread";

const CHAPTER = "01-salzhafen";
const SEEDED = "Wer bezahlt die Schmuggler?";

function threadList(page: Page) {
  return page.getByRole("list", { name: "Offene Handlungsstränge" });
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
  await expect(page.getByRole("checkbox", { name: `„${SEEDED}“ erledigt` })).not.toBeChecked();

  // --- add one by hand -------------------------------------------------------
  const added = "Wer hat das Leuchtfeuer gelöscht?";
  await page.getByRole("button", { name: "Handlungsstrang hinzufügen" }).click();
  const input = page.getByRole("textbox", { name: "Offener Handlungsstrang" });
  await input.fill(added);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
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
  const tick = page.getByRole("checkbox", { name: `„${added}“ erledigt` });
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
  const reworded = "Wer hat das Leuchtfeuer wirklich gelöscht?";
  await page.getByRole("button", { name: `„${added}“ bearbeiten` }).click();
  const field = page.getByRole("textbox", { name: `„${added}“ bearbeiten` });
  await expect(field).toHaveValue(added);
  await field.fill(reworded);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveText([SEEDED, reworded]);
  await expect.poll(() => stored(api)).toEqual([
    [SEEDED, false],
    [reworded, false],
  ]);

  // --- delete it — it asks first, naming the thread ------------------------------
  await page.getByRole("button", { name: `„${reworded}“ löschen` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Handlungsstrang löschen?");
  await expect(dialog).toContainText(reworded);
  await dialog.getByRole("button", { name: "Löschen" }).click();
  await expect(list.getByRole("listitem")).toHaveText([SEEDED]);
  await expect.poll(() => stored(api)).toEqual([[SEEDED, false]]);

  // Five writes to threads, none to the chapter; the seeded thread's own
  // guard never moved.
  const chapterAfter = await getChapter(api, CHAPTER);
  expect(chapterAfter.body).toBe(chapterBefore.body);
  expect(chapterAfter.rev).toBe(chapterBefore.rev);
  expect((await getThreads(api, CHAPTER))[0]!.rev).toBe(1);
});

test("a second writer changed the thread: the save is refused, „Neu laden“ takes the stored state", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  await expect(threadList(page).getByRole("listitem")).toHaveText([SEEDED]);

  // The row is opened for rewording — on the thread as it stood then.
  await page.getByRole("button", { name: `„${SEEDED}“ bearbeiten` }).click();
  const field = page.getByRole("textbox", { name: `„${SEEDED}“ bearbeiten` });
  await field.fill("Mein Entwurf");

  // Meanwhile another tab ticks the very same thread.
  const [seeded] = await getThreads(api, CHAPTER);
  await patchThread(api, seeded!.id, { rev: seeded!.rev, done: true });

  // The save carries the `rev` the row was opened with: 409, nothing written.
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  const conflict = page.getByRole("status").filter({ hasText: "Inzwischen geändert" });
  await expect(conflict).toBeVisible();
  expect(await stored(api)).toEqual([[SEEDED, true]]);

  // „Neu laden" drops the draft and shows the threads as they are stored.
  await conflict.getByRole("button", { name: "Neu laden" }).click();
  await expect(conflict).toHaveCount(0);
  await expect(field).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: `„${SEEDED}“ erledigt` })).toBeChecked();

  // From there the same edit lands.
  await page.getByRole("button", { name: `„${SEEDED}“ bearbeiten` }).click();
  await page.getByRole("textbox", { name: `„${SEEDED}“ bearbeiten` }).fill("Wer zahlt?");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect.poll(() => stored(api)).toEqual([["Wer zahlt?", true]]);
});

test("a thread write is no conflict for an open chapter editor — two guards", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: "Kapitel bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  const chapterText = dialog.getByRole("textbox", { name: "Text" });
  await expect(chapterText).toHaveValue(/Leuchtfeuer/);
  await chapterText.fill("Den Leuchtturm wieder anzünden.");

  // A thread is appended underneath — the write „Handlungsstrang übernehmen" makes.
  const chapterRev = (await getChapter(api, CHAPTER)).rev;
  await createThread(api, { chapter: CHAPTER, text: "Nebenbei notiert" });
  expect((await getChapter(api, CHAPTER)).rev).toBe(chapterRev);

  // So the chapter save lands, and the thread stands beside it.
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getChapter(api, CHAPTER)).body).toContain("Den Leuchtturm wieder anzünden.");
  expect((await stored(api)).map(([text]) => text)).toEqual([SEEDED, "Nebenbei notiert"]);
  await expect(threadList(page).getByRole("listitem")).toHaveText([SEEDED, "Nebenbei notiert"]);
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
  const stale = await send("PATCH", seeded!.id, { rev: 1, text: "Überschrieben?" });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "rev_conflict", rev: 2, thread: ticked });
  const deleted = await send("DELETE", seeded!.id, { rev: 1 });
  expect(deleted.status).toBe(409);
  expect(await getThread(api, seeded!.id)).toEqual(ticked);
});
