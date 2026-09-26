// Critical path 11, from the edit modes: deleting a scene, an npc, a location
// or a chapter (decisions/trash); see CLAUDE.md.
//
// The delete action of an edit mode asks first. The dialog says what goes to
// the trash — a chapter's scenes and threads with it — and that unsaved
// changes are discarded; the unsaved-changes guard does not ask a second
// time on the way out. `DELETE …/<entity>/:id { rev }` puts the row in the
// trash, the page leads to the chapter overview (scene, chapter) or the list
// (npc, location), and the undo notice restores the row with the `rev` the
// delete answered with. A delete something live stands in the way of
// (`trash_blocked`) names it in the dialog and writes nothing; one against a
// row changed elsewhere says so and writes nothing either.
//
// Elements are found by role and catalog key (decisions/testing); every claim
// about what was deleted or restored reads the rows through the API.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { ChapterProposal } from "@grimoire/shared/chapter";
import type { LocationProposal } from "@grimoire/shared/location";
import type { SceneProposal } from "@grimoire/shared/scene";
import type { Thread, ThreadSeed } from "@grimoire/shared/thread";
import { TRASH_RETENTION_DAYS } from "@grimoire/shared/trash";
import type { Page } from "@playwright/test";
import escapeStringRegexp from "escape-string-regexp";

import type { Api } from "../support/api";
import { chapterExists, getTrashedChapters } from "../support/chapter";
import { getLocation, getTrashedLocations, locationExists } from "../support/location";
import { getNpc, npcExists } from "../support/npc";
import { CAMPAIGN } from "../support/paths";
import { getTrashedScenes, patchScene, sceneExists } from "../support/scene";
import { expect, test } from "../support/test";
import { ui, uiExact } from "../support/ui";

/** The first chapter of the example campaign, where the extra scene stands. */
const HARBOUR = "01-salt-harbour";
/** A planned scene of the first chapter that nothing names. */
const QUAY: SceneProposal = {
  id: "quay-watch",
  title: "Night watch on the quay",
  type: "planned",
  chapter: HARBOUR,
  npcs: [],
  handouts: [],
  tags: [],
  status: "draft",
  body: "\n## Flow\n\nThe lanterns sway.\n",
};

/** A second chapter with two scenes and a thread, nothing else naming it. */
const COVE: ChapterProposal = {
  id: "02-cove",
  title: "Chapter 2: The cove",
  status: "planned",
  body: "What the smugglers hide in the cove.\n",
};
function coveScene(id: string, title: string): SceneProposal {
  return { ...QUAY, id, title, chapter: COVE.id };
}
const LANDING = coveScene("cove-landing", "Landing in the cove");
const TIDE = coveScene("cove-tide", "The tide comes in");
const COVE_THREAD: ThreadSeed = {
  id: "who-lit-the-fire",
  chapter: COVE.id,
  text: "Who lit the fire in the cove?",
  done: false,
};

/** A location that no scene plays at. */
const WATCHTOWER: LocationProposal = {
  id: "watchtower",
  name: "The old watchtower",
  chapter: HARBOUR,
  body: "",
};

/** The npc a live scene of the seed names, and that scene. */
const FENN = "fenn";
const FENN_NAME = "Fenn";
const CAPTURED_TITLE = "Caught by the Smugglers";

function editAction(page: Page) {
  return page.getByRole("button", { name: ui("common.edit"), exact: true });
}

function deleteAction(page: Page) {
  return page.getByRole("button", { name: uiExact("editMode.delete") });
}

function confirmAction(page: Page) {
  return page.getByRole("button", { name: uiExact("editMode.delete.confirm") });
}

function undoAction(page: Page) {
  return page.getByRole("button", { name: uiExact("notice.undo") });
}

/** A link of the page's main area whose name contains this text. */
function mainLink(page: Page, text: string) {
  return page.getByRole("main").getByRole("link", { name: new RegExp(escapeStringRegexp(text)) });
}

/** The scene ids of a chapter, in its order, from the campaign tree. */
async function sceneOrder(api: Api, chapter: string): Promise<string[]> {
  const tree = await api.get<CampaignTree>(`campaigns/${CAMPAIGN}/tree`);
  return (tree.chapters.find((node) => node.id === chapter)?.scenes ?? []).map((scene) => scene.id);
}

/** Open the edit mode of the reading view at this address. */
async function openEditMode(page: Page, url: string) {
  await page.goto(url);
  await editAction(page).click();
  await expect(deleteAction(page)).toBeVisible();
}

