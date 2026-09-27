// Critical path 11: the trash (decisions/trash); see CLAUDE.md.
//
// Deleting an idea in the session review puts it in the trash
// (`DELETE …/ideas/:id { rev }`), and the notice beside it takes it back out
// (`PATCH …/ideas/:id { rev, deletedMs: null }`). The trash page — reached
// from the campaign menu, on the desktop and on the phone, and ⌘K — lists what is in the trash with the days it has left and restores it. A
// chapter that went there with its scenes is ONE row and brings its scenes
// back in their order; a restore that something in the trash stands in the
// way of says what, and writes nothing.
//
// Every claim about what was deleted or restored reads the rows through the
// API; the page is reached by roles and catalog keys only.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { ChapterProposal } from "@grimoire/shared/chapter";
import type { LocationProposal } from "@grimoire/shared/location";
import type { SceneProposal } from "@grimoire/shared/scene";
import { TRASH_RETENTION_DAYS } from "@grimoire/shared/trash";
import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";
import type { Api } from "../support/api";
import { chapterExists, getTrashedChapters, trashChapter } from "../support/chapter";
import { getIdeas, getTrashedIdeas } from "../support/idea";
import { getTrashedLocations, locationExists, trashLocation } from "../support/location";
import { getTrashedScenes, sceneExists, trashScene } from "../support/scene";
import { campaignMenu, openArea } from "../support/campaign-menu";
import { ui, uiExact, uiPattern } from "../support/ui";

/** The seeded idea of the example campaign, as its review card shows it (hashtag stripped). */
const IDEA_ID = "village-smith";
const IDEA_CARD_TEXT = "Idea: the village smith repairs smuggling tools suspiciously often";

/** A second chapter of the campaign, with scenes and a location of its own. */
const COVE: ChapterProposal = {
  id: "02-cove",
  title: "Chapter 2: The cove",
  status: "planned",
  body: "What the smugglers hide in the cove.\n",
};
const CAVE: LocationProposal = {
  id: "cove-cave",
  name: "The cave behind the cove",
  chapter: "02-cove",
  body: "",
};
function coveScene(id: string, title: string, location?: string): SceneProposal {
  return {
    id,
    title,
    type: "planned",
    chapter: "02-cove",
    ...(location === undefined ? {} : { location }),
    npcs: [],
    handouts: [],
    tags: [],
    status: "draft",
    body: "\n## Flow\n\nThe tide is out.\n",
  };
}
const LANDING = coveScene("cove-landing", "Landing in the cove");
const TIDE = coveScene("cove-tide", "The tide comes in");
const CAVE_SCENE = coveScene("cove-the-cave", "Into the cave", "cove-cave");

/** The group of the trash page with that heading. */
function trashGroup(page: Page, heading: Parameters<typeof ui>[0]) {
  return page.getByRole("region", { name: ui(heading) });
}

/** One row of the trash page, found by the name it shows. */
function trashRow(page: Page, name: string) {
  return page.getByRole("main").getByRole("listitem").filter({ hasText: name });
}

/** The restore action of the row with that name. */
function restoreAction(page: Page, name: string) {
  return page.getByRole("button", { name: ui("trash.restore.aria", { name }) });
}

/** The scene ids of a chapter, in its order, from the campaign tree. */
async function sceneOrder(api: Api, chapter: string): Promise<string[]> {
  const tree = await api.get<CampaignTree>("campaigns/example/tree");
  return (tree.chapters.find((node) => node.id === chapter)?.scenes ?? []).map((scene) => scene.id);
}

test("deleting an idea puts it in the trash, the notice undoes it, the trash page restores it", async ({
  page,
  api,
}) => {
  const [before] = await getIdeas(api);
  await page.goto("/campaigns/example/review");

  // --- delete, then undo from the notice -----------------------------------
  const deleteIdea = page.getByRole("button", {
    name: ui("idea.trash.aria", { text: IDEA_CARD_TEXT }),
  });
  await deleteIdea.click();
  await expect(page.getByText(ui("idea.trash.done"))).toBeVisible();
  await expect(deleteIdea).toBeHidden();
  await expect.poll(() => getIdeas(api)).toEqual([]);
  const [trashed] = await getTrashedIdeas(api);
  expect(trashed).toEqual({ ...before, deletedMs: expect.any(Number), rev: before!.rev + 1 });

  await page.getByRole("button", { name: uiExact("notice.undo") }).click();
  await expect(deleteIdea).toBeVisible();
  await expect.poll(() => getIdeas(api)).toEqual([{ ...before, rev: before!.rev + 2 }]);
  expect(await getTrashedIdeas(api)).toEqual([]);

  // --- delete again, and restore from the trash page -----------------------
  await deleteIdea.click();
  await expect.poll(async () => (await getTrashedIdeas(api)).map((idea) => idea.id)).toEqual([
    IDEA_ID,
  ]);

  // The trash is reached from the campaign menu.
  await page.goto("/campaigns/example");
  await openArea(page, "area.trash");
  await expect(page).toHaveURL(/\/campaigns\/example\/trash$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("trash.title"));
  // The topbar is still this campaign's: its search is there.
  await expect(
    page
      .getByRole("banner")
      .getByRole("button", { name: new RegExp(`^${uiPattern("topbar.search").source}`) }),
  ).toBeVisible();

  const row = trashGroup(page, "trash.group.ideas").getByRole("listitem").filter({
    hasText: before!.text,
  });
  await expect(row).toContainText(ui("trash.remaining", { days: TRASH_RETENTION_DAYS }));
  await restoreAction(page, before!.text).click();

  await expect(page.getByText(ui("trash.empty"))).toBeVisible();
  await expect.poll(() => getIdeas(api)).toEqual([{ ...before, rev: before!.rev + 4 }]);
  expect(await getTrashedIdeas(api)).toEqual([]);
});

