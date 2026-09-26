// The review of a scene run in the browser: its stages (decisions/generator)
// — the new locations, then the new npcs, then the scenes — and the rows and
// cards in them, found by their test ids and roles.

import type { Locator, Page } from "@playwright/test";

import { expect } from "./test";
import { ui } from "./ui";

export type ReviewStage = "locations" | "npcs" | "scenes";

/** The stage section the review shows right now. */
export function reviewStage(page: Page): Locator {
  return page.getByTestId("review-stage");
}

/** The step of a stage in the review's step list. */
export function reviewStep(page: Page, stage: ReviewStage): Locator {
  return page.getByTestId(`review-step:${stage}`);
}

/** Wait until the review shows `stage`. */
export async function expectStage(page: Page, stage: ReviewStage): Promise<void> {
  await expect(reviewStage(page)).toHaveAttribute("data-stage", stage, { timeout: 30_000 });
}

/** The row of a proposed location. */
export function locationProposal(page: Page, id: string): Locator {
  return page.getByTestId(`location-proposal:${id}`);
}

/** The row of a proposed npc. */
export function npcProposal(page: Page, id: string): Locator {
  return page.getByTestId(`npc-proposal:${id}`);
}

/** The card of a proposed scene. */
export function sceneProposal(page: Page, id: string): Locator {
  return page.getByTestId(`scene-proposal:${id}`);
}

/** Accept a proposal row — which writes it — and wait until it is written. */
export async function acceptProposal(row: Locator): Promise<void> {
  await row.getByRole("button", { name: ui("generate.stub.accept"), exact: true }).click();
  await expect(row).toHaveAttribute("data-state", "written");
}

/** Reject a proposal row and wait until it says so. */
export async function rejectProposal(row: Locator): Promise<void> {
  await row.getByRole("button", { name: ui("generate.stub.reject"), exact: true }).click();
  await expect(row).toHaveAttribute("data-state", "rejected");
}

/** Go on to the next stage. */
export async function nextStage(page: Page): Promise<void> {
  await page.getByTestId("review-next").click();
}

/**
 * Walk the default run (one new location, one new npc) to its scene stage,
 * accepting both proposals on the way.
 */
export async function acceptProposalsOfRun(
  page: Page,
  location: string,
  npc: string,
): Promise<void> {
  await expectStage(page, "locations");
  await acceptProposal(locationProposal(page, location));
  await nextStage(page);
  await expectStage(page, "npcs");
  await acceptProposal(npcProposal(page, npc));
  await nextStage(page);
  await expectStage(page, "scenes");
}

/** The scene stage's accept action: every open scene that can be written. */
export function applyScenes(page: Page): Locator {
  return page.getByTestId("review-apply-scenes");
}
