// Critical path 3: the ⌘K search finds and opens; see CLAUDE.md.
//
// The whole way is real: shortcut → palette → GET /search (Fuse.js on the
// server) → keyboard navigation → Enter opens the reading view.

import { expect, test } from "../support/test";

test("⌘K finds \"leucht\" and Enter opens the hit", async ({ page }) => {
  await page.goto("/beispiel");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );

  // The global shortcut (⌘K on macOS, Ctrl-K elsewhere).
  await page.keyboard.press("ControlOrMeta+KeyK");
  const input = page.getByRole("combobox");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("placeholder", "Szenen, NPCs, Orte durchsuchen …");

  await input.fill("leucht");

  const options = page.getByRole("option");
  // Scene, location and the campaign file all match "leucht".
  await expect(options.filter({ hasText: "Ankunft am Leuchtturm" })).toHaveCount(1);
  await expect(options.filter({ hasText: "Szene" })).not.toHaveCount(0);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");

  // Keyboard navigation moves the active option and wraps around.
  const count = await options.count();
  expect(count).toBeGreaterThan(1);
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(options.first()).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("ArrowUp");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");

  // Navigate to the scene row explicitly, then open it with Enter.
  const scene = options.filter({ hasText: "Ankunft am Leuchtturm" });
  for (let i = 0; i < count; i++) {
    if ((await scene.getAttribute("aria-selected")) === "true") break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(scene).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/beispiel\/file\/01-salzhafen\/hafen\/ankunft-leuchtturm\.md$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  // The palette closed on pick.
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("⌘K says so when nothing matches, and Esc closes it", async ({ page }) => {
  await page.goto("/beispiel");
  await page.keyboard.press("ControlOrMeta+KeyK");
  const input = page.getByRole("combobox");
  await input.fill("zzzqqq");
  await expect(page.getByText("Nichts gefunden.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
});
