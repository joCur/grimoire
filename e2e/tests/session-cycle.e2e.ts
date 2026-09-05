// Critical path 4: the session cycle; see CLAUDE.md.
//
// start → quick note → log + scenes_played → NPC/location drawer → back into
// the session via the global live indicator → pause (the clock stops) →
// weiter (it ticks again) → end → review → and, since issue #58, the restart:
// "beenden" is FINAL, so pressing "Session starten" again on the same day
// opens a SECOND, separate session (own file `<date>-2`, empty log, timer at
// 0) instead of re-opening the closed one. There is no "fortsetzen".
//
// Plus its undo at the very start: "Session verwerfen" deletes the file of a
// session that has nothing in it (issue #40 AK7) — its own test below.
//
// Every claim is checked twice: once in the UI and once in the stored file
// (the server is the truth, the app keeps no state of its own).

import type { Page } from "@playwright/test";

import { expect, test, todaySessionId, todaySessionPath } from "../support/test";

const NOTE = "Gruppe verhandelt mit Jorna am Fuß der Treppe #thread";

/**
 * The path of the n-th session of today (issue #58): the plain date for the
 * first, `<date>-2`, `-3` … for the ones that follow — "Session beenden" is
 * final, so a second evening on the same day is a second session.
 */
function nthSessionPath(n: number): string {
  return n === 1 ? todaySessionPath() : `sessions/${todaySessionId()}-${n}.md`;
}

/** The session chip in menu mode (on /live) — the ONE session control. */
const sessionMenuChip = (page: Page) =>
  page.getByRole("button", { name: /Session läuft/ }).first();

/** The session chip in link mode (every other route, and the mobile row). */
const sessionLinkChip = (page: Page) => page.getByRole("link", { name: /Session läuft/ }).first();

/**
 * Opens the session menu on /live and returns the requested entry. The chip
 * carries the STATE in its accessible name, so a paused session is reached
 * through "Session pausiert" (issue #40 AK8).
 */
async function sessionMenuItem(page: Page, name: string) {
  await page.getByRole("button", { name: /Session (läuft|pausiert)/ }).first().click();
  return page.getByRole("menuitem", { name });
}

