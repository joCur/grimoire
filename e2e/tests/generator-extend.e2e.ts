// Critical path 6: a scene run also extends the npcs and locations the
// campaign already has (decisions/generator).
//
// The claims:
//
//   1. the switch at the run's start is on by default; the run then names
//      an existing npc in its outline, and that npc stands in the npc stage
//      as a change to an existing row, with every change beside the row as
//      the run read it,
//   2. such a change does not hold the scene stage back: the scenes are
//      reachable and acceptable while it is open,
//   3. each change is taken or kept on its own, and accepting writes only the
//      taken ones onto the stored row, in one write,
//   4. a change whose anchor is gone by the accept changes nothing and stands
//      on the row as a finding, while the rest is written,
//   5. with the switch off the run behaves as before: no npc is extended.
//
// The stub answers TRIGGER.extendNpc with one plain scene and — only when the
// outline prompt carries the rules for extending — the existing npc
// EXTENDED_NPC_ID, whose extension part replies with a field set, a block
// inserted after one of its stored blocks and a note (e2e/fixtures/replies.ts).

import type { Page } from "@playwright/test";

import {
  EXTEND_NPC_ANCHOR,
  EXTEND_NPC_BLOCK,
  EXTEND_NPC_MOTIVATION,
  EXTEND_NPC_NOTE,
  EXTEND_SCENE,
  EXTENDED_NPC_ID,
  TRIGGER,
} from "../fixtures/replies";
import { expect, test } from "../support/test";
import { readGeneratorJob } from "../support/generator-job";
import {
  applyScenes,
  expectStage,
  nextStage,
  reviewStage,
  sceneProposal,
} from "../support/generator-review";
import { getNpc, patchNpc } from "../support/npc";
import { sceneExists } from "../support/scene";
import { ui } from "../support/ui";

const SOURCE = `Fenn waits at the end of the mole. He owes the harbour master a favour
since the storm and wants it paid back before the next one.

${TRIGGER.extendNpc}`;

/** The row of the changes the run proposes to an existing npc. */
function npcExtension(page: Page, id: string) {
  return page.getByTestId(`npc-extension:${id}`);
}

/** Fill the scene run's source text and start it, the extend switch as it stands. */
async function startSceneRun(page: Page): Promise<void> {
  await page.getByLabel(ui("generate.input.sourceLabel")).fill(SOURCE);
  await page.getByRole("button", { name: ui("generate.input.submit.scene") }).click();
}

test("a scene run extends an existing npc: changes taken or kept, the scenes not held back", async ({
  page,
  api,
}) => {
  const before = await getNpc(api, EXTENDED_NPC_ID);
  await page.goto(`/campaigns/example/generate`);
  // (1) The switch is on unless the DM switches it off.
  await expect(page.getByTestId("generate-extend")).toBeChecked();
  await startSceneRun(page);

  // The run proposes no new npc and no new location: its npc stage holds the
  // extension of Fenn, with both changes and the model's note.
  await expectStage(page, "npcs");
  const row = npcExtension(page, EXTENDED_NPC_ID);
  await expect(row).toHaveAttribute("data-state", "open");
  const changes = row.getByTestId("part-change");
  await expect(changes).toHaveCount(2);
  await expect(changes.nth(0)).toHaveAttribute("data-change-op", "set");
  await expect(changes.nth(1)).toHaveAttribute("data-change-op", "insertAfter");
  await expect(row).toContainText(EXTEND_NPC_NOTE);

  // (2) The open extension holds nothing back: on to the scenes, and the
  // scene is accepted while Fenn is still undecided.
  await expect(page.getByTestId("review-next")).toBeEnabled();
  await nextStage(page);
  await expectStage(page, "scenes");
  await expect(sceneProposal(page, EXTEND_SCENE.id)).toBeVisible();
  await applyScenes(page).click();
  await expect.poll(() => sceneExists(api, EXTEND_SCENE.id)).toBe(true);
  // Fenn is still open, so the run is too.
  await expect.poll(async () => (await readGeneratorJob(api))?.status).toBe("done");

  // (3) Back to the npc: keep the inserted block out, take the motivation.
  await page.getByTestId("review-back").click();
  await expectStage(page, "npcs");
  await changes.nth(1).getByTestId("decision-keep").click();
  await expect(changes.nth(1).getByTestId("decision-keep")).toHaveAttribute("aria-pressed", "true");
  await expect(changes.nth(0).getByTestId("decision-take")).toHaveAttribute("aria-pressed", "true");
  await row.getByTestId("proposal-row-accept").click();

  // The accept was the run's last open part: the review ends, and Fenn got
  // exactly the taken change, in one write.
  await expect(reviewStage(page)).toHaveCount(0);
  const after = await getNpc(api, EXTENDED_NPC_ID);
  expect(after.motivation).toBe(EXTEND_NPC_MOTIVATION);
  expect(after.body).toBe(before.body);
  expect(after.rev).toBe(before.rev + 1);
  expect(await readGeneratorJob(api)).toBeNull();
});

test("a change whose anchor is gone by the accept shows as a finding, the rest is written", async ({
  page,
  api,
}) => {
  await page.goto(`/campaigns/example/generate`);
  await startSceneRun(page);
  await expectStage(page, "npcs");
  const row = npcExtension(page, EXTENDED_NPC_ID);
  await expect(row.getByTestId("part-change")).toHaveCount(2);

  // Someone takes the block the insert is anchored on out of Fenn's text
  // while the run waits.
  const stored = await getNpc(api, EXTENDED_NPC_ID);
  const body = stored.body.replace(EXTEND_NPC_ANCHOR, "");
  expect(body).not.toBe(stored.body);
  await patchNpc(api, EXTENDED_NPC_ID, { rev: stored.rev, body });

  // Both changes taken: the set lands, the insert finds no anchor.
  await row.getByTestId("proposal-row-accept").click();
  await expect(row).toHaveAttribute("data-state", "written");
  await expect(row.getByTestId("part-finding")).toHaveCount(1);
  const after = await getNpc(api, EXTENDED_NPC_ID);
  expect(after.motivation).toBe(EXTEND_NPC_MOTIVATION);
  expect(after.body).toBe(body);
  expect(after.body).not.toContain(EXTEND_NPC_BLOCK);
});

test("with the switch off, a scene run extends nothing", async ({ page, api }) => {
  const before = await getNpc(api, EXTENDED_NPC_ID);
  await page.goto(`/campaigns/example/generate`);
  await page.getByTestId("generate-extend").click();
  await expect(page.getByTestId("generate-extend")).not.toBeChecked();
  await startSceneRun(page);

  // No npc to decide: the review opens at the scenes, and the run has no
  // extension part.
  await expectStage(page, "scenes");
  await expect(npcExtension(page, EXTENDED_NPC_ID)).toHaveCount(0);
  const job = await readGeneratorJob(api);
  expect(job?.pipeline?.parts.some((part) => part.existing === true)).toBe(false);

  await applyScenes(page).click();
  await expect.poll(() => sceneExists(api, EXTEND_SCENE.id)).toBe(true);
  expect(await readGeneratorJob(api)).toBeNull();
  expect((await getNpc(api, EXTENDED_NPC_ID)).rev).toBe(before.rev);
});
