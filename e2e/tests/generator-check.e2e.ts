// Critical path 6: the chapter check (decisions/generator).
//
// The claims:
//
//   1. the chapter's reading view offers the check, and it leads to the
//      generator page, where the check waits on its terms stage: the term the
//      chapter writes in two ways stands there with both of its variants and
//      the scenes each one stands in; the term the glossary decides is not in
//      the stage;
//   2. accepting the stage makes every affected scene its own row of fixes,
//      and each row's comparison shows exactly the passages that change —
//      the glossary deviation among them;
//   3. accepting one row writes only that scene, and a row whose scene was
//      changed since the check read it is 409 and writes nothing;
//   4. the ticked term stands on the glossary page afterwards;
//   5. a chapter that writes its terms consistently ends the check with a
//      sentence, and nothing is written.
//
// The stub answers the check's calls from what the prompt carries
// (e2e/fixtures/replies.ts `checkTermsReply`, `checkMergeReply`,
// `checkFixReply`): the example chapter writes "the party" in both scenes and
// "the characters" in the smuggler scene (CHECK_PARTY), and both scenes write
// "lighthouse keeper", which the glossary renders as the Keeper (CHECK_KEEPER).

import type { Page } from "@playwright/test";
import type { Scene } from "@grimoire/shared/scene";

import { CHECK_KEEPER, CHECK_PARTY, checkFixReply } from "../fixtures/replies";
import { openArea } from "../support/campaign-menu";
import { getChapter } from "../support/chapter";
import { getGlossaryTerms } from "../support/glossary-term";
import { readGeneratorJob } from "../support/generator-job";
import { getScene, patchScene } from "../support/scene";
import { expect, test } from "../support/test";
import { ui } from "../support/ui";

const CHAPTER = "01-salt-harbour";
const ARRIVAL = "lighthouse-arrival";
const CAPTURED = "smuggler-captured";

/** The terms block a fix call of the example chapter carries, once the stage is accepted as proposed. */
const FIX_TERMS = [
  `- schreibe „the characters“ als „${CHECK_PARTY.rendering}“`,
  `- schreibe „${CHECK_KEEPER.wording}“ als „${CHECK_KEEPER.rendering}“`,
].join("\n");

/** The fixes the stub proposes for a scene as it is stored. */
function fixesOf(scene: Scene) {
  const { rev: _rev, ...form } = scene;
  return checkFixReply(form, FIX_TERMS).operations as Array<{ op: string; field?: string }>;
}

/** One scene's row of fixes in the check's review. */
function sceneFix(page: Page, id: string) {
  return page.getByTestId(`scene-extension:${id}`);
}

/** Start the check from the chapter's reading view. */
async function startCheck(page: Page, chapter: string): Promise<void> {
  await page.goto(`/campaigns/example/chapters/${chapter}`);
  await page.getByRole("button", { name: ui("chapterCheck.action") }).click();
  await expect(page).toHaveURL(/\/campaigns\/example\/generate$/);
}

