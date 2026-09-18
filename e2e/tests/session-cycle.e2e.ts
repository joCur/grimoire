// Critical path 4: the session cycle; see CLAUDE.md.
//
// start → quick note → log row + scenesPlayed → NPC/location drawer → back
// into the session via the global live indicator → pause (the clock stops) →
// resume (it ticks again) → end → review → and the restart: ending is FINAL,
// so starting a session again on the same day opens a SECOND, separate
// session (own row under its own id, empty log, timer at 0) instead of
// re-opening the closed one. There is no resuming a closed session.
//
// Plus its undo at the very start: discarding a session deletes the row of
// a session that has nothing in it — its own test below.
//
// And the live nav's own grouping: a scene whose STATUS is
// `played`/`dropped` leaves the planned group for the collapsed, dimmed
// played one, stays openable there, and never becomes the default
// selection.
//
// Every claim is checked twice: once in the UI and once in the stored session
// (the server is the truth, the app keeps no state of its own).
//
// A session is a TABLE, not an entry (ADR #26): it has no address, and what
// the session endpoints answer are rows — `log` with one row per note,
// `pauses` as intervals, `scenesPlayed` as a sequence. So every claim about
// storage here reads a field, never a rendered text.
//
// A session id is an OPAQUE random string, so this spec never spells one out:
// it always comes from the server (`api.sessionId()`). That is also the
// honest test — the app itself never derives the session its notes land in
// either.
//
// A PAUSE is an interval and nothing else: pausing writes no log row, so the
// evidence for it is `pauses` plus the chip's paused state.

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../support/test";

const NOTE = "Gruppe verhandelt mit Jorna am Fuß der Treppe #thread";

/** The session chip in menu mode (on /live) — the ONE session control. */
const sessionMenuChip = (page: Page) =>
  page.getByRole("button", { name: /Session läuft/ }).first();

/** The session chip in link mode (every other route, and the mobile row). */
const sessionLinkChip = (page: Page) => page.getByRole("link", { name: /Session läuft/ }).first();

/**
 * The chip's geometry MEASURED AGAINST THE ROW IT SITS IN, not in viewport
 * pixels: its right edge as the distance to the right edge of the `<header>`
 * content box, its middle as the distance to the row's own middle.
 *
 * Absolute viewport coordinates are wrong twice over here.
 * A vertical scrollbar on one route and not the other shifts every x by the
 * scrollbar's width — nothing on macOS, where scrollbars are overlays, ~15px
 * on CI's Linux Chromium. And the two states are compared ACROSS routes, so
 * the frame has to be the row itself for the assertion to mean "same slot".
 * What the check is about is the chip's place in the chrome; that is a
 * relative quantity, so it is measured as one.
 */
async function chipGeometry(chip: Locator) {
  return chip.evaluate((el) => {
    const header = el.closest("header");
    if (header === null) throw new Error("the chip is not in a <header>");
    const style = getComputedStyle(header);
    const row = header.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return {
      height: box.height,
      /** Distance from the chip's right edge to the row's content edge. */
      insetRight: Math.round(
        row.right - parseFloat(style.paddingRight) - box.right,
      ),
      /** Offset of the chip's middle from the row's middle. */
      offsetMiddle: Math.round(
        box.top + box.height / 2 - (row.top + row.height / 2),
      ),
    };
  });
}

/**
 * Opens the session menu on /live and returns the requested entry. The chip
 * carries the STATE in its accessible name, so a paused session is reached
 * through the paused wording.
 */
async function sessionMenuItem(page: Page, name: string) {
  await page.getByRole("button", { name: /Session (läuft|pausiert)/ }).first().click();
  return page.getByRole("menuitem", { name });
}

