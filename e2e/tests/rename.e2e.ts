// Critical paths 2 and 7: renaming an id from the reading view, with the
// USAGE PREVIEW the DM decides on (issue #60).
//
// A rename is the one action that touches other documents, so the dialog is
// two steps: „Vorschau" asks the server for the plan (a dryRun — nothing is
// written) and shows what hangs off the id in German, and only the second
// click commits. What this spec pins is that the preview's numbers describe
// the cascade that then actually happens: the same reference kinds the
// example campaign has (a scene's `npcs:` list and two `## Beziehungen`
// lines) are counted first and rewritten after.

import { expect, test } from "../support/test";

const NPC = "npcs/jorna.md";
const RENAMED = "npcs/hafenmeisterin.md";
const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";

test("rename with usage preview: count first, then the cascade", async ({ page, api }) => {
  await page.goto(`/beispiel/file/${NPC}`);
  await expect(page.getByRole("heading", { name: "Hafenmeisterin Jorna" })).toBeVisible();

  await page.getByRole("button", { name: "Umbenennen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("NPC umbenennen");

  // The dialog opens with the input focused — keyboard first (CLAUDE.md).
  const input = dialog.getByRole("textbox");
  await expect(input).toBeFocused();

  // A rule violation is caught before any request goes out.
  await input.fill("Jorna Neu");
  await expect(dialog).toContainText("Kleinbuchstaben");

  await input.fill("hafenmeisterin");
  await dialog.getByRole("button", { name: "Vorschau" }).click();

  // The preview: what hangs off this id, in German — one scene naming the npc
  // in its `npcs:` list and two `## Beziehungen` lines (both directions).
  const summary = dialog.getByTestId("rename-usage");
  await expect(summary).toContainText("3 Verwendungen");
  await expect(summary).toContainText("1 Szene");
  await expect(summary).toContainText("2 Beziehungen");

  // …and which documents that means.
  await expect(dialog).toContainText("betrifft 3 Dateien");
  await expect(dialog).toContainText(SCENE);
  await expect(dialog).toContainText("npcs/fenn.md");

  // Nothing has been written yet: the preview is a dry run.
  expect(await api.exists(NPC)).toBe(true);
  expect(await api.exists(RENAMED)).toBe(false);

  await dialog.getByRole("button", { name: "Umbenennen" }).click();

  // The reading view follows the file to its new address …
  await expect(page).toHaveURL(new RegExp(`/beispiel/file/${RENAMED}$`));
  await expect(page.getByRole("heading", { name: "Hafenmeisterin Jorna" })).toBeVisible();

  // … and the cascade the preview counted actually happened.
  expect(await api.exists(NPC)).toBe(false);
  expect(await api.exists(RENAMED)).toBe(true);
  const scene = await api.file(SCENE);
  expect(scene.frontmatter.npcs).toEqual(["hafenmeisterin"]);
  expect(await api.raw("npcs/fenn.md")).toContain("- hafenmeisterin:");
  // The prose of the other scene still says "Jorna" — a mention is not a
  // reference (README).
  expect(await api.raw("01-salzhafen/hafen/smuggler-captured.md")).toContain("Jorna");

  // The endpoint behind the preview agrees, for the new id: the rows moved,
  // and nothing points at the old one any more.
  const usage = await api.get<{ total: number }>(
    "beispiel/usage?kind=npc&id=hafenmeisterin",
  );
  expect(usage.total).toBe(3);
  expect((await api.fetch("beispiel/usage?kind=npc&id=jorna")).status).toBe(404);
});
