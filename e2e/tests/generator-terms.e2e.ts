// Critical path 6: the terms stage of a scene run (decisions/generator).
//
// The claims:
//
//   1. a run whose outline names terms the campaign does not cover stops after
//      the outline: the review opens on the terms stage, grouped by kind, with
//      each term's wording, description and rendering — and no scene, npc or
//      location call has been made;
//   2. a term the campaign's glossary already has does not appear in it;
//   3. accepting all confirms every term as it stands — a changed rendering
//      included — and only then do the parts run: a location call and a scene
//      call each carry the decided renderings, which the stub echoes back as a
//      note of the part;
//   4. the ticked terms stand on the glossary page afterwards, an unticked one
//      does not.
//
// The stub's outline names one term of each kind (RUN_TERMS) plus one the
// example campaign's glossary has (COVERED_TERM) when the source carries
// TRIGGER.terms; a part call that carries the decided terms echoes them
// (e2e/fixtures/replies.ts `termsEcho`).

import type { Page } from "@playwright/test";

import {
  COVERED_TERM,
  LOCATION_STUB_ID,
  NPC_STUB_ID,
  RUN_TERMS,
  SCENE_ID,
  TERMS_ECHO,
  TRIGGER,
} from "../fixtures/replies";
import { openArea } from "../support/campaign-menu";
import { getGlossaryTerms } from "../support/glossary-term";
import { getGeneratorJob } from "../support/generator-job";
import {
  acceptProposal,
  expectStage,
  locationProposal,
  nextStage,
  npcProposal,
  sceneProposal,
} from "../support/generator-review";
import { expect, test } from "../support/test";
import { ui } from "../support/ui";

const SOURCE = `The party reaches the Tide Hall at dusk. A Companion of the harbour
greets them, and two Gullriders watch from the mole.`;

const [COMPANION, TIDE_HALL, GULLRIDERS, TIDE_COIN] = RUN_TERMS;

/** The rendering the DM gives the first term instead of the proposal. */
const OWN_RENDERING = "Oath Companion";

/** The terms stage, once the run waits on it. */
function termsStage(page: Page) {
  return page.getByTestId("terms-stage");
}

/** One term's row in the stage. */
function termRow(page: Page, wording: string) {
  return termsStage(page).getByTestId(`term:${wording}`);
}

