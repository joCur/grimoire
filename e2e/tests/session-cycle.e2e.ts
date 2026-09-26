// Critical path 4: the session cycle; see CLAUDE.md.
//
// start → quick note → log row (and no played scene) → NPC/location drawer → back
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
// The nav reads the ORDER THE DM ARRANGED in the chapter overview (ADR #27);
// this view moderates that order, it makes none of its own. So a spec that
// depends on the order states the one it means through the documented
// endpoint instead of leaning on whichever order the seed run produced.
//
// Every claim is checked twice: once in the UI and once in the stored session
// (the server is the truth, the app keeps no state of its own).
//
// A session is its own resource (ADR #31), and so is each of its children,
// hanging under it: a log entry per note, a pause per interval, a played scene
// per scene the DM LEFT with "Nächste Szene" after taking a note in it. The
// session embeds them when it is read, so every claim about storage here reads
// a field, never a rendered text.
//
// A session id is an OPAQUE random string, so this spec never spells one out:
// it always comes from the server (`runningSessionId(api)`). That is also the
// honest test — the app itself never derives the session its notes land in
// either.
//
// A PAUSE is an interval and nothing else: pausing writes no log row, so the
// evidence for it is `pauses` plus the chip's paused state.

import type { Locator, Page } from "@playwright/test";

import type { SceneProposal } from "@grimoire/shared/scene";
import { expect, test } from "../support/test";
import type { Api } from "../support/api";
import { patchScene } from "../support/scene";
import {
  getSession,
  logEntryPath,
  pausePath,
  playedScenesPath,
  runningSessionId,
  sessionExists,
  sessionPath,
} from "../support/session";

const NOTE = "Gruppe verhandelt mit Jorna am Fuß der Treppe #thread";

/** The chapter of the example campaign — the one that holds a scene order. */
const CHAPTER = "01-salzhafen";

/**
 * Arrange the chapter's scenes through the documented endpoint: the whole
 * list against the order's own guard token (ADR #27).
 *
 * The order is the DM's, so a spec that reads it says which one it means.
 */
async function setSceneOrder(api: Api, order: string[]): Promise<void> {
  const tree = await api.get<{ chapters: { id: string; sceneOrderRev: number }[] }>(
    "campaigns/beispiel/tree",
  );
  const chapter = tree.chapters.find((c) => c.id === CHAPTER);
  if (chapter === undefined) throw new Error(`the tree has no chapter ${CHAPTER}`);
  await api.send("PUT", `campaigns/beispiel/chapters/${CHAPTER}/scene-order`, {
    scenes: order,
    rev: chapter.sceneOrderRev,
  });
}

/** The live nav of a running session — its rows are the chapter's scenes. */
const liveNav = (page: Page) => page.getByRole("navigation", { name: "Szenen der Session" });

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