test("session start, quick note, pause, end — log and session row follow", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");

  // No session running yet — the session row is created by the button.
  expect(await api.sessionId()).toBeUndefined();

  // ONE session control across ALL states: the offer to start and the running
  // session are the SAME chip in the SAME slot — same height, same right edge,
  // same vertical center. Only the content and the colour change; nothing in
  // the chrome moves.
  const startChip = page.getByRole("button", { name: "Session starten" });
  const startGeometry = await chipGeometry(startChip);

  await startChip.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

  // WHICH session the notes land in is the server's answer — the id is
  // opaque and carries no date to reconstruct.
  const sessionId = (await api.sessionId()) ?? "";
  expect(sessionId).not.toBe("");

  // The topbar carries ONE session control: the chip, brass, with the running
  // time as H:MM:SS. No "Live" label, no separate timer or buttons any more.
  const chip = sessionMenuChip(page);
  await expect(chip).toBeVisible();

  // Same element, same place: the chip that now ticks sits exactly where the
  // start offer sat — same height, same right edge, same middle, all three
  // measured against the topbar row (chipGeometry above).
  expect(await chipGeometry(chip)).toEqual(startGeometry);
  // …and it really is the LAST thing on the row, flush against the row's
  // padding. Without this the assertion above would also pass if BOTH states
  // were pushed out of the row together.
  expect(startGeometry.insetRight).toBe(0);
  await expect(chip).toContainText(/\d+:\d{2}:\d{2}/);
  // …and it starts at ZERO. `started` is written to the second; a
  // minute-precise value would round down to the start of the minute and let
  // the fresh chip open at up to 0:00:59.
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
  await expect(nav).toContainText("Eventualszenen");
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toHaveText(
    "Ankunft am Leuchtturm",
  );
  // NPC card of the selected scene in the right aside — a BUTTON here, not a
  // link: in the live mode it opens the drawer.
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

  await expect.poll(async () => (await api.session(sessionId)).scenesPlayed).toEqual([]);

  // …and while it is empty, the session menu offers to discard it.
  await expect(await sessionMenuItem(page, "Session verwerfen")).toBeVisible();
  await page.keyboard.press("Escape");

  // --- quick note ---------------------------------------------------------
  const quickNote = page.getByLabel("Schnellnotiz");
  await quickNote.fill(NOTE);
  await quickNote.press("Enter");

  // The panel shows the entry (server round trip, no optimistic guessing).
  const log = page.getByText(NOTE);
  await expect(log).toBeVisible();
  await expect(quickNote).toHaveValue("");

  // …and the session gained one log ROW plus the played scene id. The row's
  // columns say what the old rendered line had to encode in a grammar: the
  // time, the scene it was taken in, and the note as the DM typed it.
  await expect.poll(async () => (await api.session(sessionId)).log).toEqual([
    {
      id: expect.any(String),
      at: expect.stringMatching(/^\d{2}:\d{2}$/),
      sceneId: "lighthouse-arrival",
      text: NOTE,
      reviewed: false,
    },
  ]);
  await expect
    .poll(async () => (await api.session(sessionId)).scenesPlayed)
    .toEqual(["lighthouse-arrival"]);

  // The played checkmark comes from scenesPlayed — never faked client-side.
  await expect(nav.getByText("Gespielt")).toBeAttached();

  // The session has content now — discarding it is no longer on offer; the
  // way out is ending it.
  await sessionMenuChip(page).click();
  await expect(page.getByRole("menuitem", { name: "Session verwerfen" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Session beenden" })).toBeVisible();
  await page.keyboard.press("Escape");

  // --- NPC drawer inside the live mode --------------------------
  // A card click must NOT navigate: the selected scene and a half-typed
  // Schnellnotiz have to survive opening and closing the drawer.
  const draft = "halb getippt, nicht gesendet";
  await quickNote.fill(draft);
  await page.getByRole("button", { name: /Hafenmeisterin Jorna/ }).click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  // The full entry, not the card excerpt — and the way out into the full view.
  await expect(drawer.getByRole("link", { name: "Eintrag öffnen" })).toHaveAttribute(
    "href",
    "/campaigns/beispiel/entries/npcs/jorna",
  );
  // Still in the live mode, session still running.
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
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

  // --- the global live indicator brings the DM back -------------
  // The live topbar has no campaign nav (it belongs to the session), so this
  // is the DM looking something up: away to the chapter overview, then back.
  await page.goto("/campaigns/beispiel");
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  // No start action anywhere while a session runs …
  await expect(page.getByRole("button", { name: "Session starten" })).toHaveCount(0);
  // … but the same chip, in link mode, with the running time — on this route
  // too, and in the very same slot of the topbar.
  const backToLive = sessionLinkChip(page);
  await expect(backToLive).toBeVisible();
  await expect(backToLive).toContainText(/\d+:\d{2}:\d{2}/);
  await backToLive.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  await expect(page.getByText(NOTE)).toBeVisible();

  // --- pause: the clock really STOPS ----------------------------------------
  await (await sessionMenuItem(page, "Pause")).click();
  // A pause is ONE thing: an interval on the session, still open (no `to`
  // yet). It writes no log row, so the log is still the single note …
  await expect.poll(async () => (await api.session(sessionId)).pauses).toEqual([
    { from: expect.stringMatching(/^[\d\-T:]+$/), fromMs: expect.any(Number) },
  ]);
  expect((await api.session(sessionId)).log).toHaveLength(1);

  // … the chip is the same chip, dimmed, and says so.
  const pausedChip = page.getByRole("button", { name: /Session pausiert/ }).first();
  await expect(pausedChip).toBeVisible();
  await expect(pausedChip).toHaveAttribute("data-session-chip", "paused");

  // And this is the point of the pause: the time does NOT move while
  // the session is paused. Two readings more than a second apart are equal
  // (the running clock above was proven to tick within the same test).
  const stopped = await pausedChip.textContent();
  await page.waitForTimeout(2_500);
  expect(await pausedChip.textContent()).toBe(stopped);

  // --- weiter: the same menu entry, the other direction ---------------------
  await (await sessionMenuItem(page, "Weiter")).click();
  // The interval is closed (`to` written) …
  await expect.poll(async () => (await api.session(sessionId)).pauses).toEqual([
    {
      from: expect.stringMatching(/^[\d\-T:]+$/),
      fromMs: expect.any(Number),
      to: expect.stringMatching(/^[\d\-T:]+$/),
      toMs: expect.any(Number),
    },
  ]);
  // … the chip is brass again, and the clock ticks once more.
  const runningAgain = sessionMenuChip(page);
  await expect(runningAgain).toBeVisible();
  const resumed = await runningAgain.textContent();
  await expect
    .poll(() => runningAgain.textContent(), { timeout: 5_000 })
    .not.toBe(resumed);

  // The pause round trip left the LOG alone: the note is still the only row.
  // The pause lives in `pauses`, and putting it in both places would be the
  // same pause twice.
  const afterPause = await api.session(sessionId);
  expect(afterPause.log.map((row) => row.text)).toEqual([NOTE]);
  expect(afterPause.pauses).toHaveLength(1);

  // --- end -> review -------------------------------------------------------
  await (await sessionMenuItem(page, "Session beenden")).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/review$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session-Nachbereitung");
  await expect
    .poll(async () => (await api.session(sessionId)).ended)
    .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

  // The harvest card for the tagged note is waiting there.
  await expect(page.getByText("Gruppe verhandelt mit Jorna am Fuß der Treppe")).toBeVisible();
  await expect(page.getByText("#thread", { exact: true }).first()).toBeVisible();

  // --- ending is FINAL, and a restart is a NEW session --------
  // The chip offers a plain start action right after the end — nothing that
  // resumes anywhere — and that press opens a SECOND session of the same
  // day: own row under its own id, empty log, timer back at 0. The first
  // session keeps its `ended`, its log and its pauses.
  await page.goto("/campaigns/beispiel");
  const startAgain = page.getByRole("button", { name: "Session starten" });
  await expect(startAgain).toBeVisible();
  await expect(page.getByRole("button", { name: /fortsetzen/i })).toHaveCount(0);
  await startAgain.click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  await expect(sessionMenuChip(page)).toBeVisible();
  // The timer of the SECOND session starts at zero too — an end→start never
  // keeps counting the old session's time.
  await expect(sessionMenuChip(page)).toContainText(/\b0:00:0[0-4]\b/);
  // A fresh, empty session: nothing of the first evening is shown …
  await expect(page.getByText(NOTE)).toHaveCount(0);
  // … it lives in its OWN row, under a DIFFERENT opaque id …
  const secondId = (await api.sessionId()) ?? "";
  expect(secondId).not.toBe("");
  expect(secondId).not.toBe(sessionId);
  const second = await api.session(secondId);
  expect(second.ended).toBeUndefined();
  expect(second.pauses).toEqual([]);
  expect(second.log).toEqual([]);
  expect(second.scenesPlayed).toEqual([]);
  // … and the first session is untouched: still ended, log and pauses intact.
  const first = await api.session(sessionId);
  expect(first.ended).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  expect(first.log.map((row) => row.text)).toEqual([NOTE]);
  expect(first.pauses).toHaveLength(1);

  // The two sessions stay separate under writing: a note now lands in the
  // SECOND one only, and its own pause is its own.
  const SECOND_NOTE = "Zweite Runde: die Gruppe bricht zum Leuchtturm auf #thread";
  const secondNoteField = page.getByLabel("Schnellnotiz");
  await secondNoteField.fill(SECOND_NOTE);
  await secondNoteField.press("Enter");
  await expect
    .poll(async () => (await api.session(secondId)).log.map((row) => row.text))
    .toEqual([SECOND_NOTE]);
  expect((await api.session(sessionId)).log.map((row) => row.text)).toEqual([NOTE]);
  await (await sessionMenuItem(page, "Pause")).click();
  await expect.poll(async () => (await api.session(secondId)).pauses).toEqual([
    { from: expect.stringMatching(/^[\d\-T:]+$/), fromMs: expect.any(Number) },
  ]);
  // The first session's pause list did not grow.
  expect((await api.session(sessionId)).pauses).toHaveLength(1);

  // Ending the second one leads to the review of the SECOND session — the
  // harvest works on the LAST STARTED session, which is this one.
  await (await sessionMenuItem(page, "Session beenden")).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/review$/);
  await expect.poll(async () => (await api.session(secondId)).ended).toBeDefined();
  await expect(
    page.getByText("Zweite Runde: die Gruppe bricht zum Leuchtturm auf"),
  ).toBeVisible();
  await expect(
    page.getByText("Gruppe verhandelt mit Jorna am Fuß der Treppe"),
  ).toHaveCount(0);
});

test("a #pc quick note becomes a reminder in the aside and is ticked off there", async ({
  page,
  api,
}) => {
  // Path 4 with the PC reminder on top: a `#pc` note written during the
  // session shows up in the aside's player-facing reminder list and is done
  // with right there — the same write the wrap-up would do.
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  const sessionId = (await api.sessionId()) ?? "";

  const aside = page.getByRole("complementary");
  // Nothing to remind of yet — the list is not rendered at all.
  await expect(aside.getByText("Für die Spieler")).toHaveCount(0);

  await page.getByLabel("Schnellnotiz").fill("Kaela bekommt den Brief ihrer Schwester #pc #kaela");
  await page.getByLabel("Schnellnotiz").press("Enter");

  const list = page.getByRole("region", { name: "Für die Spieler" });
  await expect(list).toBeVisible();
  await expect(list).toContainText("#kaela");
  const item = list.getByRole("button", { name: /Kaela bekommt den Brief/ });
  await expect(item).toBeVisible();

  // Ticking it off marks the log ROW reviewed — and the reminder is gone.
  // The region does NOT vanish under the keyboard focus: it becomes the
  // all-done line, which takes the focus over (quality floor).
  await item.click();
  const emptied = page.getByRole("region", { name: "Für die Spieler" });
  await expect(emptied).toContainText("Alles erledigt.");
  await expect(emptied.getByRole("button", { name: /Kaela bekommt den Brief/ })).toHaveCount(0);
  await expect(emptied.getByText("Alles erledigt.")).toBeFocused();
  // The flag sits on the ROW the review named by its id — the session has no
  // `reviewed` property of its own.
  await expect
    .poll(async () => (await api.session(sessionId)).log.map((row) => row.reviewed))
    .toEqual([true]);
});

test("session verwerfen — the mis-click's undo removes the empty row", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");

  // The start action hit by accident.
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  const sessionId = (await api.sessionId()) ?? "";
  expect(await api.sessionExists(sessionId)).toBe(true);

  // It asks first — the row is deleted, and that is what the dialog says.
  await (await sessionMenuItem(page, "Session verwerfen")).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Leere Session verwerfen?");
  await expect(dialog).toContainText("Die Session wird gelöscht.");

  // Abbrechen changes nothing at all.
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();
  expect(await api.sessionExists(sessionId)).toBe(true);

  await (await sessionMenuItem(page, "Session verwerfen")).click();
  await page.getByRole("dialog").getByRole("button", { name: "Verwerfen" }).click();

  // Back in the non-live state: the chapter overview offers a start again …
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByRole("button", { name: "Session starten" })).toBeVisible();
  // … no session chip is left over …
  await expect(page.getByRole("link", { name: /Session läuft/ })).toHaveCount(0);
  // … and the session row is gone.
  await expect.poll(() => api.sessionExists(sessionId)).toBe(false);

  // And the start really works again (it is not blocked by a stale session).
  // The new session gets a FRESH id, never the discarded one back: an
  // id, once handed out, must not name a second evening — with random ids
  // that holds without any bookkeeping.
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  const restarted = (await api.sessionId()) ?? "";
  expect(restarted).not.toBe("");
  expect(restarted).not.toBe(sessionId);
  expect(await api.sessionExists(restarted)).toBe(true);
  expect(await api.sessionExists(sessionId)).toBe(false);
});

