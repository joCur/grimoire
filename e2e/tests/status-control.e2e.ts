// Critical path 7: the scene's status written through the status control,
// including the 409 conflict; see CLAUDE.md.
//
// The patch goes through the documented API with its guard token (CLAUDE.md);
// the conflict is provoked by a SECOND WRITER through the same API — that is
// what "the row moved under the app" means.

import type { Page } from "@playwright/test";

import type { SceneStatus } from "@grimoire/shared/scene";
import { expect, test } from "../support/test";
import { getScene, patchScene } from "../support/scene";
import { ui, uiPattern } from "../support/ui";

const SCENE = "lighthouse-arrival";
const SCENE_URL = `/campaigns/beispiel/scenes/${SCENE}`;

/** The label of a scene status in the UI. */
const statusLabel = (status: SceneStatus) => ui(`status.scene.${status}`);

/** The accessible name of the status control while it shows the given status. */
const triggerName = (status: SceneStatus) =>
  ui("status.change.aria", { current: statusLabel(status) });

/** The status control, whatever status it currently shows — the pill IS the control. */
const statusTrigger = (page: Page) =>
  page.getByRole("button", {
    name: uiPattern("status.change.aria", { current: /.*/ }, { exact: true }),
  });

/** One option of the open status menu. */
const option = (page: Page, status: SceneStatus) =>
  page.getByRole("menuitemradio", { name: statusLabel(status) });

test("the status control writes the status of the scene", async ({ page, api }) => {
  await page.goto(SCENE_URL);
  expect((await getScene(api, SCENE)).status).toBe("ready");

  const trigger = statusTrigger(page);
  await expect(trigger).toHaveAccessibleName(triggerName("ready"));
  await trigger.click();

  // All four options, the current one checked.
  for (const status of ["draft", "ready", "played", "dropped"] as const) {
    await expect(option(page, status)).toBeVisible();
  }
  await expect(option(page, "ready")).toHaveAttribute("aria-checked", "true");
  await option(page, "played").click();

  await expect(trigger).toHaveAccessibleName(triggerName("played"));
  await expect.poll(() => getScene(api, SCENE)).toHaveProperty("status", "played");

  // …and back to ready — the scene follows every pick.
  await trigger.click();
  await option(page, "ready").click();
  await expect(trigger).toHaveAccessibleName(triggerName("ready"));
  await expect.poll(() => getScene(api, SCENE)).toHaveProperty("status", "ready");

  // The chapter overview row shows the same control with the same label.
  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("button", { name: triggerName("ready") }).first()).toBeVisible();
});

test("a second writer: the status pick reports the conflict inline", async ({
  page,
  api,
}) => {
  await page.goto(SCENE_URL);
  const trigger = statusTrigger(page);
  await expect(trigger).toHaveAccessibleName(triggerName("ready"));

  const message = page.getByText(ui("write.stale"));
  // A new BODY, same status: only the row's version moves, and that is what
  // the server compares against.
  const secondWriter = (n: number) => `\n## Flow\n\nChanged by a second writer (${n}).\n`;

  // The app refreshes its token on the next version poll (~5s), so the
  // conflict window is short: write, then pick immediately. A poll that lands
  // in between heals the staleness — hence up to three attempts.
  let conflicted = false;
  for (let attempt = 1; attempt <= 3 && !conflicted; attempt++) {
    await patchScene(api, SCENE, { body: secondWriter(attempt) });
    await trigger.click();
    await option(page, "played").click();
    conflicted = await message
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => true)
      .catch(() => false);
  }
  expect(conflicted, "the 409 conflict message never appeared").toBe(true);

  // Nothing was written: the other writer's content stands, unchanged.
  const stored = await getScene(api, SCENE);
  expect(stored.status).toBe("ready");
  expect(stored.body).toContain("Changed by a second writer");

  // The control re-read the scene, so the SAME pick works now.
  await trigger.click();
  await option(page, "played").click();
  await expect(trigger).toHaveAccessibleName(triggerName("played"));
  await expect(message).toHaveCount(0);
  await expect.poll(() => getScene(api, SCENE)).toHaveProperty("status", "played");
});