test("a scene's reading view offers the session start, like every reading view", async ({
  page,
}) => {
  // The scene's own route is a reading view: the chip in the topbar offers
  // the start there too, and the chapter trio marks „Kapitel“.
  await page.goto("/campaigns/beispiel/scenes/lighthouse-arrival");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(page.getByRole("link", { name: "Kapitel", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
});

test("session start, quick note, pause, end — log and session row follow", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");

  // No session running yet — the session row is created by the button.
  expect(await runningSessionId(api)).toBeUndefined();

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
  const sessionId = (await runningSessionId(api)) ?? "";
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
    page.getByText("Noch keine Notizen — die Schnellnotiz unten landet hier."),
  ).toBeVisible();

  await expect.poll(async () => (await getSession(api, sessionId)).playedScenes).toEqual([]);

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

  // …and the session gained one log ROW, with its own id and guard. Its
  // columns say what the old rendered line had to encode in a grammar: the
  // time, the scene it was taken in, and the note as the DM typed it.
  await expect.poll(async () => (await getSession(api, sessionId)).log).toEqual([
    {
      id: expect.any(String),
      at: expect.stringMatching(/^\d{2}:\d{2}$/),
      sceneId: "lighthouse-arrival",
      text: NOTE,
      reviewed: false,
      rev: expect.any(Number),
    },
  ]);
  // A note plays nothing: the scene is recorded as played when the DM LEAVES
  // it with "Nächste Szene" (the order block below), and the checkmark reads
  // the played scenes — never faked client-side.
  expect((await getSession(api, sessionId)).playedScenes).toEqual([]);
  await expect(nav.getByText("Gespielt")).toHaveCount(0);

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
  // The whole npc, not the card excerpt — and the way out into the npc's
  // own route (ADR #31).
  await expect(drawer.getByRole("link", { name: "Vollständig öffnen" })).toHaveAttribute(
    "href",
    "/campaigns/beispiel/npcs/jorna",
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
  // The way out leads to the location's own route (ADR #31).
  await expect(page.getByRole("dialog").getByRole("link")).toHaveAttribute(
    "href",
    "/campaigns/beispiel/locations/leuchtturm",
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
  await expect.poll(async () => (await getSession(api, sessionId)).pauses).toEqual([
    {
      id: expect.any(String),
      from: expect.stringMatching(/^[\d\-T:]+$/),
      fromMs: expect.any(Number),
      rev: expect.any(Number),
    },
  ]);
  expect((await getSession(api, sessionId)).log).toHaveLength(1);

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
  await expect.poll(async () => (await getSession(api, sessionId)).pauses).toEqual([
    {
      id: expect.any(String),
      from: expect.stringMatching(/^[\d\-T:]+$/),
      fromMs: expect.any(Number),
      to: expect.stringMatching(/^[\d\-T:]+$/),
      toMs: expect.any(Number),
      rev: expect.any(Number),
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
  const afterPause = await getSession(api, sessionId);
  expect(afterPause.log.map((row) => row.text)).toEqual([NOTE]);
  expect(afterPause.pauses).toHaveLength(1);

  // --- end -> review -------------------------------------------------------
  await (await sessionMenuItem(page, "Session beenden")).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/review$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session-Nachbereitung");
  await expect
    .poll(async () => (await getSession(api, sessionId)).ended)
    .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  // Ending records nothing as played: the scene open at the end, a note in it
  // or not, may carry on next time.
  expect((await getSession(api, sessionId)).playedScenes).toEqual([]);

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
  const secondId = (await runningSessionId(api)) ?? "";
  expect(secondId).not.toBe("");
  expect(secondId).not.toBe(sessionId);
  const second = await getSession(api, secondId);
  expect(second.ended).toBeUndefined();
  expect(second.pauses).toEqual([]);
  expect(second.log).toEqual([]);
  expect(second.playedScenes).toEqual([]);
  // … and the first session is untouched: still ended, log and pauses intact.
  const first = await getSession(api, sessionId);
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
    .poll(async () => (await getSession(api, secondId)).log.map((row) => row.text))
    .toEqual([SECOND_NOTE]);
  expect((await getSession(api, sessionId)).log.map((row) => row.text)).toEqual([NOTE]);
  await (await sessionMenuItem(page, "Pause")).click();
  await expect.poll(async () => (await getSession(api, secondId)).pauses).toEqual([
    {
      id: expect.any(String),
      from: expect.stringMatching(/^[\d\-T:]+$/),
      fromMs: expect.any(Number),
      rev: expect.any(Number),
    },
  ]);
  // The first session's pause list did not grow.
  expect((await getSession(api, sessionId)).pauses).toHaveLength(1);

  // Ending the second one leads to the review of the SECOND session — the
  // harvest works on the LAST STARTED session, which is this one.
  await (await sessionMenuItem(page, "Session beenden")).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/review$/);
  await expect.poll(async () => (await getSession(api, secondId)).ended).toBeDefined();
  await expect(
    page.getByText("Zweite Runde: die Gruppe bricht zum Leuchtturm auf"),
  ).toBeVisible();
  await expect(
    page.getByText("Gruppe verhandelt mit Jorna am Fuß der Treppe"),
  ).toHaveCount(0);
});

// The `## If:` branches of the scene column start CLOSED here and nowhere
// else. Checked on the reference scene CLAUDE.md names for the renderer, and
// against the reading view of the very same scene (critical path 2), which
// keeps opening every branch.
test("live scene column: If-sections start closed, open one at a time, reset on a switch", async ({
  page,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

  const nav = page.getByRole("navigation", { name: "Szenen der Session" });
  const captured = nav.getByRole("button", { name: /Von den Schmugglern erwischt/ });
  const article = page.getByRole("article");
  await captured.click();
  await expect(article.getByRole("heading", { level: 1 })).toHaveText(
    "Von den Schmugglern erwischt",
  );

  // Both branches are there as rows — and both are folded away.
  const branches = page.getByRole("main").locator("details[data-if-section]");
  await expect(branches).toHaveCount(2);
  const first = branches.first();
  const firstBody = first.getByText("Fenn lässt sie in die alte Räucherkammer sperren", {
    exact: false,
  });
  await expect(first.locator("summary")).toContainText("Falls:");
  await expect(first.locator("summary")).toContainText("sie geben zu, für Jorna zu arbeiten");
  await expect(first).not.toHaveAttribute("open", "");
  await expect(firstBody).toBeHidden();
  await expect(branches.nth(1)).not.toHaveAttribute("open", "");

  // A click opens exactly the one case — the other branch stays closed.
  await first.locator("summary").click();
  await expect(firstBody).toBeVisible();
  await expect(branches.nth(1)).not.toHaveAttribute("open", "");

  // And it STAYS open under a re-render of the column: the quick note round
  // trip refreshes the session the whole live view hangs on.
  const note = page.getByLabel("Schnellnotiz");
  await note.fill("Sie geben es zu — Räucherkammer");
  await note.press("Enter");
  await expect(page.getByText("Sie geben es zu — Räucherkammer")).toBeVisible();
  await expect(firstBody).toBeVisible();

  // Nothing is remembered: away to the other scene and back, and the branch
  // is closed again (no localStorage, no server state — quality floor).
  await nav.getByRole("button", { name: /Ankunft am Leuchtturm/ }).click();
  await expect(article.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await captured.click();
  await expect(article.getByRole("heading", { level: 1 })).toHaveText(
    "Von den Schmugglern erwischt",
  );
  await expect(branches.first()).not.toHaveAttribute("open", "");
  await expect(
    branches.first().getByText("Fenn lässt sie in die alte Räucherkammer sperren", {
      exact: false,
    }),
  ).toBeHidden();

  // Critical path 2, same scene: the reading view is untouched by all this.
  await page.goto("/campaigns/beispiel/scenes/smuggler-captured");
  const reading = page.locator("details[data-if-section]");
  await expect(reading).toHaveCount(2);
  await expect(reading.first()).toHaveAttribute("open", "");
  await expect(reading.nth(1)).toHaveAttribute("open", "");
});

// The hard half of "nothing is remembered": two scenes built the SAME way.
// React reconciles the live column by position, so without a remount per
// scene it hands the next scene the very `<details>` nodes of the last one —
// and with them the branch the DM had open. Two scenes of identical shape are
// the only arrangement that can show that; the reference scenes differ enough
// for the nodes to be thrown away anyway.
test.describe("two scenes of the same shape", () => {
  const branchScene = (id: string, title: string, first: string, second: string): SceneProposal => ({
    id,
    title,
    type: "planned",
    chapter: "01-salzhafen",
    location: "bucht",
    npcs: [],
    handouts: [],
    tags: ["social"],
    status: "ready",
    body:
      "\n## Aufhänger\n\nDie Gruppe steht vor der Tür.\n\n" +
      `## If: ${first}\n\nDann redet der Wirt.\n\n` +
      `## If: ${second}\n\nDann schweigt er.\n`,
  });

  test.use({
    seed: {
      scenes: [
        branchScene("twin-a", "Zwilling A", "sie zahlen", "sie drohen"),
        branchScene("twin-b", "Zwilling B", "sie feilschen", "sie gehen"),
      ],
    },
  });

  test("the branch opened in one scene is closed in the other, and closed on the way back", async ({
    page,
  }) => {
    await page.goto("/campaigns/beispiel");
    await page.getByRole("button", { name: "Session starten" }).click();
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

    const nav = page.getByRole("navigation", { name: "Szenen der Session" });
    const article = page.getByRole("article");
    const branches = page.getByRole("main").locator("details[data-if-section]");
    const openBranch = async (title: string) => {
      await nav.getByRole("button", { name: new RegExp(title) }).click();
      await expect(article.getByRole("heading", { level: 1 })).toHaveText(title);
    };

    // Both scenes are LOADED once first. A scene the column has never shown
    // arrives through a loading line, and that alone throws the old nodes
    // away — the switch that has to be proven is the one between two cached
    // scenes, where the column re-renders without ever emptying.
    await openBranch("Zwilling B");
    await openBranch("Zwilling A");

    await expect(branches).toHaveCount(2);
    await expect(branches.first()).not.toHaveAttribute("open", "");
    await branches.first().locator("summary").click();
    await expect(branches.first().getByText("Dann redet der Wirt.")).toBeVisible();

    // The other scene, same shape: its own branches, both closed.
    await openBranch("Zwilling B");
    await expect(branches.first().locator("summary")).toContainText("sie feilschen");
    await expect(branches.first()).not.toHaveAttribute("open", "");
    await expect(branches.nth(1)).not.toHaveAttribute("open", "");
    await expect(branches.first().getByText("Dann redet der Wirt.")).toBeHidden();

    // And back: what was open before the switch is closed again.
    await openBranch("Zwilling A");
    await expect(branches.first().locator("summary")).toContainText("sie zahlen");
    await expect(branches.first()).not.toHaveAttribute("open", "");
  });
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
  const sessionId = (await runningSessionId(api)) ?? "";

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
    .poll(async () => (await getSession(api, sessionId)).log.map((row) => row.reviewed))
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
  const sessionId = (await runningSessionId(api)) ?? "";
  expect(await sessionExists(api, sessionId)).toBe(true);

  // It asks first — the row is deleted, and that is what the dialog says.
  await (await sessionMenuItem(page, "Session verwerfen")).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Leere Session verwerfen?");
  await expect(dialog).toContainText("Die Session wird gelöscht.");

  // Abbrechen changes nothing at all.
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();
  expect(await sessionExists(api, sessionId)).toBe(true);

  await (await sessionMenuItem(page, "Session verwerfen")).click();
  await page.getByRole("dialog").getByRole("button", { name: "Verwerfen" }).click();

  // Back in the non-live state: the chapter overview offers a start again …
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByRole("button", { name: "Session starten" })).toBeVisible();
  // … no session chip is left over …
  await expect(page.getByRole("link", { name: /Session läuft/ })).toHaveCount(0);
  // … and the session row is gone.
  await expect.poll(() => sessionExists(api, sessionId)).toBe(false);

  // And the start really works again (it is not blocked by a stale session).
  // The new session gets a FRESH id, never the discarded one back: an
  // id, once handed out, must not name a second evening — with random ids
  // that holds without any bookkeeping.
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  const restarted = (await runningSessionId(api)) ?? "";
  expect(restarted).not.toBe("");
  expect(restarted).not.toBe(sessionId);
  expect(await sessionExists(api, restarted)).toBe(true);
  expect(await sessionExists(api, sessionId)).toBe(false);
});

// The third state of the ONE session control: an unreachable session lookup.
// It is the SAME chip, dimmed, inert, saying so — not a bare sentence next to
// the chrome, and no start button offering something that could not work.
test("an unreachable session lookup dims the chip instead of offering a start", async ({
  page,
}) => {
  await page.route("**/api/campaigns/beispiel/sessions?running=true", (route) =>
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
  const ARRIVAL = "lighthouse-arrival";
  // The seeded scene names a location that EXISTS — a reference creates
  // nothing (ADR #19). Where it STANDS is the chapter's order: the test
  // arranges it itself, the arrival scene first, so the default selection has
  // something to fall through to.
  const SEEDED = "harbor-office-talk";

  test.use({
    seed: {
      scenes: [
        {
          id: "harbor-office-talk",
          title: "Gespräch im Hafenkontor",
          type: "planned",
          chapter: "01-salzhafen",
          location: "bucht",
          npcs: [],
          handouts: [],
          tags: ["social"],
          status: "ready",
          body:
            "\n## Aufhänger\n\n" +
            "Der Kontorschreiber hat die Frachtbücher der letzten Woche.\n",
        },
      ],
    },
  });

  test("status 'gespielt' moves the scene into the collapsed group, still openable", async ({
    page,
    api,
  }) => {
    // The chapter's order, as the DM would have arranged it in the overview.
    await setSceneOrder(api, [
      "lighthouse-arrival",
      "harbor-office-talk",
      "smuggler-captured",
    ]);
    await page.goto("/campaigns/beispiel");
    await page.getByRole("button", { name: "Session starten" }).click();
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

    const nav = liveNav(page);
    const arrivalRow = nav.getByRole("button", { name: /Ankunft am Leuchtturm/ });
    const seededRow = nav.getByRole("button", { name: /Gespräch im Hafenkontor/ });
    const heading = page.getByRole("article").getByRole("heading", { level: 1 });

    // Before: both are planned, and the default selection is the first row of
    // the order — the arrival scene, where the DM put it.
    await expect(arrivalRow).toBeVisible();
    await expect(seededRow).toBeVisible();
    await expect(heading).toHaveText("Ankunft am Leuchtturm");
    await expect(arrivalRow).toHaveAttribute("aria-current", "true");
    // … and there is no played group at all yet.
    await expect(nav.getByRole("button", { name: /^Gespielt/ })).toHaveCount(0);

    // The status is set through the documented API — the same patch the status
    // control writes (critical path 7), here as the precondition.
    await patchScene(api, SEEDED, { status: "played" });
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
    // of the grouping — leaving the grouped scene after a note in it marks it.
    // The step out of it needs a planned scene behind it, so the DM puts the
    // arrival there for this part, and back afterwards.
    await setSceneOrder(api, ["harbor-office-talk", "lighthouse-arrival", "smuggler-captured"]);
    await page.reload();
    await nav.getByRole("button", { name: /^Gespielt/ }).click();
    await nav
      .getByRole("group", { name: "Gespielt" })
      .getByRole("button", { name: /Gespräch im Hafenkontor/ })
      .click();
    const quickNote = page.getByLabel("Schnellnotiz");
    await quickNote.fill("Der Kontorschreiber rückt die Bücher heraus #thread");
    await quickNote.press("Enter");
    const sessionId = (await runningSessionId(api)) ?? "";
    await expect
      .poll(async () => (await getSession(api, sessionId)).log.map((row) => row.sceneId))
      .toEqual(["harbor-office-talk"]);
    await page.getByRole("button", { name: "Nächste Szene: Ankunft am Leuchtturm" }).click();
    await expect(heading).toHaveText("Ankunft am Leuchtturm");
    await expect
      .poll(async () =>
        (await getSession(api, sessionId)).playedScenes.map((row) => row.sceneId),
      )
      .toEqual(["harbor-office-talk"]);
    await expect(
      nav.getByRole("group", { name: "Gespielt" }).getByText("Gespielt"),
    ).toBeAttached();
    await setSceneOrder(api, ["lighthouse-arrival", "harbor-office-talk", "smuggler-captured"]);

    // Degrade: with EVERY scene played the view stays usable — the planned
    // list says so, the group holds both, and the center column still renders
    // a scene instead of blanking (or crashing on an empty selection).
    await patchScene(api, ARRIVAL, { status: "dropped" });
    await page.reload();
    await expect(nav).toContainText("Keine geplanten Szenen in diesem Kapitel.");
    await expect(nav.getByRole("button", { name: /^Gespielt/ })).toContainText("(2)");
    // The fallback is the FIRST done scene — the chapter's scene order again.
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
  // The scene is a LINK onto its own route — the row's `sceneId` never shows.
  await expect(log.getByRole("link", { name: "Ankunft am Leuchtturm" }).first()).toHaveAttribute(
    "href",
    "/campaigns/beispiel/scenes/lighthouse-arrival",
  );
  await expect(log).not.toContainText("lighthouse-arrival");
  // The third row names no scene, so it stands with its text alone.
  await expect(log).toContainText("Cliffhanger: Lichter in der Bucht gesichtet");

  // The PAUSE is an interval with its duration — 20:30 to 21:10 is 40 minutes.
  const pauses = page.getByRole("region", { name: "Pausen" });
  await expect(pauses).toContainText("0:40:00");

  // The PLAYED SCENES, as links onto their own routes; one opens its scene.
  const scenes = page.getByRole("region", { name: "Gespielte Szenen" });
  await scenes.getByRole("link", { name: "Ankunft am Leuchtturm" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/scenes\/lighthouse-arrival$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // The old ENTRY address of the same session answers 404 — no redirect, no
  // alias (ADR #26). Assembled from its segments rather than spelled out: a
  // literal address here would read like one the app still uses.
  const address = ["sessions", "2026-01-15"].join("/");
  const res = await api.fetch(`campaigns/beispiel/entries/${address}`);
  expect(res.status).toBe(404);
});

// The ORDER the DM arranged is what the session view moderates (ADR #27):
// which scene it opens on, which rows the nav shows in which sequence, and
// where the one step of the evening leads.
//
// A CONTINGENCY is never any of that. It fires when its trigger fires, so it
// stands in its own block and is skipped by both the entry point and the
// step — even when the order puts it ahead of the first planned scene that is
// still to come. That is the case this block is built around.
test.describe("the session view follows the chapter's order", () => {
  const ARRIVAL = "lighthouse-arrival";

  /** One planned scene of this block's chapter, in the seed's shape. */
  const planned = (id: string, title: string, location: string): SceneProposal => ({
    id,
    title,
    type: "planned",
    chapter: CHAPTER,
    location,
    npcs: [],
    handouts: [],
    tags: [],
    status: "draft",
    body: `\n## Flow\n\n${title}.\n`,
  });

  const DINNER = "Abendessen bei Jorna";
  const CELLAR = "Der Keller unter dem Turm";
  const CONTINGENCY = "Von den Schmugglern erwischt";

  test.use({
    seed: {
      scenes: [planned("abendessen", DINNER, "bucht"), planned("keller", CELLAR, "leuchtturm")],
    },
  });

  /** Start the evening from the overview — the session the view needs. */
  async function startSession(page: Page): Promise<void> {
    await page.goto("/campaigns/beispiel");
    await page.getByRole("button", { name: "Session starten" }).click();
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  }

  test("it opens the first planned scene still to come, never a contingency", async ({
    page,
    api,
  }) => {
    // The order deliberately puts the contingency BEFORE the first planned
    // scene that is still to come: `Ankunft` is behind us, the contingency
    // only fires on its trigger, so the evening starts at `Abendessen`.
    await setSceneOrder(api, ["lighthouse-arrival", "smuggler-captured", "abendessen", "keller"]);
    await patchScene(api, ARRIVAL, { status: "played" });

    await startSession(page);
    const nav = liveNav(page);
    const heading = page.getByRole("article").getByRole("heading", { level: 1 });

    // The nav is the DM's order: the plan first, in sequence, then the
    // contingency block, then the collapsed group of what is behind us.
    await expect(nav.getByRole("button")).toHaveText([
      new RegExp(`^${DINNER}`),
      new RegExp(`^${CELLAR}`),
      new RegExp(`^${CONTINGENCY}`),
      /^Gespielt/,
    ]);
    await expect(heading).toHaveText(DINNER);
    await expect(nav.getByRole("button", { name: new RegExp(DINNER) })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(nav.getByRole("button", { name: new RegExp(CONTINGENCY) })).not.toHaveAttribute(
      "aria-current",
      "true",
    );

    // The step names where the DM reaches next — the next PLANNED scene that
    // is still to come.
    const step = page.getByRole("button", { name: `Nächste Szene: ${CELLAR}` });
    await expect(step).toBeVisible();
    await step.click();
    await expect(heading).toHaveText(CELLAR);
    await expect(nav.getByRole("button", { name: new RegExp(CELLAR) })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // Nothing planned is left behind it, so there is no step at all — a dead
    // control would say less than a missing one.
    await expect(page.getByRole("button", { name: /^Nächste Szene: / })).toHaveCount(0);

    // From a CONTINGENCY the step picks up the plan again, at its first scene
    // still to come: the detour does not move the thread of the evening.
    await nav.getByRole("button", { name: new RegExp(CONTINGENCY) }).click();
    await expect(heading).toHaveText(CONTINGENCY);
    await expect(page.getByRole("button", { name: `Nächste Szene: ${DINNER}` })).toBeVisible();
  });

  test("Nächste Szene records the scene left — after a note in it, and only then", async ({
    page,
    api,
  }) => {
    await setSceneOrder(api, ["lighthouse-arrival", "smuggler-captured", "abendessen", "keller"]);
    await patchScene(api, ARRIVAL, { status: "played" });
    await startSession(page);
    const nav = liveNav(page);
    const heading = page.getByRole("article").getByRole("heading", { level: 1 });
    const sessionId = (await runningSessionId(api)) ?? "";
    const played = async () =>
      (await getSession(api, sessionId)).playedScenes.map((row) => row.sceneId);
    await expect(heading).toHaveText(DINNER);

    // A note in the open scene is a log entry with its scene — and nothing
    // else: the scene is not played yet.
    const quickNote = page.getByLabel("Schnellnotiz");
    await quickNote.fill("Jorna erzählt vom Keller #thread");
    await quickNote.press("Enter");
    await expect
      .poll(async () => (await getSession(api, sessionId)).log.map((row) => row.sceneId))
      .toEqual(["abendessen"]);
    expect(await played()).toEqual([]);

    // Leaving it with the step records the scene LEFT, then opens the next.
    await page.getByRole("button", { name: `Nächste Szene: ${CELLAR}` }).click();
    await expect(heading).toHaveText(CELLAR);
    await expect.poll(played).toEqual(["abendessen"]);
    await expect(
      nav.getByRole("button", { name: new RegExp(DINNER) }).getByText("Gespielt"),
    ).toBeAttached();

    // Without a note there is no sign the scene was played: leaving the
    // contingency with the step records nothing, and the DM marks it later.
    await nav.getByRole("button", { name: new RegExp(CONTINGENCY) }).click();
    await expect(heading).toHaveText(CONTINGENCY);
    await page.getByRole("button", { name: `Nächste Szene: ${DINNER}` }).click();
    await expect(heading).toHaveText(DINNER);
    // …and a scene already recorded in this session is not recorded twice.
    await page.getByRole("button", { name: `Nächste Szene: ${CELLAR}` }).click();
    await expect(heading).toHaveText(CELLAR);
    expect(await played()).toEqual(["abendessen"]);

    // Ending the session records nothing either, even with a note in the
    // scene that is open: it may carry on next time.
    await quickNote.fill("Die Tür im Keller klemmt");
    await quickNote.press("Enter");
    await expect
      .poll(async () => (await getSession(api, sessionId)).log.map((row) => row.sceneId))
      .toEqual(["abendessen", "keller"]);
    await (await sessionMenuItem(page, "Session beenden")).click();
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/review$/);
    await expect.poll(async () => (await getSession(api, sessionId)).ended).toBeDefined();
    expect(await played()).toEqual(["abendessen"]);
  });

  test("a rearranged order moves the entry point with it", async ({ page, api }) => {
    await setSceneOrder(api, ["lighthouse-arrival", "smuggler-captured", "abendessen", "keller"]);
    await patchScene(api, ARRIVAL, { status: "played" });
    await startSession(page);

    const nav = liveNav(page);
    const heading = page.getByRole("article").getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(DINNER);

    // The DM rearranges in the overview — the same one write the up/down
    // controls make. The session view reads that order, it keeps none.
    await setSceneOrder(api, ["lighthouse-arrival", "smuggler-captured", "keller", "abendessen"]);
    await page.reload();
    await expect(nav.getByRole("button")).toHaveText([
      new RegExp(`^${CELLAR}`),
      new RegExp(`^${DINNER}`),
      new RegExp(`^${CONTINGENCY}`),
      /^Gespielt/,
    ]);
    await expect(heading).toHaveText(CELLAR);
    await expect(page.getByRole("button", { name: `Nächste Szene: ${DINNER}` })).toBeVisible();
  });

  test("with the whole plan behind us it opens the first PLANNED scene and offers no step", async ({
    page,
    api,
  }) => {
    await setSceneOrder(api, ["smuggler-captured", "lighthouse-arrival", "abendessen", "keller"]);
    for (const scene of [ARRIVAL, "abendessen", "keller"]) {
      await patchScene(api, scene, { status: "played" });
    }

    await startSession(page);
    const heading = page.getByRole("article").getByRole("heading", { level: 1 });
    // The contingency stands FIRST in the order and is still `ready` — and it
    // is still not the entry point. The fallback is the first planned scene.
    await expect(liveNav(page)).toContainText("Keine geplanten Szenen in diesem Kapitel.");
    await expect(heading).toHaveText("Ankunft am Leuchtturm");
    await expect(page.getByRole("button", { name: /^Nächste Szene: / })).toHaveCount(0);
  });
});

// The session and its children are resources of their own (ADR #31): read
// flat with the children embedded, written one row at a time, each row with
// its own guard. The action endpoints of before answer nothing any more.
test("the session resources: flat reads, the running filter, a guard per row, no old addresses", async ({
  api,
}) => {
  const post = (path: string, body: unknown = {}) =>
    api.fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const patch = (path: string, body: unknown) =>
    api.fetch(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // Nothing runs: the filter answers a list of none.
  expect(await api.get(`${sessionPath(api)}?running=true`)).toEqual([]);

  // POST starts one; the filter now answers exactly that session.
  const started = await post(sessionPath(api));
  expect(started.status).toBe(201);
  const session = await started.json();
  expect(await api.get(`${sessionPath(api)}?running=true`)).toEqual([session]);
  // The list stands newest first: the new session before the fixture's.
  const list = await api.get<{ id: string }[]>(sessionPath(api));
  expect(list.map((row) => row.id)).toEqual([session.id, "2026-01-15"]);

  // Each child is written on its own resource and answers its own row.
  const pause = await (await post(pausePath(api, session.id))).json();
  const note = await (
    await post(logEntryPath(api, session.id), { text: "Notiz", sceneId: "lighthouse-arrival" })
  ).json();
  const played = await (
    await post(playedScenesPath(api, session.id), { sceneId: "lighthouse-arrival" })
  ).json();
  // The session reads them embedded — flat, no kind, no path, no properties
  // map — and none of those writes moved the session's own guard.
  const read = await api.get<Record<string, unknown>>(sessionPath(api, session.id));
  expect(read).toMatchObject({
    id: session.id,
    rev: session.rev,
    pauses: [pause],
    log: [note],
    playedScenes: [played],
  });
  for (const key of ["kind", "path", "properties", "scenesPlayed"]) {
    expect(Object.keys(read)).not.toContain(key);
  }

  // A stale guard on a child is 409 with the current row, and writes nothing.
  const ended = await patch(pausePath(api, session.id, pause.id), {
    rev: pause.rev,
    toMs: Date.now(),
  });
  expect(ended.status).toBe(200);
  const stalePause = await patch(pausePath(api, session.id, pause.id), {
    rev: pause.rev,
    toMs: Date.now(),
  });
  expect(stalePause.status).toBe(409);
  expect(await stalePause.json()).toMatchObject({ code: "rev_conflict", pause: await ended.json() });

  // A session with content is ended, not deleted …
  const refused = await api.fetch(sessionPath(api, session.id), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: session.rev }),
  });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "session_not_empty" });
  const end = await patch(sessionPath(api, session.id), { rev: session.rev, endedMs: Date.now() });
  expect(end.status).toBe(200);
  // … a stale session guard is 409 with the current session …
  const staleEnd = await patch(sessionPath(api, session.id), {
    rev: session.rev,
    endedMs: Date.now(),
  });
  expect(staleEnd.status).toBe(409);
  expect(await staleEnd.json()).toMatchObject({ code: "rev_conflict", session: await end.json() });
  expect(await api.get(`${sessionPath(api)}?running=true`)).toEqual([]);

  // … and an ended session takes no new child row: 409 `session_ended` for
  // each of them, and nothing is written.
  for (const [path, body] of [
    [pausePath(api, session.id), {}],
    [logEntryPath(api, session.id), { text: "zu spät" }],
    [playedScenesPath(api, session.id), { sceneId: "lighthouse-arrival" }],
  ] as const) {
    const late = await post(path, body);
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ code: "session_ended", id: session.id });
  }
  const after = await getSession(api, session.id);
  expect(after.log).toHaveLength(1);
  expect(after.pauses).toHaveLength(1);
  expect(after.playedScenes).toHaveLength(1);

  // The action endpoints of before are gone. Assembled from their segments:
  // a literal address here would read like one the app still uses.
  const old = (...segments: string[]) => `campaigns/beispiel/${segments.join("/")}`;
  expect((await api.fetch(old("session"))).status).toBe(404);
  expect((await post(old("session", "start"))).status).toBe(404);
  expect((await post(old("log"), { text: "Notiz" })).status).toBe(404);
});

// A note typed into a session that was ended elsewhere is refused, and the
// log says why in a whole sentence. The other writer and the Enter happen in
// the SAME turn, so the version poll cannot bring the ended session into the
// page in between.
test("a note into a session ended elsewhere: the sentence says so, nothing is written", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  const sessionId = (await runningSessionId(api)) ?? "";
  const session = await getSession(api, sessionId);
  await page.getByLabel("Schnellnotiz").fill("Noch schnell notiert");

  const seen = await page.evaluate(
    async ({ url, body, expected }) => {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { sentence: `end failed: ${res.status}`, note: "" };
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Schnellnotiz"]');
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      // The refusal renders within a moment — long before the next poll.
      for (let i = 0; i < 60; i++) {
        if (document.body.innerText.includes(expected)) {
          return { sentence: expected, note: input?.value ?? "" };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { sentence: document.body.innerText, note: input?.value ?? "" };
    },
    {
      url: api.url(sessionPath(api, sessionId)),
      body: { rev: session.rev, endedMs: Date.now() },
      expected:
        "Diese Session ist schon beendet, deshalb wurde nichts gespeichert. " +
        "Starte eine neue Session, um weiterzumachen.",
    },
  );
  expect(seen).toEqual({
    sentence:
      "Diese Session ist schon beendet, deshalb wurde nichts gespeichert. " +
      "Starte eine neue Session, um weiterzumachen.",
    // The note the DM typed is back in the field, not lost.
    note: "Noch schnell notiert",
  });
  // Nothing landed in the closed log.
  expect((await getSession(api, sessionId)).log).toEqual([]);
});