test.describe("a chapter in the trash", () => {
  test.use({ seed: { chapters: [COVE], scenes: [LANDING, TIDE] } });

  test("is one row with its scenes, and brings them back in their order", async ({
    page,
    api,
  }) => {
    // The DM's order is not the order of creation: the tide comes first.
    const tree = await api.get<CampaignTree>("campaigns/example/tree");
    const node = tree.chapters.find((chapter) => chapter.id === COVE.id)!;
    await api.send("PUT", `campaigns/example/chapters/${COVE.id}/scene-order`, {
      scenes: [TIDE.id, LANDING.id],
      rev: node.sceneOrderRev,
    });
    const trashed = await trashChapter(api, COVE.id);
    // The scenes went with it, at the same moment.
    expect(
      (await getTrashedScenes(api)).map((scene) => [scene.id, scene.deletedMs]).sort(),
    ).toEqual([
      [LANDING.id, trashed.deletedMs],
      [TIDE.id, trashed.deletedMs],
    ]);

    await page.goto("/campaigns/example/trash");
    const row = trashGroup(page, "trash.group.chapters")
      .getByRole("listitem")
      .filter({ hasText: COVE.title });
    await expect(row).toContainText(ui("trash.chapter.scenes", { count: 2 }));
    await expect(row).toContainText(ui("trash.remaining", { days: TRASH_RETENTION_DAYS }));
    // Its scenes are no rows of their own.
    await expect(trashGroup(page, "trash.group.scenes")).toHaveCount(0);
    await expect(trashRow(page, LANDING.title)).toHaveCount(0);

    await restoreAction(page, COVE.title).click();
    await expect(page.getByText(ui("trash.empty"))).toBeVisible();
    expect(await chapterExists(api, COVE.id)).toBe(true);
    expect(await getTrashedChapters(api)).toEqual([]);
    expect(await getTrashedScenes(api)).toEqual([]);
    expect(await sceneOrder(api, COVE.id)).toEqual([TIDE.id, LANDING.id]);
  });
});

test.describe("a restore something in the trash stands in the way of", () => {
  test.use({ seed: { chapters: [COVE], locations: [CAVE], scenes: [CAVE_SCENE] } });

  test("says what is in the way and writes nothing, until that comes back first", async ({
    page,
    api,
  }) => {
    // The scene plays at the location, so the scene goes first.
    await trashScene(api, CAVE_SCENE.id);
    await trashLocation(api, CAVE.id);

    await page.goto("/campaigns/example/trash");
    await restoreAction(page, CAVE_SCENE.title).click();
    await expect(trashRow(page, CAVE_SCENE.title)).toContainText(
      ui("server.restore_blocked", {
        blockers: ui("server.blocker.location", { name: CAVE.name }),
        count: 1,
      }),
    );
    expect(await sceneExists(api, CAVE_SCENE.id)).toBe(false);
    expect((await getTrashedScenes(api)).map((scene) => scene.id)).toEqual([CAVE_SCENE.id]);

    // The location first, then the scene.
    await restoreAction(page, CAVE.name).click();
    await expect(trashRow(page, CAVE.name)).toHaveCount(0);
    await restoreAction(page, CAVE_SCENE.title).click();
    await expect(page.getByText(ui("trash.empty"))).toBeVisible();
    expect(await locationExists(api, CAVE.id)).toBe(true);
    expect(await sceneExists(api, CAVE_SCENE.id)).toBe(true);
    expect(await getTrashedLocations(api)).toEqual([]);
  });
});

test("⌘K names the trash as a page of the campaign", async ({ page }) => {
  await page.goto("/campaigns/example");
  await expect(
    page
      .getByRole("banner")
      .getByRole("button", { name: new RegExp(`^${uiPattern("topbar.search").source}`) }),
  ).toBeVisible();
  const input = page.getByRole("combobox");
  await expect(async () => {
    if (!(await input.isVisible())) await page.keyboard.press("ControlOrMeta+KeyK");
    await expect(input).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await input.fill(ui("trash.title"));
  await page.getByRole("option", { name: new RegExp(ui("trash.title")) }).click();
  await expect(page).toHaveURL(/\/campaigns\/example\/trash$/);
});

test.describe("on the phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, seed: { chapters: [COVE], scenes: [LANDING] } });

  test("the campaign menu leads to the trash, which fits the width", async ({ page, api }) => {
    await trashChapter(api, COVE.id);
    await page.goto("/campaigns/example");
    await openArea(page, "area.trash");
    await expect(page).toHaveURL(/\/campaigns\/example\/trash$/);
    await expect(restoreAction(page, COVE.title)).toBeVisible();
    // No horizontal scroll at 390px.
    const overflow = await page.evaluate(() =>
      [document.documentElement, document.querySelector("main")!].map(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    );
    expect(overflow).toEqual([0, 0]);
    // The campaign menu is still on screen, naming the trash as its area.
    await expect(campaignMenu(page)).toHaveAccessibleName(
      uiPattern("campaignMenu.triggerInArea", { name: /.*/, area: ui("area.trash") }),
    );
  });
});
