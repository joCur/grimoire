// Critical path 3: the ⌘K search finds and opens; see CLAUDE.md.
//
// The whole way is real: shortcut → palette → GET /search (FTS5 on the
// server) → keyboard navigation → Enter opens the reading view.
//
// Plus the freshness claim: what the APP just wrote is findable IMMEDIATELY —
// the search index is maintained in the same transaction as the write, so
// there is no watcher to wait for.
//
// And what the index HOLDS: campaign, chapters, scenes, npcs, locations and the
// glossary terms. The campaign, a chapter, a scene, an npc and a location are
// each their own resource (decisions/resources) and a glossary term a row of a list
// (decisions/resources), so every hit carries `kind` and `id` and no address — the palette
// opens the campaign's route (the chapter overview), the chapter's, the
// scene's, the npc's and the location's route and the glossary page.
// Sessions and ideas are not indexed at all, so no query can produce one.
//
// Search queries and the titles hits are filtered by are words of the example
// campaign in fixtures/, which is German.

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";
import { getGlossaryTerm } from "../support/glossary-term";
import { ui, uiExact } from "../support/ui";

const CAMPAIGN_NAME = "Der Leuchtturm von Salzhafen";
const CHAPTER_TITLE = "Kapitel 1: Der Leuchtturm von Salzhafen";
const SCENE_TITLE = "Ankunft am Leuchtturm";

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Opens the palette with the global shortcut and returns its input.
 *
 * The shortcut listens only once the top bar has mounted the palette, which
 * is also when the top bar's search button is there — so the button is the
 * signal to wait for. The press is repeated until the input shows, because the
 * listener is attached in an effect right after that render.
 */