test("session start, quick note, pause, end — log and file follow", async ({
  page,
  api,
}) => {
  await page.goto("/beispiel");

  // No session stored yet — the session file is created by the button.
  const sessionPath = todaySessionPath();
  expect(await api.exists(sessionPath)).toBe(false);

  // ONE session control across ALL states (PO requirement on issue #40): the
  // offer to start and the running session are the SAME chip in the SAME
  // slot — same height, same right edge, same vertical center. Only the
  // content and the colour change; nothing in the chrome moves.
  const startChip = page.getByRole("button", { name: "Session starten" });
  const startBox = await startChip.boundingBox();

  await startChip.click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);

  // The topbar carries ONE session control: the chip, brass, with the running
  // time as H:MM:SS. No "Live" label, no separate timer or buttons any more.
  const chip = sessionMenuChip(page);
  await expect(chip).toBeVisible();

  // Same element, same place: the chip that now ticks sits exactly where the
  // start offer sat — same height, same right edge, same middle.
  const runningBox = await chip.boundingBox();
  expect(startBox).not.toBeNull();
  expect(runningBox).not.toBeNull();
  if (startBox !== null && runningBox !== null) {
    expect(runningBox.height).toBe(startBox.height);
    expect(Math.round(runningBox.x + runningBox.width)).toBe(
      Math.round(startBox.x + startBox.width),
    );
    expect(Math.round(runningBox.y + runningBox.height / 2)).toBe(
      Math.round(startBox.y + startBox.height / 2),
    );
  }
  await expect(chip).toContainText(/\d+:\d{2}:\d{2}/);
  // …and it starts at ZERO. `started` is written to the second (issue #58);
  // when it was minute-precise the reading rounded down to the start of the
  // minute and the fresh chip could open at up to 0:00:59.
  await expect(chip).toContainText(/\b0:00:0[0-4]\b/);
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0);

  // The clock really ticks (1s), it is not a frozen render: two readings more
  // than a second apart differ.
  const firstReading = await chip.textContent();
  await expect
    .poll(() => chip.textContent(), { timeout: 5_000 })
    .not.toBe(firstReading);

  // Left nav of the active chapter — which now names the chapter itself.
  const nav = page.getByRole("navigation", { name: "Szenen der Session" });
  await expect(nav).toContainText("Kapitel 1: Der Leuchtturm von Salzhafen");
  await expect(nav).toContainText("Geplant");
  await expect(nav).toContainText("Ankunft am Leuchtturm");
  await expect(nav).toContainText("Falls es schiefgeht");
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toHaveText(
    "Ankunft am Leuchtturm",
  );
  // NPC card of the selected scene in the right aside — a BUTTON here, not a
  // link: in the live mode it opens the drawer (issue #40).
  await expect(page.getByRole("button", { name: /Hafenmeisterin Jorna/ })).toBeVisible();
  // …and the location of the scene, as its own card next to the NPCs. Scoped
  // to the aside: the campaign switcher in the topbar carries the same name
  // now that the live route shares the global chrome.
  const aside = page.getByRole("complementary");
  await expect(aside.getByRole("button", { name: /Der Leuchtturm von Salzhafen/ })).toBeVisible();

  // Fresh session: the log is empty and says where entries come from.
  await expect(
    page.getByText("Noch keine Einträge — die Schnellnotiz unten landet hier."),
  ).toBeVisible();

  await expect
    .poll(() => api.raw(sessionPath))
    .toContain("scenes_played: []");

  // …and while it is empty, the session menu offers to discard it (#40 AK7).
  await expect(await sessionMenuItem(page, "Session verwerfen")).toBeVisible();
  await page.keyboard.press("Escape");

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
    .poll(() => api.raw(sessionPath))
    .toMatch(/- \d{2}:\d{2} \(lighthouse-arrival\) Gruppe verhandelt mit Jorna am Fuß der Treppe #thread/);
  await expect.poll(() => api.raw(sessionPath)).toContain("scenes_played:");
  await expect.poll(() => api.raw(sessionPath)).toContain("lighthouse-arrival");

  // The played checkmark comes from scenes_played — never faked client-side.
  await expect(nav.getByText("gespielt")).toBeAttached();

  // The session has content now — discarding it is no longer on offer; the
  // way out is "Session beenden".
  await sessionMenuChip(page).click();
  await expect(page.getByRole("menuitem", { name: "Session verwerfen" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Session beenden" })).toBeVisible();
  await page.keyboard.press("Escape");

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
  await aside.getByRole("button", { name: /Der Leuchtturm von Salzhafen/ }).click();
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
  // … but the same chip, in link mode, with the running time — on this route
  // too, and in the very same slot of the topbar.
  const backToLive = sessionLinkChip(page);
  await expect(backToLive).toBeVisible();
  await expect(backToLive).toContainText(/\d+:\d{2}:\d{2}/);
  await backToLive.click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);
  await expect(page.getByText(NOTE)).toBeVisible();

  // --- pause: the clock really STOPS (issue #40 AK8) ------------------------
  await (await sessionMenuItem(page, "Pause")).click();
  await expect(page.getByText("— Pause")).toBeVisible();
  await expect.poll(() => api.raw(sessionPath)).toMatch(/- \d{2}:\d{2} — Pause/);
  // The interval is in the file, still open (no `to` yet) …
  await expect.poll(() => api.raw(sessionPath)).toMatch(/pauses: \[\{from: [\d\-T:]+\}\]/);

  // … the chip is the same chip, dimmed, and says so.
  const pausedChip = page.getByRole("button", { name: /Session pausiert/ }).first();
  await expect(pausedChip).toBeVisible();
  await expect(pausedChip).toHaveAttribute("data-session-chip", "paused");

  // And this is the point of the whole ticket: the time does NOT move while
  // the session is paused. Two readings more than a second apart are equal
  // (the running clock above was proven to tick within the same test).
  const stopped = await pausedChip.textContent();
  await page.waitForTimeout(2_500);
  expect(await pausedChip.textContent()).toBe(stopped);

  // --- weiter: the same menu entry, the other direction ---------------------
  await (await sessionMenuItem(page, "Weiter")).click();
  await expect(page.getByText("— Weiter")).toBeVisible();
  // The interval is closed in the file (`to` written) …
  await expect
    .poll(() => api.raw(sessionPath))
    .toMatch(/pauses: \[\{from: [\d\-T:]+, to: [\d\-T:]+\}\]/);
  // … the chip is brass again, and the clock ticks once more.
  const runningAgain = sessionMenuChip(page);
  await expect(runningAgain).toBeVisible();
  const resumed = await runningAgain.textContent();
  await expect
    .poll(() => runningAgain.textContent(), { timeout: 5_000 })
    .not.toBe(resumed);

  // Both log lines are in the file — the readable chronicle of the evening.
  const withPause = await api.raw(sessionPath);
  expect(withPause).toMatch(/- \d{2}:\d{2} — Pause/);
  expect(withPause).toMatch(/- \d{2}:\d{2} — Weiter/);

  // --- end -> review -------------------------------------------------------
  await (await sessionMenuItem(page, "Session beenden")).click();
  await expect(page).toHaveURL(/\/beispiel\/review$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fünf Minuten Ernte");
  await expect.poll(() => api.raw(sessionPath)).toMatch(/^ended: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/m);

  // The harvest card for the tagged note is waiting there.
  await expect(page.getByText("Gruppe verhandelt mit Jorna am Fuß der Treppe")).toBeVisible();
  await expect(page.getByText("#thread", { exact: true }).first()).toBeVisible();

  // --- beenden is FINAL, and a restart is a NEW session (issue #58) --------
  // The chip offers a plain "Session starten" right after the end — no
  // "fortsetzen" anywhere — and that press opens a SECOND session of the same
  // day: own file (`<date>-2`), empty log, timer back at 0. The first
  // session keeps its `ended`, its log and its pauses.
  await page.goto("/beispiel");
  const startAgain = page.getByRole("button", { name: "Session starten" });
  await expect(startAgain).toBeVisible();
  await expect(page.getByRole("button", { name: /fortsetzen/i })).toHaveCount(0);
  await startAgain.click();

  await expect(page).toHaveURL(/\/beispiel\/live$/);
  await expect(sessionMenuChip(page)).toBeVisible();
  // The timer of the SECOND session starts at zero too — the bug that made an
  // end→start look like the old session kept counting (issue #58).
  await expect(sessionMenuChip(page)).toContainText(/\b0:00:0[0-4]\b/);
  // A fresh, empty session: nothing of the first evening is shown …
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect(page.getByText("— Pause")).toHaveCount(0);
  // … it lives in its OWN file …
  const secondPath = nthSessionPath(2);
  await expect.poll(() => api.exists(secondPath)).toBe(true);
  const second = await api.raw(secondPath);
  expect(second).toContain(`id: ${todaySessionId()}-2`);
  expect(second).not.toContain("ended:");
  expect(second).not.toContain("pauses:");
  expect(second).not.toContain(NOTE);
  // … and the first session is untouched: still ended, log and pauses intact.
  const first = await api.raw(sessionPath);
  expect(first).toMatch(/^ended: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/m);
  expect(first).toContain(NOTE);
  expect(first).toMatch(/pauses: \[\{from: [\d\-T:]+, to: [\d\-T:]+\}\]/);

  // The two sessions stay separate under writing: a note now lands in the
  // SECOND one only, and its own pause is its own.
  const SECOND_NOTE = "Zweite Runde: die Gruppe bricht zum Leuchtturm auf #thread";
  const secondNoteField = page.getByLabel("Schnellnotiz");
  await secondNoteField.fill(SECOND_NOTE);
  await secondNoteField.press("Enter");
  await expect.poll(() => api.raw(secondPath)).toContain(SECOND_NOTE);
  expect(await api.raw(sessionPath)).not.toContain(SECOND_NOTE);
  await (await sessionMenuItem(page, "Pause")).click();
  await expect.poll(() => api.raw(secondPath)).toMatch(/pauses: \[\{from: [\d\-T:]+\}\]/);
  // The first session's pause list did not grow.
  expect((await api.raw(sessionPath)).match(/from:/g)?.length).toBe(1);

  // Ending the second one leads to the review of the SECOND session — the
  // harvest works on the LAST STARTED session, which is this one.
  await (await sessionMenuItem(page, "Session beenden")).click();
  await expect(page).toHaveURL(/\/beispiel\/review$/);
  await expect.poll(() => api.raw(secondPath)).toMatch(/^ended: /m);
  await expect(
    page.getByText("Zweite Runde: die Gruppe bricht zum Leuchtturm auf"),
  ).toBeVisible();
  await expect(
    page.getByText("Gruppe verhandelt mit Jorna am Fuß der Treppe"),
  ).toHaveCount(0);
});

test("session verwerfen — the mis-click's undo removes the empty file", async ({
  page,
  api,
}) => {
  await page.goto("/beispiel");
  const sessionPath = todaySessionPath();

  // "Session starten" hit by accident.
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);
  await expect.poll(() => api.exists(sessionPath)).toBe(true);

  // It asks first — the file is deleted, and that is what the dialog says.
  await (await sessionMenuItem(page, "Session verwerfen")).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Leere Session verwerfen?");
  await expect(dialog).toContainText("Die Datei wird gelöscht.");

  // Abbrechen changes nothing at all.
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();
  expect(await api.exists(sessionPath)).toBe(true);

  await (await sessionMenuItem(page, "Session verwerfen")).click();
  await page.getByRole("dialog").getByRole("button", { name: "Verwerfen" }).click();

  // Back in the non-live state: the pool offers a start again …
  await expect(page).toHaveURL(/\/beispiel$/);
  await expect(page.getByRole("button", { name: "Session starten" })).toBeVisible();
  // … no session chip is left over …
  await expect(page.getByRole("link", { name: /Session läuft/ })).toHaveCount(0);
  // … and the session file is gone.
  await expect.poll(() => api.exists(sessionPath)).toBe(false);

  // And the start really works again (it is not blocked by a stale session).
  // The new session gets the NEXT id, not the discarded one back (#58 review):
  // an id, once handed out, never names a second evening.
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);
  await expect.poll(() => api.exists(nthSessionPath(2))).toBe(true);
  expect(await api.exists(sessionPath)).toBe(false);
});

// The third state of the ONE session control (PO requirement on issue #40): an
// unreachable session lookup. It used to be a bare sentence next to the chrome
// while the start button stood there offering something that could not work;
// now it is the SAME chip, dimmed, inert, saying so.
test("an unreachable session lookup dims the chip instead of offering a start", async ({
  page,
}) => {
  await page.route("**/api/beispiel/session**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );

  await page.goto("/beispiel");

  const unknown = page.getByRole("status", { name: /Session-Status unbekannt/ });
  await expect(unknown).toBeVisible();
  await expect(unknown).toContainText("Status unbekannt");
  // Nothing to press, and above all no start that could not work.
  await expect(page.getByRole("button", { name: "Session starten" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Session läuft/ })).toHaveCount(0);
});