test("a chapter check asks the terms the chapter writes differently and fixes each scene on its own", async ({
  page,
  api,
}) => {
  const arrival = await getScene(api, ARRIVAL);
  const captured = await getScene(api, CAPTURED);
  await startCheck(page, CHAPTER);

  // --- (1) the terms stage, with the variants and their places --------------
  const stage = page.getByTestId("terms-stage");
  await expect(stage).toBeVisible({ timeout: 30_000 });
  await expect(stage).toContainText(ui("generate.terms.lead.check"));
  const party = stage.getByTestId(`term:${CHECK_PARTY.wording}`);
  const variants = party.getByTestId("term-variant");
  await expect(variants).toHaveCount(2);
  await expect(variants.nth(0)).toContainText(`„the party“`);
  await expect(variants.nth(0)).toContainText(arrival.title);
  await expect(variants.nth(0)).toContainText(captured.title);
  await expect(variants.nth(1)).toContainText(`„the characters“`);
  await expect(variants.nth(1)).toContainText(captured.title);
  await expect(variants.nth(1)).not.toContainText(arrival.title);
  await expect(party.getByTestId("term-rendering")).toHaveValue(CHECK_PARTY.rendering);
  await expect(party.getByTestId("term-glossary")).toBeChecked();
  // The glossary decides the keeper: it is no question of the stage.
  await expect(stage.getByTestId(`term:${CHECK_KEEPER.wording}`)).toHaveCount(0);
  const waiting = await readGeneratorJob(api);
  expect(waiting?.kind).toBe("chapter-check");
  expect(waiting?.pipeline?.terms?.list.map((term) => term.wording)).toEqual([CHECK_PARTY.wording]);

  // --- (2) one row of fixes per affected scene ------------------------------
  await page
    .getByRole("button", { name: ui("generate.terms.accept.check", { count: 1 }) })
    .click();
  await expect(page.getByTestId("check-review")).toBeVisible({ timeout: 30_000 });
  for (const scene of [arrival, captured]) {
    const row = sceneFix(page, scene.id);
    await expect(row).toHaveAttribute("data-state", "open");
    await expect(row).toContainText(scene.title);
    const fixes = fixesOf(scene);
    expect(fixes.length).toBeGreaterThan(0);
    await expect(row.getByTestId("part-change")).toHaveCount(fixes.length);
  }
  // The keeper deviation is a fix of both scenes, the trigger of the smuggler
  // scene one of its fields.
  await expect(sceneFix(page, ARRIVAL)).toContainText(CHECK_KEEPER.rendering);
  await expect(
    sceneFix(page, CAPTURED).locator('[data-testid="part-change"][data-change-op="set"]'),
  ).toHaveCount(1);

  // --- (3) accepting one writes only that scene ------------------------------
  await sceneFix(page, CAPTURED).getByTestId("proposal-row-accept").click();
  await expect(sceneFix(page, CAPTURED)).toHaveAttribute("data-state", "written");
  const fixed = await getScene(api, CAPTURED);
  expect(fixed.rev).toBe(captured.rev + 1);
  expect(fixed.body).not.toContain("the characters");
  expect(fixed.body).not.toContain(CHECK_KEEPER.wording);
  expect(fixed.body).toContain(CHECK_KEEPER.rendering);
  expect(fixed.trigger).toBe(captured.trigger?.replace("The characters", "The party"));
  expect(fixesOf(fixed)).toEqual([]);
  // The other scene is untouched.
  expect(await getScene(api, ARRIVAL)).toEqual(arrival);

  // The arrival scene is changed elsewhere: its fixes are about the text the
  // check read, so accepting them is 409 and writes nothing.
  const changed = await patchScene(api, ARRIVAL, { rev: arrival.rev, title: `${arrival.title}!` });
  await sceneFix(page, ARRIVAL).getByTestId("proposal-row-accept").click();
  await expect(page.getByText(ui("server.fix_row_changed"))).toBeVisible();
  await expect(sceneFix(page, ARRIVAL)).toHaveAttribute("data-state", "open");
  expect(await getScene(api, ARRIVAL)).toEqual(changed);

  // --- (4) the ticked term stands on the glossary page ------------------------
  const explanation = `${CHECK_PARTY.rendering} — ${CHECK_PARTY.description}`;
  expect((await getGlossaryTerms(api)).find((term) => term.term === CHECK_PARTY.wording)?.explanation).toBe(
    explanation,
  );
  await page.goto("/campaigns/example");
  await openArea(page, "area.glossary");
  await expect(page).toHaveURL(/\/campaigns\/example\/glossary$/);
  await expect(page.getByText(explanation)).toBeVisible();
});

test("the check's stage and its fixes fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/example/chapters/${CHAPTER}`);
  const action = page.getByRole("button", { name: ui("chapterCheck.action") });
  await expect(action).toBeInViewport();
  // The keyboard reaches the action, and its focus is visible.
  await action.focus();
  await expect(action).toBeFocused();
  await action.press("Enter");
  await expect(page).toHaveURL(/\/campaigns\/example\/generate$/);

  await expect(page.getByTestId("terms-stage")).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByTestId("terms-accept").click();
  await expect(sceneFix(page, CAPTURED)).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const accept = sceneFix(page, CAPTURED).getByTestId("proposal-row-accept");
  await accept.scrollIntoViewIfNeeded();
  await expect(accept).toBeInViewport();
});

test.describe("a chapter that writes its terms consistently", () => {
  const CALM = "02-calm-waters";
  test.use({
    seed: {
      chapters: [
        { id: CALM, title: "Chapter 2: Calm Waters", status: "planned", body: "A quiet crossing.\n" },
      ],
      scenes: [
        {
          id: "calm-crossing",
          title: "A Calm Crossing",
          type: "planned",
          chapter: CALM,
          npcs: [],
          handouts: [],
          tags: [],
          status: "draft",
          body: "\n## Flow\n\nThe boat crosses the bay without a single wave.\n",
        },
      ],
    },
  });

  test("ends the check with a sentence and writes nothing", async ({ page, api }) => {
    const scene = await getScene(api, "calm-crossing");
    const chapter = await getChapter(api, CALM);
    await startCheck(page, CALM);
    await expect(page.getByTestId("check-consistent")).toHaveText(
      ui("generate.check.consistent", { chapter: chapter.title }),
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("terms-stage")).toHaveCount(0);
    expect(await getScene(api, "calm-crossing")).toEqual(scene);
    const job = await readGeneratorJob(api);
    expect(job?.status).toBe("done");
    expect(job?.pipeline?.parts).toEqual([]);

    // Closing it leaves nothing behind.
    await page.getByTestId("check-close").click();
    await expect.poll(() => readGeneratorJob(api)).toBeNull();
  });
});