test.describe("a scene", () => {
  test.use({ seed: { scenes: [QUAY] } });

  test("is deleted from its edit mode with its unsaved changes, and the notice brings it back", async ({
    page,
    api,
  }) => {
    const order = await sceneOrder(api, HARBOUR);
    expect(order).toContain(QUAY.id);
    await openEditMode(page, `/campaigns/${CAMPAIGN}/scenes/${QUAY.id}`);
    // Unsaved work: the dialog says it goes, and nothing asks a second time.
    await page.getByRole("textbox", { name: ui("sceneEdit.title.aria") }).fill("A new title");

    await deleteAction(page).click();
    const dialog = page.getByRole("dialog", { name: ui("sceneEdit.delete.title") });
    await expect(dialog).toContainText(
      ui("sceneEdit.delete.description", { title: QUAY.title, days: TRASH_RETENTION_DAYS }),
    );
    await expect(dialog).toContainText(ui("editMode.delete.unsaved"));

    // Keeping it writes nothing.
    await dialog.getByRole("button", { name: ui("common.cancel"), exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await sceneExists(api, QUAY.id)).toBe(true);

    await deleteAction(page).click();
    await confirmAction(page).click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(ui("editMode.delete.done", { name: QUAY.title }))).toBeVisible();
    await expect(mainLink(page, QUAY.title)).toHaveCount(0);
    expect(await sceneExists(api, QUAY.id)).toBe(false);
    const [trashed] = await getTrashedScenes(api);
    // The unsaved title went with it: the trash holds the stored scene.
    expect(trashed).toMatchObject({ id: QUAY.id, title: QUAY.title });

    await undoAction(page).click();
    await expect(mainLink(page, QUAY.title)).toBeVisible();
    expect(await sceneExists(api, QUAY.id)).toBe(true);
    expect(await getTrashedScenes(api)).toEqual([]);
    // A scene restored on its own returns at the end of its chapter.
    expect(await sceneOrder(api, HARBOUR)).toEqual([
      ...order.filter((id) => id !== QUAY.id),
      QUAY.id,
    ]);
  });

  test("changed elsewhere, it is not deleted, and the dialog says why", async ({ page, api }) => {
    await openEditMode(page, `/campaigns/${CAMPAIGN}/scenes/${QUAY.id}`);
    await patchScene(api, QUAY.id, { status: "ready" });

    await deleteAction(page).click();
    await confirmAction(page).click();
    const dialog = page.getByRole("dialog", { name: ui("sceneEdit.delete.title") });
    await expect(dialog.getByRole("alert")).toHaveText(
      ui("editMode.delete.stale", { name: QUAY.title }),
    );
    expect(await sceneExists(api, QUAY.id)).toBe(true);
    expect(await getTrashedScenes(api)).toEqual([]);
  });
});

test.describe("a chapter", () => {
  test.use({ seed: { chapters: [COVE], scenes: [LANDING, TIDE], threads: [COVE_THREAD] } });

  test("goes to the trash with its scenes and threads, as the dialog says", async ({
    page,
    api,
  }) => {
    await openEditMode(page, `/campaigns/${CAMPAIGN}/chapters/${COVE.id}`);
    await deleteAction(page).click();
    const dialog = page.getByRole("dialog", { name: ui("chapterEdit.delete.title") });
    await expect(dialog).toContainText(
      ui("chapterEdit.delete.description", { title: COVE.title, days: TRASH_RETENTION_DAYS }),
    );
    await expect(dialog).toContainText(
      ui("chapterEdit.delete.along.both", { scenes: 2, threads: 1 }),
    );
    // Nothing unsaved, so nothing to warn about.
    await expect(dialog).not.toContainText(ui("editMode.delete.unsaved"));

    await confirmAction(page).click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}$`));
    await expect(mainLink(page, LANDING.title)).toHaveCount(0);
    expect(await chapterExists(api, COVE.id)).toBe(false);
    expect((await getTrashedChapters(api)).map((chapter) => chapter.id)).toEqual([COVE.id]);
    expect((await getTrashedScenes(api)).map((scene) => scene.id).sort()).toEqual([
      LANDING.id,
      TIDE.id,
    ]);
    expect(await api.get<Thread[]>(`campaigns/${CAMPAIGN}/threads?chapter=${COVE.id}`)).toEqual([]);

    // The trash page shows it as one row with its scenes.
    await page.goto(`/campaigns/${CAMPAIGN}/trash`);
    const row = page
      .getByRole("region", { name: ui("trash.group.chapters") })
      .getByRole("listitem")
      .filter({ hasText: COVE.title });
    await expect(row).toContainText(ui("trash.chapter.scenes", { count: 2 }));
  });
});

test("an npc a live scene names is not deleted, and the dialog names the scene", async ({
  page,
  api,
}) => {
  const before = await getNpc(api, FENN);
  await openEditMode(page, `/campaigns/${CAMPAIGN}/npcs/${FENN}`);
  await deleteAction(page).click();
  const dialog = page.getByRole("dialog", { name: ui("npcEdit.delete.title") });
  await expect(dialog).toContainText(
    ui("npcEdit.delete.description", { name: FENN_NAME, days: TRASH_RETENTION_DAYS }),
  );
  await confirmAction(page).click();

  await expect(dialog.getByRole("alert")).toHaveText(
    ui("server.trash_blocked", {
      blockers: ui("server.blocker.scene", { name: CAPTURED_TITLE }),
      count: 1,
    }),
  );
  // The dialog stays, the edit mode behind it, and nothing was written.
  await expect(page).toHaveURL(new RegExp(`/npcs/${FENN}$`));
  expect(await npcExists(api, FENN)).toBe(true);
  expect(await getNpc(api, FENN)).toEqual(before);
});

test.describe("on the phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, seed: { locations: [WATCHTOWER] } });

  test("a location's delete action is in reach, and the list follows the delete", async ({
    page,
    api,
  }) => {
    const before = await getLocation(api, WATCHTOWER.id);
    await openEditMode(page, `/campaigns/${CAMPAIGN}/locations/${WATCHTOWER.id}`);
    await expect(deleteAction(page)).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    await deleteAction(page).click();
    await expect(page.getByRole("dialog", { name: ui("locationEdit.delete.title") })).toBeVisible();
    await confirmAction(page).click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/locations$`));
    await expect(mainLink(page, WATCHTOWER.name)).toHaveCount(0);
    expect(await locationExists(api, WATCHTOWER.id)).toBe(false);

    await undoAction(page).click();
    await expect(mainLink(page, WATCHTOWER.name)).toBeVisible();
    expect(await getTrashedLocations(api)).toEqual([]);
    // Deleted and restored: two writes on its guard.
    expect(await getLocation(api, WATCHTOWER.id)).toEqual({ ...before, rev: before.rev + 2 });
  });
});
