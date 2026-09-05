// Critical path 3: the ⌘K search finds and opens; see CLAUDE.md.
//
// The whole way is real: shortcut → palette → GET /search (FTS5 on the
// server since issue #57) → keyboard navigation → Enter opens the reading
// view.
//
// Plus the freshness claim of the cutover (issue #57 AK5): what the APP just
// wrote is findable IMMEDIATELY — the search index is maintained in the same
// transaction as the write, so there is no watcher to wait for any more.

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

  await expect(page).toHaveURL(/\/beispiel\/file\/01-salzhafen\/hafen\/lighthouse-arrival\.md$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  // The palette closed on pick.
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("content the APP just wrote is findable right away (issue #57 AK5)", async ({
  page,
  api,
}) => {
  // A word that appears nowhere in examples/beispiel, so a hit can only come
  // from the paragraph typed below.
  const WORD = "Zwirbelmuschel";
  const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";

  // Not findable before — proven through the search endpoint itself.
  const before = await api.get<{ results: unknown[] }>(
    `beispiel/search?q=${encodeURIComponent(WORD)}`,
  );
  expect(before.results).toEqual([]);

  // The DM writes it in the editor: „Bearbeiten" → „Roh" → save.
  await page.goto(`/beispiel/file/${SCENE}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByRole("button", { name: "Roh", exact: true }).click();
  const textarea = page.getByRole("textbox", { name: "Markdown-Text der Datei" });
  const body = await textarea.inputValue();
  await textarea.fill(`${body}\nAm Steg liegt eine ${WORD} im Tang.\n`);
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(WORD);

  // ⌘K finds it in the same breath — no reload, no watcher, no index lag.
  await page.keyboard.press("ControlOrMeta+KeyK");
  const input = page.getByRole("combobox");
  await input.fill(WORD);
  const hit = page.getByRole("option").filter({ hasText: "Ankunft am Leuchtturm" });
  await expect(hit).toHaveCount(1);
  // … and the row opens the scene the word was typed into.
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/beispiel/file/${SCENE.replace(/\./g, "\\.")}$`));
  await expect(page.getByRole("article")).toContainText(WORD);
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
