// Critical path 3: the ⌘K search finds and opens; see CLAUDE.md.
//
// The whole way is real: shortcut → palette → GET /search (FTS5 on the
// server) → keyboard navigation → Enter opens the reading view.
//
// Plus the freshness claim: what the APP just wrote is findable IMMEDIATELY —
// the search index is maintained in the same transaction as the write, so
// there is no watcher to wait for.
//
// And what the index HOLDS: the five entry kinds plus the glossary terms.
// A glossary term is a row of a list (ADR #26), so its hit carries `kind` and
// `id` and no address — the palette opens it through the glossary page.
// Sessions and ideas are not indexed at all, so no query can produce one.

import { expect, test } from "../support/test";

test("⌘K finds \"leucht\" and Enter opens the hit", async ({ page }) => {
  await page.goto("/campaigns/beispiel");
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
  // Scene, location and the campaign entry all match "leucht".
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

  await expect(page).toHaveURL(
    /\/campaigns\/beispiel\/entries\/01-salzhafen\/leuchtturm\/lighthouse-arrival$/,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  // The palette closed on pick.
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("content the APP just wrote is findable right away", async ({
  page,
  api,
}) => {
  // A word that appears nowhere in the example campaign, so a hit can only
  // come from the paragraph typed below.
  const WORD = "Zwirbelmuschel";
  const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

  // Not findable before — proven through the search endpoint itself.
  const before = await api.get<{ results: unknown[] }>(
    `campaigns/beispiel/search?q=${encodeURIComponent(WORD)}`,
  );
  expect(before.results).toEqual([]);

  // The DM writes it in the editor: „Bearbeiten" → „Markdown" → save.
  await page.goto(`/campaigns/beispiel/entries/${SCENE}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const textarea = page.getByRole("textbox", { name: "Markdown-Text von" });
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
  await expect(page).toHaveURL(new RegExp(`/campaigns/beispiel/entries/${SCENE.replace(/\./g, "\\.")}$`));
  await expect(page.getByRole("article")).toContainText(WORD);
});

test("a glossary hit opens the glossary page — no address, and none needed", async ({
  page,
  api,
}) => {
  const TERM = "smugglers' cove";

  // On the wire: the hit names its row by `kind` and `id`, and carries NO
  // `path`. An address here would 404 for whoever followed it.
  const { results } = await api.get<{
    results: { kind: string; id: string; path?: string; title: string }[];
  }>("campaigns/beispiel/search?q=smugglers");
  const glossary = results.filter((hit) => hit.kind === "glossary");
  expect(glossary).toHaveLength(1);
  expect(glossary[0]?.id).toBe(TERM);
  expect(glossary[0]).not.toHaveProperty("path");

  // In the palette: the term shows with its list's label and opens the
  // glossary page, where the row actually lives.
  await page.goto("/campaigns/beispiel");
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill("smugglers");
  const hit = page.getByRole("option").filter({ hasText: TERM });
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText("Glossar");
  await hit.click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/glossary$/);
  await expect(page.getByText(TERM)).toBeVisible();
});

test("sessions and ideas are not in the index, so they never turn up", async ({ api }) => {
  // Words that appear ONLY in the example campaign's session log and in its
  // one idea. Indexing those lists would be its own feature; until then a
  // query for their words finds nothing.
  for (const query of ["Dorfschmied", "Schmugglerwerkzeug", "Metta"]) {
    const { results } = await api.get<{ results: { kind: string }[] }>(
      `campaigns/beispiel/search?q=${encodeURIComponent(query)}`,
    );
    expect(results.filter((hit) => hit.kind === "session" || hit.kind === "inbox")).toEqual([]);
  }
});

test("⌘K says so when nothing matches, and Esc closes it", async ({ page }) => {
  await page.goto("/campaigns/beispiel");
  await page.keyboard.press("ControlOrMeta+KeyK");
  const input = page.getByRole("combobox");
  await input.fill("zzzqqq");
  await expect(page.getByText("Nichts gefunden.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
});