test("a scene run waits on its terms and writes every part with the decided renderings", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/example/generate");
  await page
    .getByLabel(ui("generate.input.sourceLabel"), { exact: true })
    .fill(`${SOURCE}\n\n${TRIGGER.terms}`);
  await page.getByRole("button", { name: ui("generate.input.submit.scene") }).click();

  // --- (1) the run stops after the outline, on the terms stage --------------
  await expect(termsStage(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("generate.terms.title"));
  // Grouped by kind: one group per kind, each holding its term.
  for (const term of RUN_TERMS) {
    const group = termsStage(page).getByTestId(`terms-group:${term.kind}`);
    await expect(group.getByRole("heading", { level: 2 })).toHaveText(
      ui(`generate.terms.kind.${term.kind}`),
    );
    const row = group.getByTestId(`term:${term.wording}`);
    await expect(row).toContainText(term.wording);
    await expect(row).toContainText(term.description);
    await expect(row.getByTestId("term-rendering")).toHaveValue(term.rendering);
    await expect(row.getByTestId("term-glossary")).toBeChecked();
  }
  // No part call before the confirmation: the outline was the only call.
  const waiting = await getGeneratorJob(api);
  expect(waiting.status).toBe("done");
  expect(waiting.pipeline!.terms!.status).toBe("open");
  expect(waiting.pipeline!.parts.map((part) => part.status)).toEqual(
    waiting.pipeline!.parts.map(() => "pending"),
  );
  expect(waiting.pipeline!.totals.calls).toBe(1);

  // --- (2) a term the glossary covers is not asked again --------------------
  await expect(termRow(page, COVERED_TERM.wording)).toHaveCount(0);
  expect(waiting.pipeline!.terms!.list.map((term) => term.wording)).toEqual(
    RUN_TERMS.map((term) => term.wording),
  );

  // --- (3) accept all, one rendering changed and one term not kept ----------
  await termRow(page, COMPANION.wording).getByTestId("term-rendering").fill(OWN_RENDERING);
  await termRow(page, GULLRIDERS.wording).getByTestId("term-glossary").click();
  await expect(termRow(page, GULLRIDERS.wording).getByTestId("term-glossary")).not.toBeChecked();
  await page
    .getByRole("button", { name: ui("generate.terms.accept", { count: RUN_TERMS.length }) })
    .click();

  // The parts run now; the review walks its stages as always.
  await expectStage(page, "locations");
  const decided = `„${COMPANION.wording}“ als „${OWN_RENDERING}“`;
  const location = locationProposal(page, LOCATION_STUB_ID);
  await expect(location.getByTestId("part-notes")).toContainText(TERMS_ECHO);
  await expect(location.getByTestId("part-notes")).toContainText(decided);
  await acceptProposal(location);
  await nextStage(page);
  await expectStage(page, "npcs");
  await acceptProposal(npcProposal(page, NPC_STUB_ID));
  await nextStage(page);
  await expectStage(page, "scenes");
  const scene = sceneProposal(page, SCENE_ID);
  await expect(scene.getByTestId("part-notes")).toContainText(TERMS_ECHO);
  await expect(scene.getByTestId("part-notes")).toContainText(decided);
  // The renderings left as proposed travel as they stood.
  await expect(scene.getByTestId("part-notes")).toContainText(
    `„${TIDE_COIN.wording}“ als „${TIDE_COIN.rendering}“`,
  );

  const confirmed = await getGeneratorJob(api);
  expect(confirmed.pipeline!.terms).toEqual({
    status: "confirmed",
    list: [{ ...COMPANION, rendering: OWN_RENDERING }, TIDE_HALL, GULLRIDERS, TIDE_COIN],
  });

  // --- (4) the ticked terms stand in the glossary, the unticked one not -----
  await page.goto("/campaigns/example");
  await openArea(page, "area.glossary");
  await expect(page).toHaveURL(/\/campaigns\/example\/glossary$/);
  await expect(page.getByText(`${OWN_RENDERING} — ${COMPANION.description}`)).toBeVisible();
  await expect(page.getByText(`${TIDE_HALL.rendering} — ${TIDE_HALL.description}`)).toBeVisible();
  await expect(page.getByText(GULLRIDERS.description)).toHaveCount(0);
  const glossary = await getGlossaryTerms(api);
  expect(glossary.find((term) => term.term === COMPANION.wording)?.explanation).toBe(
    `${OWN_RENDERING} — ${COMPANION.description}`,
  );
  expect(glossary.some((term) => term.term === GULLRIDERS.wording)).toBe(false);
  // The covered term's glossary row stays the DM's own.
  expect(glossary.filter((term) => term.term.toLowerCase() === "lighthouse keeper")).toHaveLength(1);
});

test("the terms stage fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/campaigns/example/generate");
  await page
    .getByLabel(ui("generate.input.sourceLabel"), { exact: true })
    .fill(`${SOURCE}\n\n${TRIGGER.terms}`);
  await page.getByRole("button", { name: ui("generate.input.submit.scene") }).click();
  await expect(termsStage(page)).toBeVisible({ timeout: 30_000 });
  // No horizontal scroll, and the accept action is reachable.
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  const accept = page.getByTestId("terms-accept");
  await accept.scrollIntoViewIfNeeded();
  await expect(accept).toBeInViewport();
  // The keyboard reaches a rendering field, and its focus is visible.
  const field = termRow(page, COMPANION.wording).getByTestId("term-rendering");
  await field.focus();
  await expect(field).toBeFocused();
});
