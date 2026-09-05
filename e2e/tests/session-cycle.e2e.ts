// Critical path 4: the session cycle; see CLAUDE.md.
//
// start → quick note → log + scenes_played → NPC/location drawer → back into
// the session via the global live indicator → pause → end → review.
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
  // NPC card of the selected scene in the right aside — a BUTTON here, not a
  // link: in the live mode it opens the drawer (issue #40).
  await expect(page.getByRole("button", { name: /Hafenmeisterin Jorna/ })).toBeVisible();
  // …and the location of the scene, as its own card next to the NPCs.
  await expect(page.getByRole("button", { name: /Der Leuchtturm von Salzhafen/ })).toBeVisible();

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

  // --- NPC drawer inside the live mode (issue #40) --------------------------
  // A card click must NOT navigate: the selected scene and a half-typed
  // Schnellnotiz have to survive opening and closing the drawer.
  const draft = "halb getippt, nicht gesendet";
  await quickNote.fill(draft);
  await page.getByRole("button", { name: /Hafenmeisterin Jorna/ }).click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  // The full file, not the card excerpt — and the way out into the full view.
  await expect(drawer.getByRole("link", { name: "Datei öffnen" })).toHaveAttribute(
    "href",
    "/beispiel/file/npcs/jorna.md",
  );
  // Still in the live mode, session still running.
  await expect(page).toHaveURL(/\/beispiel\/live$/);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/beispiel\/live$/);
  await expect(nav.getByRole("button", { name: /Ankunft am Leuchtturm/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(quickNote).toHaveValue(draft);
  await quickNote.fill("");

  // --- the location card opens in the same drawer ---------------------------
  await page.getByRole("button", { name: /Der Leuchtturm von Salzhafen/ }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // --- the global live indicator brings the DM back (issue #40) -------------
  // The live topbar has no campaign nav (it belongs to the session), so this
  // is the DM looking something up: away to the pool, then back.
  await page.goto("/beispiel");
  await expect(page).toHaveURL(/\/beispiel$/);
  // No "Session starten" anywhere while a session runs …
  await expect(page.getByRole("button", { name: "Session starten" })).toHaveCount(0);
  // … but the live indicator with the running time, on this route too.
  const backToLive = page.getByRole("link", { name: /Zur laufenden Session/ });
  await expect(backToLive).toBeVisible();
  await expect(backToLive).toContainText(/\d+:\d{2}/);
  await backToLive.click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);
  await expect(page.getByText(NOTE)).toBeVisible();

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

  // --- ended too early? fortsetzen (issue #40 review) ----------------------
  // "Session beenden" one scene too soon used to be a dead end until
  // midnight: the Start button answered 200 with the ENDED file and nothing
  // happened. Now the start says "already ended" and the button offers to
  // resume — same file, so the evening's log stays in one piece.
  await page.goto("/beispiel");
  const startButton = page.getByRole("button", { name: "Session starten" });
  await expect(startButton).toBeVisible();
  await startButton.click();

  const resumeButton = page.getByRole("button", { name: "Session fortsetzen" });
  await expect(resumeButton).toBeVisible();
  await resumeButton.click();

  await expect(page).toHaveURL(/\/beispiel\/live$/);
  // The same session, not a fresh one: the note from before is still there …
  await expect(page.getByText(NOTE)).toBeVisible();
  // … and `ended` is gone from the file, so the session really runs again.
  await expect.poll(() => files.read(sessionPath)).not.toContain("ended:");
  await expect(page.getByRole("button", { name: "Session beenden" })).toBeVisible();
});
