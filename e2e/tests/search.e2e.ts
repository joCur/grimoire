// Kritischer Pfad 3: ⌘K-Suche findet und öffnet — siehe CLAUDE.md.
//
// Der ganze Weg läuft echt: Tastenkürzel → Palette → GET /search (Fuse.js im
// Server) → Tastatur-Navigation → Enter öffnet die Leseansicht.

import { expect, test } from "../support/test";

test("⌘K findet „leucht“ und Enter öffnet den Treffer", async ({ page }) => {
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

test("⌘K sagt es, wenn nichts passt, und Esc schließt", async ({ page }) => {
  await page.goto("/beispiel");
  await page.keyboard.press("ControlOrMeta+KeyK");
  const input = page.getByRole("combobox");
  await input.fill("zzzqqq");
  await expect(page.getByText("Nichts gefunden.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
});
