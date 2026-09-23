// Critical path 5, second half: a chapter's open threads are a LIST of rows
// (ADR #26, #29), kept in the chapter overview. See CLAUDE.md.
//
// The review adopts a thread by appending a row (review.e2e.ts). Here the
// same list is kept by hand, where the design reference puts it — under the
// chapter's text: add a thread, tick it, reword it, delete it. Every one
// of those writes answers the whole list and moves only the list's own guard
// (`chapters.threads_rev`); the chapter ENTRY — its text and its `rev` —
// stays exactly as it was, so an open chapter editor never runs into a
// conflict over a thread.
//
// A write against a list that moved is a 409 that writes nothing, and the
// overview answers it the way the list surfaces do: the conflict line with
// „Neu laden".

import type { Page } from "@playwright/test";

import { expect, test, type Api, type ApiThreads } from "../support/test";

const CHAPTER = "01-salzhafen";
const SEEDED = "Wer bezahlt die Schmuggler?";

function threadList(page: Page) {
  return page.getByRole("list", { name: "Offene Handlungsstränge" });
}

async function stored(api: Api): Promise<Array<[string, boolean]>> {
  return (await api.threads(CHAPTER)).entries.map((row) => [row.text, row.done]);
}

test("the chapter overview keeps the list: add, tick, reword, delete — the chapter entry never moves", async ({
  page,
  api,
}) => {
  const chapterBefore = await api.entry(CHAPTER);
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

  // Five writes to the list, none to the chapter entry.
  const chapterAfter = await api.entry(CHAPTER);
  expect(chapterAfter.body).toBe(chapterBefore.body);
  expect(chapterAfter.rev).toBe(chapterBefore.rev);
  expect((await api.threads(CHAPTER)).rev).toBe(6);
});

test("a second writer changed the list: the save is refused, „Neu laden“ takes the stored state", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  await expect(threadList(page).getByRole("listitem")).toHaveText([SEEDED]);

  // The row is opened for rewording — on the list as it stood then.
  await page.getByRole("button", { name: `„${SEEDED}“ bearbeiten` }).click();
  const field = page.getByRole("textbox", { name: `„${SEEDED}“ bearbeiten` });
  await field.fill("Mein Entwurf");

  // Meanwhile another tab ticks the very same thread.
  const before = await api.threads(CHAPTER);
  const id = before.entries[0]!.id;
  await api.send<ApiThreads>("PATCH", api.threadsPath(CHAPTER, id), { rev: before.rev, done: true });

  // The save carries the token the row was opened with: 409, nothing written.
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  const conflict = page.getByRole("status").filter({ hasText: "Inzwischen geändert" });
  await expect(conflict).toBeVisible();
  expect(await stored(api)).toEqual([[SEEDED, true]]);

  // „Neu laden" drops the draft and shows the list as it is stored.
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
  const chapterRev = (await api.entry(CHAPTER)).rev;
  await api.send<ApiThreads>("POST", api.threadsPath(CHAPTER), { text: "Nebenbei notiert" });
  expect((await api.entry(CHAPTER)).rev).toBe(chapterRev);

  // So the chapter save lands, and the thread stands beside it.
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => api.body(CHAPTER)).toContain("Den Leuchtturm wieder anzünden.");
  expect((await stored(api)).map(([text]) => text)).toEqual([SEEDED, "Nebenbei notiert"]);
  await expect(threadList(page).getByRole("listitem")).toHaveText([SEEDED, "Nebenbei notiert"]);
});
