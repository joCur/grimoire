// Critical path 8: the phone's start of a campaign and the idea capture at
// 390px; see CLAUDE.md.
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
import { areaEntry, campaignMenu, currentAreaEntry, openArea } from "../support/campaign-menu";
import { ui, uiPattern } from "../support/ui";
import { CAMPAIGN } from "../support/paths";

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

test("mobile start: search, idea capture, the chapter overview and the campaign menu", async ({
  page,
  api,
}) => {
  const campaign = await getCampaign(api);
  const ideasBefore = await getIdeas(api);
  await page.goto(`/campaigns/${CAMPAIGN}`);

  // The desktop topbar is desktop chrome — below md the start carries its
  // own wordmark, and next to it the campaign menu.
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(
    page.getByRole("main").getByText(ui("topbar.brand"), { exact: true }),
  ).toBeVisible();
  await expect(campaignMenu(page)).toHaveAccessibleName(
    ui("campaignMenu.triggerInArea", { name: campaign.name, area: ui("area.chapters") }),
  );
  // Below search and idea capture stands the chapter overview itself: the
  // campaign's header, and the active chapter with its scenes.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(campaign.name);
  await expect(page.getByText(ui("scene.contingencies.heading"))).toBeVisible();
  await expect(page.getByRole("link", { name: /Arrival at the Lighthouse/ })).toBeVisible();

  // The campaign menu opens as a sheet from the bottom edge, with every area
  // in its group and the current one marked.
  await campaignMenu(page).click();
  const sheet = page.getByRole("dialog", { name: ui("campaignMenu.title") });
  await expect(sheet).toBeVisible();
  const sheetBox = (await sheet.boundingBox())!;
  expect(Math.round(sheetBox.y + sheetBox.height)).toBe(844);
  for (const [group, areas] of [
    ["campaignMenu.group.prepare", ["area.chapters", "area.scenes", "area.npcs", "area.locations"]],
    ["campaignMenu.group.lookUp", ["area.glossary", "area.knowledge"]],
    ["campaignMenu.group.tidyUp", ["area.review", "area.trash"]],
  ] as const) {
    const links = sheet.getByRole("group", { name: ui(group) }).getByRole("link");
    await expect(links).toHaveCount(areas.length);
    for (const [index, area] of areas.entries()) {
      await expect(links.nth(index)).toContainText(ui(area));
    }
  }
  await expect(currentAreaEntry(page)).toContainText(ui("area.chapters"));
  // Every entry is a touch target.
  for (const box of await Promise.all(
    (await sheet.getByRole("link").all()).map((link) => link.boundingBox()),
  )) {
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  // The npc entry leads to the npc list on its own route (decisions/resources).
  await areaEntry(page, "area.npcs").click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/npcs$`));
  await expect(sheet).toBeHidden();
  await openArea(page, "area.chapters");
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}$`));

  // Nothing scrolls sideways at this width.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

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

  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/npcs/fenn$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fenn.name);
  // The mobile read view carries the campaign menu, the way back to the start.
  await expect(campaignMenu(page)).toHaveAccessibleName(
    ui("campaignMenu.triggerInArea", { name: campaign.name, area: ui("area.npcs") }),
  );
  await openArea(page, "area.chapters");
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}$`));
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
    await page.goto(`/campaigns/${CAMPAIGN}`);
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
    await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/live$`));
  });
});

test("mobile: the reference scene's reading view stays readable", async ({ page, api }) => {
  const scene = await getScene(api, "lighthouse-arrival");
  const jorna = await getNpc(api, "jorna");
  // Reached the way a phone reaches it: the campaign menu's sheet, then the
  // scene list — onto the scene's own route (decisions/resources).
  await page.goto(`/campaigns/${CAMPAIGN}`);
  await openArea(page, "area.scenes");
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/scenes$`));
  await page.getByRole("link", { name: new RegExp(escapeStringRegexp(scene.title)) }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/scenes/lighthouse-arrival$`));

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
