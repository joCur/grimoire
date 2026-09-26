// Critical path 8: the mobile start surface and the idea capture at 390px;
// see CLAUDE.md.
//
// Mobile is search, reading view and ideas (UI-BRIEF) — exactly that, checked
// at 390×844 (iPhone size), including what the server stored.

import escapeStringRegexp from "escape-string-regexp";
import type { SessionSeed } from "@grimoire/shared/session";

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";
import { getCampaign } from "../support/campaign";
import { getIdeas } from "../support/idea";
import { getNpc } from "../support/npc";
import { getScene } from "../support/scene";
import { ui, uiPattern } from "../support/ui";

/** A session that started YESTERDAY and was never ended. */
const OPEN_SESSION: SessionSeed = (() => {
  const d = new Date(Date.now() - 24 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const id = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { id, started: `${id}T22:30:00`, body: "", pauses: [], log: [] };
})();

test.use({ viewport: { width: 390, height: 844 } });

const IDEA = "A night market at the harbour as a hook #thread";

/** The idea capture field of the start surface. */
const ideaCapture = (page: Page) => page.getByLabel(ui("mobileStart.inbox.label"));

test("mobile start surface: search, idea capture, lookup lists", async ({ page, api }) => {
  const campaign = await getCampaign(api);
  const ideasBefore = await getIdeas(api);
  await page.goto("/campaigns/beispiel");

  // The desktop topbar is desktop chrome — below md the surface carries its
  // own wordmark instead.
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(
    page.getByRole("main").getByText(ui("topbar.brand"), { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText(ui("campaign.switcher.current", { name: campaign.name })),
  ).toBeVisible();
  // The desktop chapter overview is not rendered here.
  await expect(page.getByText(ui("scene.contingencies.heading"))).toBeHidden();

  // Lookup rows with their counts from the tree. The example campaign has two
  // of each; the two locations exist on their own because a reference
  // creates nothing (decisions/constraints).
  const tree = await api.get<{
    chapters: { scenes: unknown[] }[];
    npcs: unknown[];
    locations: unknown[];
  }>("campaigns/beispiel/tree");
  const sceneCount = tree.chapters.reduce((n, chapter) => n + chapter.scenes.length, 0);
  expect([sceneCount, tree.npcs.length, tree.locations.length]).toEqual([2, 2, 2]);

  const lookup = page.getByRole("navigation", { name: ui("lookup.heading") });
  const lookupRow = (key: "browse.title.scenes" | "browse.title.npcs" | "browse.title.locations") =>
    lookup.getByRole("link", { name: new RegExp(`^${escapeStringRegexp(ui(key))}`) });
  await expect(lookupRow("browse.title.scenes")).toContainText(
    ui("mobileStart.count.scenes", { count: sceneCount }),
  );
  await expect(lookupRow("browse.title.npcs")).toContainText(
    ui("mobileStart.count.npcs", { count: tree.npcs.length }),
  );
  // The npc row leads to the npc list on its own route (decisions/resources).
  await expect(lookupRow("browse.title.npcs")).toHaveAttribute("href", "/campaigns/beispiel/npcs");
  await expect(lookupRow("browse.title.locations")).toContainText(
    ui("mobileStart.count.locations", { count: tree.locations.length }),
  );

  // --- idea capture --------------------------------------------------------
  const capture = ideaCapture(page);
  await capture.fill(IDEA);
  await page.getByRole("button", { name: ui("mobileStart.inbox.submit") }).click();

  await expect(page.getByText(ui("mobileStart.inbox.saved"))).toBeVisible();
  await expect(capture).toHaveValue("");
  // The idea is an IDEA of its own, flat, with its own guard, at the end: the
  // idea that was already there survives unchanged, and nothing is ticked off.
  expect(ideasBefore).toHaveLength(1);
  await expect.poll(() => getIdeas(api)).toEqual([
    { ...ideasBefore[0], done: false, rev: 1 },
    { id: expect.any(String), text: IDEA, done: false, rev: 1 },
  ]);

  // --- search and reading view ---------------------------------------------
  const fenn = await getNpc(api, "fenn");
  await page.getByRole("button", { name: ui("mobileStart.search") }).click();
  const search = page.getByRole("combobox");
  await expect(search).toBeVisible();
  await search.fill("fenn");
  await page.getByRole("option").filter({ hasText: fenn.name }).first().click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/fenn$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fenn.name);
  // The mobile read view has its own way back to the start surface.
  const back = page.getByRole("link", { name: ui("mobileBack.chapterOverview") });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(ideaCapture(page)).toBeVisible();
});

// A running session must be visible on EVERY route, mobile included — where
// the topbar is not the chrome, the indicator is its own row.
test.describe("with a session open since yesterday", () => {
  test.use({ seed: { sessions: [OPEN_SESSION] } });

  test("mobile: a running session shows its own live row with the way back", async ({
    page,
  }) => {
    // The session is the server's answer, not something the client derives
    // from today's date — it comes out of the seeded session row.
    await page.goto("/campaigns/beispiel");
    // The same chip the desktop topbar carries — in link mode, in the mobile
    // row: one tap back into the session.
    const row = page.getByRole("link", {
      name: uiPattern("session.state.running"),
    });
    await expect(row).toBeVisible();
    // The runtime is computed from the SERVER's reading of `started`, so it is
    // a real elapsed time (well over an hour by now), not 0:00:00.
    await expect(row).toContainText(/\d+:\d{2}:\d{2}/);
    await row.click();
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  });
});

test("mobile: the reference scene's reading view stays readable", async ({ page, api }) => {
  const scene = await getScene(api, "lighthouse-arrival");
  const jorna = await getNpc(api, "jorna");
  // Reached the way a phone reaches it: the lookup row of the start surface,
  // then the scene list — onto the scene's own route (decisions/resources).
  await page.goto("/campaigns/beispiel");
  await page
    .getByRole("link", { name: new RegExp(`^${escapeStringRegexp(ui("browse.title.scenes"))}`) })
    .click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/scenes$/);
  await page.getByRole("link", { name: new RegExp(escapeStringRegexp(scene.title)) }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/scenes\/lighthouse-arrival$/);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(scene.title);
  await expect(page.locator("[data-callout='readaloud']")).toBeVisible();
  // The NPC cards stack below the body instead of sitting in a sticky aside.
  await expect(
    page.getByRole("link", { name: new RegExp(escapeStringRegexp(jorna.name)) }).first(),
  ).toBeVisible();

  // Nothing may scroll the page sideways at 390px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