async function openPalette(page: Page) {
  await expect(
    page
      .getByRole("banner")
      .getByRole("button", { name: new RegExp(`^${escaped(ui("topbar.search"))}`) }),
  ).toBeVisible();
  const input = page.getByRole("combobox");
  await expect(async () => {
    if (!(await input.isVisible())) await page.keyboard.press("ControlOrMeta+KeyK");
    await expect(input).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return input;
}

test("⌘K finds \"leucht\" and Enter opens the hit", async ({ page, api }) => {
  // On the wire a scene hit is `{ kind: "scene", id, title }` and no `path`.
  const { results } = await api.get<{
    results: { kind: string; id: string; path?: string; title: string }[];
  }>("campaigns/beispiel/search?q=leucht");
  const sceneHit = results.find((hit) => hit.kind === "scene");
  expect(sceneHit).toMatchObject({ kind: "scene", id: "lighthouse-arrival" });
  expect(sceneHit).not.toHaveProperty("path");

  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_NAME);

  // The global shortcut (⌘K on macOS, Ctrl-K elsewhere).
  const input = await openPalette(page);
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("placeholder", ui("palette.placeholder"));
  await input.fill("leucht");

  const options = page.getByRole("option");
  // Scene, location and the campaign entry all match "leucht".
  await expect(options.filter({ hasText: SCENE_TITLE })).toHaveCount(1);
  await expect(options.filter({ hasText: ui("kind.scene") })).not.toHaveCount(0);
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
  const scene = options.filter({ hasText: SCENE_TITLE });
  for (let i = 0; i < count; i++) {
    if ((await scene.getAttribute("aria-selected")) === "true") break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(scene).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/scenes\/lighthouse-arrival$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);
  // The palette closed on pick.
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("content the APP just wrote is findable right away", async ({
  page,
  api,
}) => {
  // A word that appears nowhere in the example campaign, so a hit can only
  // come from the paragraph typed below.
  const WORD = "Twirlshell";
  const SCENE = "lighthouse-arrival";

  // Not findable before — proven through the search endpoint itself.
  const before = await api.get<{ results: unknown[] }>(
    `campaigns/beispiel/search?q=${encodeURIComponent(WORD)}`,
  );
  expect(before.results).toEqual([]);

  // The DM writes it in the editor: edit → raw markdown → save.
  await page.goto(`/campaigns/beispiel/scenes/${SCENE}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);
  await page.getByRole("button", { name: ui("common.edit") }).click();
  await page.getByRole("button", { name: ui("composer.mode.markdown"), exact: true }).click();
  const textarea = page.getByRole("textbox", {
    name: ui("bodyEditor.markdown.aria", { path: SCENE_TITLE }),
  });
  const body = await textarea.inputValue();
  await textarea.fill(`${body}\nA ${WORD} lies in the kelp by the jetty.\n`);
  await page.getByRole("button", { name: ui("common.save"), exact: true }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(WORD);

  // ⌘K finds it in the same breath — no reload, no watcher, no index lag.
  const input = await openPalette(page);
  await input.fill(WORD);
  const hit = page.getByRole("option").filter({ hasText: SCENE_TITLE });
  await expect(hit).toHaveCount(1);
  // … and the row opens the scene the word was typed into.
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/beispiel/scenes/${SCENE}$`));
  await expect(page.getByRole("article")).toContainText(WORD);
});

test("an npc hit opens the npc's own route — its kind and id, no address", async ({
  page,
  api,
}) => {
  // On the wire: `{ kind: "npc", id, title }` and no `path` — an npc is its
  // own resource (decisions/resources). The word stands only in Fenn's text.
  const { results } = await api.get<{
    results: { kind: string; id: string; path?: string; title: string }[];
  }>("campaigns/beispiel/search?q=Ausstieg");
  const npc = results.find((hit) => hit.kind === "npc");
  expect(npc).toMatchObject({ kind: "npc", id: "fenn" });
  expect(npc).not.toHaveProperty("path");

  await page.goto("/campaigns/beispiel");
  await (await openPalette(page)).fill("Ausstieg");
  const hit = page.getByRole("option").filter({ hasText: "Fenn" });
  await expect(hit).toHaveCount(1);
  await hit.click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/fenn$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fenn");
  // The context line points at the npc list, on its own route too.
  await expect(
    page.getByRole("link", { name: ui("topbar.nav.npcs") }).first(),
  ).toHaveAttribute("href", "/campaigns/beispiel/npcs");
});

test("the palette's NPC list entry opens the npc list on its own route", async ({ page }) => {
  await page.goto("/campaigns/beispiel");
  await (await openPalette(page)).fill(ui("browse.title.npcs"));
  const option = page
    .getByRole("option")
    .filter({ hasText: ui("browse.title.npcs") })
    .filter({ hasText: ui("palette.kind.page") });
  await expect(option.first()).toBeVisible();
  await option.first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("browse.title.npcs"));
  // The list links every npc to its own route.
  await expect(page.getByRole("link", { name: /Fenn/ }).first()).toHaveAttribute(
    "href",
    "/campaigns/beispiel/npcs/fenn",
  );
});

test("a location hit opens the location's own route — its kind and id, no address", async ({
  page,
  api,
}) => {
  // On the wire: `{ kind: "location", id, title }` and no `path` — a location
  // is its own resource (decisions/resources).
  const { results } = await api.get<{
    results: { kind: string; id: string; path?: string; title: string }[];
  }>("campaigns/beispiel/search?q=Lampen");
  const location = results.find((hit) => hit.kind === "location");
  expect(location).toMatchObject({ kind: "location", id: "leuchtturm" });
  expect(location).not.toHaveProperty("path");

  await page.goto("/campaigns/beispiel");
  await (await openPalette(page)).fill("Lampen");
  const hit = page.getByRole("option").filter({ hasText: CAMPAIGN_NAME });
  await expect(hit).toHaveCount(1);
  await hit.click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/locations\/leuchtturm$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_NAME);
  // The context line points at the location list, on its own route too.
  await expect(
    page.getByRole("link", { name: ui("topbar.nav.locations") }).first(),
  ).toHaveAttribute("href", "/campaigns/beispiel/locations");
});