// The third state of the ONE session control: an unreachable session lookup.
// It is the SAME chip, dimmed, inert, saying so — not a bare sentence next to
// the chrome, and no start button offering something that could not work.
test("an unreachable session lookup dims the chip instead of offering a start", async ({
  page,
}) => {
  await page.route("**/api/campaigns/beispiel/session**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );

  await page.goto("/campaigns/beispiel");

  const unknown = page.getByRole("status", { name: /Session-Status unbekannt/ });
  await expect(unknown).toBeVisible();
  await expect(unknown).toContainText("Status unbekannt");
  // Nothing to press, and above all no start that could not work.
  await expect(page.getByRole("button", { name: "Session starten" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Session läuft/ })).toHaveCount(0);
});

// The scene STATUS sorts the live nav. Chapter 1 of the example campaign
// holds exactly ONE planned scene, so this block seeds a second one —
// otherwise "the played scene is no longer the default selection" has nothing
// to fall through to.
test.describe("played/dropped scenes in the live nav", () => {
  const ARRIVAL = "01-salzhafen/leuchtturm/lighthouse-arrival";
  // The seeded scene names a location that EXISTS — a reference creates
  // nothing (ADR #19) — and that location's name sorts after the one the
  // arrival scene sits in, so the arrival scene stays the first row of the
  // nav. That is what the default selection needs to fall through to.
  const SEEDED = "01-salzhafen/bucht/harbor-office-talk";

  test.use({
    seed: {
      entries: {
        "scene-harbor-office-talk": {
          kind: "scene",
          properties: {
            id: "harbor-office-talk",
            title: "Gespräch im Hafenkontor",
            type: "planned",
            chapter: "01-salzhafen",
            location: "bucht",
            npcs: [],
            tags: ["social"],
            status: "ready",
          },
          body:
            "\n## Aufhänger\n\n" +
            "Der Kontorschreiber hat die Frachtbücher der letzten Woche.\n",
        },
      },
    },
  });

  test("status 'gespielt' moves the scene into the collapsed group, still openable", async ({
    page,
    api,
  }) => {
    await page.goto("/campaigns/beispiel");
    await page.getByRole("button", { name: "Session starten" }).click();
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

    const nav = page.getByRole("navigation", { name: "Szenen der Session" });
    const arrivalRow = nav.getByRole("button", { name: /Ankunft am Leuchtturm/ });
    const seededRow = nav.getByRole("button", { name: /Gespräch im Hafenkontor/ });
    const heading = page.getByRole("article").getByRole("heading", { level: 1 });

    // Before: both are planned, the FIRST row is the default selection, the
    // arrival scene: the nav walks the chapter's groups, and they are ordered
    // by the NAME their heading shows, which puts the arrival scene's group
    // first.
    await expect(arrivalRow).toBeVisible();
    await expect(seededRow).toBeVisible();
    await expect(heading).toHaveText("Ankunft am Leuchtturm");
    await expect(arrivalRow).toHaveAttribute("aria-current", "true");
    // … and there is no played group at all yet.
    await expect(nav.getByRole("button", { name: /^Gespielt/ })).toHaveCount(0);

    // The status is set through the documented API — the same patch the status
    // control writes (critical path 7), here as the precondition.
    await api.patchProperties(SEEDED, { status: "played" });
    await page.reload();

    // It is gone from the planned group — the one it now lives in starts
    // COLLAPSED, so the row is not rendered …
    await expect(arrivalRow).toBeVisible();
    await expect(seededRow).toHaveCount(0);
    // … but the group announces itself, with its count.
    const groupTrigger = nav.getByRole("button", { name: /^Gespielt/ });
    await expect(groupTrigger).toBeVisible();
    await expect(groupTrigger).toContainText("(1)");

    // The default selection is the first PLANNED scene, not the played
    // one — which still stands at the top of the chapter's scene order.
    await expect(heading).toHaveText("Ankunft am Leuchtturm");
    await expect(arrivalRow).toHaveAttribute("aria-current", "true");

    // The contingencies are untouched.
    await expect(nav).toContainText("Eventualszenen");
    await expect(nav.getByRole("button", { name: /Von den Schmugglern erwischt/ })).toBeVisible();

    // Expanding reaches it, and it opens like any other scene.
    await groupTrigger.click();
    const playedGroup = nav.getByRole("group", { name: "Gespielt" });
    const groupedRow = playedGroup.getByRole("button", { name: /Gespräch im Hafenkontor/ });
    await expect(groupedRow).toBeVisible();
    await groupedRow.click();
    await expect(heading).toHaveText("Gespräch im Hafenkontor");
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

    // The group is view state only — a reload has it collapsed again.
    await page.reload();
    await expect(nav.getByRole("group", { name: "Gespielt" })).toHaveCount(0);

    // The SESSION checkmark is a different thing and still works on top
    // of the grouping — a note played on the grouped scene marks it.
    await nav.getByRole("button", { name: /^Gespielt/ }).click();
    await nav
      .getByRole("group", { name: "Gespielt" })
      .getByRole("button", { name: /Gespräch im Hafenkontor/ })
      .click();
    const quickNote = page.getByLabel("Schnellnotiz");
    await quickNote.fill("Der Kontorschreiber rückt die Bücher heraus #thread");
    await quickNote.press("Enter");
    const sessionId = (await api.sessionId()) ?? "";
    await expect
      .poll(async () => (await api.session(sessionId)).scenesPlayed)
      .toContain("harbor-office-talk");
    await expect(
      nav.getByRole("group", { name: "Gespielt" }).getByText("Gespielt"),
    ).toBeAttached();

    // Degrade: with EVERY scene played the view stays usable — the planned
    // list says so, the group holds both, and the center column still renders
    // a scene instead of blanking (or crashing on an empty selection).
    await api.patchProperties(ARRIVAL, { status: "dropped" });
    await page.reload();
    await expect(nav).toContainText("Keine geplanten Szenen in diesem Kapitel.");
    await expect(nav.getByRole("button", { name: /^Gespielt/ })).toContainText("(2)");
    // The fallback is the FIRST done scene, i.e. the chapter's scene order
    // again (groups by name).
    await expect(heading).toHaveText("Ankunft am Leuchtturm");
    await expect(page.getByLabel("Schnellnotiz")).toBeVisible();
  });
});

// The READING page of a past evening: `/campaigns/:campaign/sessions/:id`.
// A session has no entry address, so this is the only way to look at one —
// and what it shows are the rows the endpoint answers, not a rendered log.
test("the session page shows a past evening's rows; the old address is gone", async ({
  page,
  api,
}) => {
  // The fixture session of the example campaign: three log rows, one closed
  // pause, one played scene.
  await page.goto("/campaigns/beispiel/sessions/2026-01-15");

  // The heading is the DATE, derived from `started` — the id is opaque and is
  // never shown.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session vom 15.01.2026");

  // The LOG, row by row: the time, the scene the note was taken in (by its
  // TITLE, resolved through the tree) and the note as it was typed.
  const log = page.getByRole("region", { name: "Log" });
  await expect(log).toContainText("19:52");
  await expect(log).toContainText("Spuren gefunden, Gruppe will sofort zur Bucht");
  await expect(log).toContainText("Improvisiert: Fischerin „Old Metta“ am Steg");
  // The scene is a LINK into its entry — the row's `sceneId` never shows.
  await expect(log.getByRole("link", { name: "Ankunft am Leuchtturm" }).first()).toHaveAttribute(
    "href",
    "/campaigns/beispiel/entries/01-salzhafen/leuchtturm/lighthouse-arrival",
  );
  await expect(log).not.toContainText("lighthouse-arrival");
  // The third row names no scene, so it stands with its text alone.
  await expect(log).toContainText("Cliffhanger: Lichter in der Bucht gesichtet");

  // The PAUSE is an interval with its duration — 20:30 to 21:10 is 40 minutes.
  const pauses = page.getByRole("region", { name: "Pausen" });
  await expect(pauses).toContainText("0:40:00");

  // The PLAYED SCENES, as links into their entries.
  const scenes = page.getByRole("region", { name: "Gespielte Szenen" });
  await expect(scenes.getByRole("link", { name: "Ankunft am Leuchtturm" })).toBeVisible();

  // The old ENTRY address of the same session answers 404 — no redirect, no
  // alias (ADR #26).
  const res = await api.fetch("campaigns/beispiel/entries/sessions/2026-01-15");
  expect(res.status).toBe(404);
});
