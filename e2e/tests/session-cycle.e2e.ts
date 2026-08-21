// Critical path 4: the session cycle; see CLAUDE.md.
//
// start → quick note → log + scenes_played → pause → end → review.
//
// Every claim is checked twice: once in the UI and once in the file on disk
// (the server is the truth, the app keeps no state of its own).

import { expect, test } from "../support/test";

const NOTE = "Gruppe verhandelt mit Jorna am Fuß der Treppe #thread";

test("session start, quick note, pause, end — log and file follow", async ({
  page,
  files,
}) => {
  await page.goto("/beispiel");

  // Nothing on disk yet — the session file is created by the button.
  const sessionPath = files.todaySession();
  expect(await files.exists(sessionPath)).toBe(false);

  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);

  // Live topbar: the green pill and the active chapter.
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByText("Kapitel 1: Der Leuchtturm von Salzhafen")).toBeVisible();

  // Left nav of the active chapter, center column = the selected scene.
  const nav = page.getByRole("navigation", { name: "Szenen der Session" });
  await expect(nav).toContainText("Geplant");
  await expect(nav).toContainText("Ankunft am Leuchtturm");
  await expect(nav).toContainText("Falls es schiefgeht");
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toHaveText(
    "Ankunft am Leuchtturm",
  );
  // NPC card of the selected scene in the right aside.
  await expect(page.getByRole("link", { name: /Hafenmeisterin Jorna/ })).toBeVisible();

  // Fresh session: the log is empty and says where entries come from.
  await expect(
    page.getByText("Noch keine Einträge — die Schnellnotiz unten landet hier."),
  ).toBeVisible();

  await expect
    .poll(() => files.read(sessionPath))
    .toContain("scenes_played: []");

  // --- quick note ("Schnellnotiz") ------------------------------------------
  const quickNote = page.getByLabel("Schnellnotiz");
  await quickNote.fill(NOTE);
  await quickNote.press("Enter");

  // The panel shows the entry (server round trip, no optimistic guessing).
  const log = page.getByText(NOTE);
  await expect(log).toBeVisible();
  await expect(quickNote).toHaveValue("");

  // …and the file gained the line plus the played scene id.
  await expect
    .poll(() => files.read(sessionPath))
    .toMatch(/- \d{2}:\d{2} \(lighthouse-arrival\) Gruppe verhandelt mit Jorna am Fuß der Treppe #thread/);
  await expect.poll(() => files.read(sessionPath)).toContain("scenes_played:");
  await expect.poll(() => files.read(sessionPath)).toContain("lighthouse-arrival");

  // The played checkmark comes from scenes_played — never faked client-side.
  await expect(nav.getByText("gespielt")).toBeAttached();

  // --- pause ---------------------------------------------------------------
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("— Pause")).toBeVisible();
  await expect.poll(() => files.read(sessionPath)).toMatch(/- \d{2}:\d{2} — Pause/);

  // --- end -> review -------------------------------------------------------
  await page.getByRole("button", { name: "Session beenden" }).click();
  await expect(page).toHaveURL(/\/beispiel\/review$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fünf Minuten Ernte");
  await expect.poll(() => files.read(sessionPath)).toMatch(/^ended: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/m);

  // The harvest card for the tagged note is waiting there.
  await expect(page.getByText("Gruppe verhandelt mit Jorna am Fuß der Treppe")).toBeVisible();
  await expect(page.getByText("#thread", { exact: true }).first()).toBeVisible();
});