test("a chapter hit opens the chapter's own route, a campaign hit the chapter overview", async ({
  page,
  api,
}) => {
  // On the wire: `{ kind: "chapter", id, title }` and no `path`.
  const { results } = await api.get<{
    results: { kind: string; id: string; path?: string; title: string }[];
  }>("campaigns/beispiel/search?q=Leuchtfeuer");
  const chapter = results.find((hit) => hit.kind === "chapter");
  expect(chapter).toMatchObject({ kind: "chapter", id: "01-salzhafen" });
  expect(chapter).not.toHaveProperty("path");

  await page.goto("/campaigns/beispiel");
  await (await openPalette(page)).fill("Leuchtfeuer");
  const hit = page.getByRole("option").filter({ hasText: CHAPTER_TITLE });
  await expect(hit).toHaveCount(1);
  await hit.click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/chapters\/01-salzhafen$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CHAPTER_TITLE);
  await expect(page.getByRole("article")).toContainText("Herausfinden, warum das Leuchtfeuer");
  // The context line leads back to the chapter overview, where its scenes are.
  await expect(
    page.getByRole("navigation", { name: ui("context.aria") }).getByRole("link"),
  ).toHaveAttribute("href", "/campaigns/beispiel");
  // The topbar marks the chapters section.
  await expect(
    page.getByRole("link", { name: uiExact("topbar.nav.chapters") }),
  ).toHaveAttribute("aria-current", "page");

  // The campaign's own hit opens the campaign's route: the chapter overview.
  const campaignHits = await api.get<{ results: { kind: string; id: string }[] }>(
    "campaigns/beispiel/search?q=Kampagnenweite",
  );
  expect(campaignHits.results.find((result) => result.kind === "campaign")).toMatchObject({
    kind: "campaign",
    id: "beispiel",
  });
  await (await openPalette(page)).fill("Kampagnenweite");
  const campaignHit = page
    .getByRole("option")
    .filter({ hasText: ui("kind.campaign") })
    .filter({ hasText: CAMPAIGN_NAME });
  await expect(campaignHit).toHaveCount(1);
  await campaignHit.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_NAME);
});

test("a glossary hit opens the glossary page — no address, and none needed", async ({
  page,
  api,
}) => {
  const TERM = "smugglers' cove";

  // On the wire: the hit names its term by `kind` and `id` — the id of its
  // resource — and carries NO `path`.
  const { results } = await api.get<{
    results: { kind: string; id: string; path?: string; title: string }[];
  }>("campaigns/beispiel/search?q=smugglers");
  const glossary = results.filter((hit) => hit.kind === "glossary-term");
  expect(glossary).toHaveLength(1);
  expect(glossary[0]).toMatchObject({ id: "smugglers-cove", title: TERM });
  expect(glossary[0]).not.toHaveProperty("path");
  expect((await getGlossaryTerm(api, "smugglers-cove")).term).toBe(TERM);

  // In the palette: the term shows with the glossary's label and opens the
  // glossary page, where the terms are kept.
  await page.goto("/campaigns/beispiel");
  await (await openPalette(page)).fill("smugglers");
  const hit = page.getByRole("option").filter({ hasText: TERM });
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText(ui("kind.glossary"));
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
    // Every hit is one of the indexed entities — none is a session or an idea.
    const indexed = ["campaign", "chapter", "scene", "npc", "location", "glossary-term"];
    expect(results.filter((hit) => !indexed.includes(hit.kind))).toEqual([]);
  }
});

test("⌘K says so when nothing matches, and Esc closes it", async ({ page }) => {
  await page.goto("/campaigns/beispiel");
  const input = await openPalette(page);
  await input.fill("zzzqqq");
  await expect(page.getByText(ui("palette.empty"))).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
});
