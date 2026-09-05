// Critical path 4: the session cycle; see CLAUDE.md.
//
// start → quick note → log + scenes_played → NPC/location drawer → back into
// the session via the global live indicator → pause → end → review.
//
// Plus its undo at the very start: "Session verwerfen" deletes the file of a
// session that has nothing in it (issue #40 AK7) — its own test below.
//
// Every claim is checked twice: once in the UI and once in the file on disk
// (the server is the truth, the app keeps no state of its own).

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";

const NOTE = "Gruppe verhandelt mit Jorna am Fuß der Treppe #thread";

/** The session chip in menu mode (on /live) — the ONE session control. */
const sessionMenuChip = (page: Page) =>
  page.getByRole("button", { name: /Session läuft/ }).first();

/** The session chip in link mode (every other route, and the mobile row). */
const sessionLinkChip = (page: Page) => page.getByRole("link", { name: /Session läuft/ }).first();

/** Opens the session menu on /live and returns the requested entry. */
async function sessionMenuItem(page: Page, name: string) {
  await sessionMenuChip(page).click();
  return page.getByRole("menuitem", { name });
}

test("session start, quick note, pause, end — log and file follow", async ({
  page,
  files,
}) => {
  await page.goto("/beispiel");

  // Nothing on disk yet — the session file is created by the button.
  const sessionPath = files.todaySession();
  expect(await files.exists(sessionPath)).toBe(false);

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
    .poll(() => files.read(sessionPath))
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
    .poll(() => files.read(sessionPath))
    .toMatch(/- \d{2}:\d{2} \(lighthouse-arrival\) Gruppe verhandelt mit Jorna am Fuß der Treppe #thread/);
  await expect.poll(() => files.read(sessionPath)).toContain("scenes_played:");
  await expect.poll(() => files.read(sessionPath)).toContain("lighthouse-arrival");

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

  // --- pause (from the session menu) ---------------------------------------
  await (await sessionMenuItem(page, "Pause")).click();
  await expect(page.getByText("— Pause")).toBeVisible();
  await expect.poll(() => files.read(sessionPath)).toMatch(/- \d{2}:\d{2} — Pause/);

  // --- end -> review -------------------------------------------------------
  await (await sessionMenuItem(page, "Session beenden")).click();
  await expect(page).toHaveURL(/\/beispiel\/review$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fünf Minuten Ernte");
  await expect.poll(() => files.read(sessionPath)).toMatch(/^ended: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/m);

  // The harvest card for the tagged note is waiting there.
  await expect(page.getByText("Gruppe verhandelt mit Jorna am Fuß der Treppe")).toBeVisible();
  await expect(page.getByText("#thread", { exact: true }).first()).toBeVisible();

  // --- ended too early? fortsetzen in ONE click (PO feedback on #40) -------
  // "Session beenden" one scene too soon used to be a dead end until
  // midnight. It then cost two clicks (start → "fortsetzen"); now the ended
  // session is resumed by the same press — same file, so the evening's log
  // stays in one piece, and no intermediate screen asks anything.
  await page.goto("/beispiel");
  const startButton = page.getByRole("button", { name: "Session starten" });
  await expect(startButton).toBeVisible();
  await startButton.click();

  await expect(page).toHaveURL(/\/beispiel\/live$/);
  // The same session, not a fresh one: the note from before is still there …
  await expect(page.getByText(NOTE)).toBeVisible();
  // … and `ended` is gone from the file, so the session really runs again.
  await expect.poll(() => files.read(sessionPath)).not.toContain("ended:");
  await expect(sessionMenuChip(page)).toBeVisible();
});

test("session verwerfen — the mis-click's undo removes the empty file", async ({
  page,
  files,
}) => {
  await page.goto("/beispiel");
  const sessionPath = files.todaySession();

  // "Session starten" hit by accident.
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);
  await expect.poll(() => files.exists(sessionPath)).toBe(true);

  // It asks first — the file is deleted, and that is what the dialog says.
  await (await sessionMenuItem(page, "Session verwerfen")).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Leere Session verwerfen?");
  await expect(dialog).toContainText("Die Datei wird gelöscht.");

  // Abbrechen changes nothing at all.
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();
  expect(await files.exists(sessionPath)).toBe(true);

  await (await sessionMenuItem(page, "Session verwerfen")).click();
  await page.getByRole("dialog").getByRole("button", { name: "Verwerfen" }).click();

  // Back in the non-live state: the pool offers a start again …
  await expect(page).toHaveURL(/\/beispiel$/);
  await expect(page.getByRole("button", { name: "Session starten" })).toBeVisible();
  // … no session chip is left over …
  await expect(page.getByRole("link", { name: /Session läuft/ })).toHaveCount(0);
  // … and the file is gone from disk.
  await expect.poll(() => files.exists(sessionPath)).toBe(false);

  // And the start really works again (it is not blocked by a stale session).
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);
  await expect.poll(() => files.exists(sessionPath)).toBe(true);
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
