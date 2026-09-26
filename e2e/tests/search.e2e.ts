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

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";
import { getCampaign } from "../support/campaign";
import { getChapter } from "../support/chapter";
import { getGlossaryTerm } from "../support/glossary-term";
import { getLocation } from "../support/location";
import { getNpc } from "../support/npc";
import { getScene } from "../support/scene";
import { ui } from "../support/ui";

/**
 * Press the global shortcut once the page has rendered — the listener is part
 * of the app, so a press before it is up would go nowhere.
 */
async function openPalette(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+KeyK");
}

test("⌘K finds \"leucht\" and Enter opens the hit", async ({ page, api }) => {
  // On the wire a scene hit is `{ kind: "scene", id, title }` and no `path`.
  const { results } = await api.get<{
    results: { kind: string; id: string; path?: string; title: string }[];
  }>("campaigns/beispiel/search?q=leucht");
  const sceneHit = results.find((hit) => hit.kind === "scene");
  expect(sceneHit).toMatchObject({ kind: "scene", id: "lighthouse-arrival" });
  expect(sceneHit).not.toHaveProperty("path");
  const { title } = await getScene(api, "lighthouse-arrival");

  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    (await getCampaign(api)).name,
  );

  // The global shortcut (⌘K on macOS, Ctrl-K elsewhere).
  await page.keyboard.press("ControlOrMeta+KeyK");
  const input = page.getByRole("combobox");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("placeholder", ui("palette.placeholder"));

  await input.fill("leucht");

  const options = page.getByRole("option");
  // Scene, location and the campaign entry all match "leucht".
  await expect(options.filter({ hasText: title })).toHaveCount(1);
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
  const scene = options.filter({ hasText: title });
  for (let i = 0; i < count; i++) {
    if ((await scene.getAttribute("aria-selected")) === "true") break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(scene).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/scenes\/lighthouse-arrival$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
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
  const { title } = await getScene(api, SCENE);

  // The DM writes it in the editor: edit → Markdown mode → save.
  await page.goto(`/campaigns/beispiel/scenes/${SCENE}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await page.getByRole("button", { name: ui("common.edit") }).click();
  await page.getByRole("button", { name: ui("composer.mode.markdown"), exact: true }).click();
  const textarea = page.getByRole("textbox", {
    name: ui("bodyEditor.markdown.aria", { path: title }),
  });
  const body = await textarea.inputValue();
  await textarea.fill(`${body}\nA ${WORD} lies in the kelp by the jetty.\n`);
  await page.getByRole("button", { name: ui("common.save") }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(WORD);

  // ⌘K finds it in the same breath — no reload, no watcher, no index lag.
  await page.keyboard.press("ControlOrMeta+KeyK");
  const input = page.getByRole("combobox");
  await input.fill(WORD);
  const hit = page.getByRole("option").filter({ hasText: title });
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
  const { name } = await getNpc(api, "fenn");

  await page.goto("/campaigns/beispiel");
  await openPalette(page);
  await page.getByRole("combobox").fill("Ausstieg");
  const hit = page.getByRole("option").filter({ hasText: name });
  await expect(hit).toHaveCount(1);
  await hit.click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/fenn$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  // The context line points at the npc list, on its own route too.
  await expect(
    page
      .getByRole("navigation", { name: ui("context.aria") })
      .getByRole("link", { name: ui("browse.title.npcs") }),
  ).toHaveAttribute(
    "href",
    "/campaigns/beispiel/npcs",
  );
});

test("the palette's NPC list entry opens the npc list on its own route", async ({
  page,
  api,
}) => {
  const npcs = ui("browse.title.npcs");
  await page.goto("/campaigns/beispiel");
  await openPalette(page);
  await page.getByRole("combobox").fill(npcs);
  const option = page
    .getByRole("option")
    .filter({ hasText: npcs })
    .filter({ hasText: ui("palette.kind.page") });
  await expect(option.first()).toBeVisible();
  await option.first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(npcs);
  // The list links every npc to its own route.
  const { name } = await getNpc(api, "fenn");
  await expect(page.getByRole("link", { name }).first()).toHaveAttribute(
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
  const { name } = await getLocation(api, "leuchtturm");

  await page.goto("/campaigns/beispiel");
  await openPalette(page);
  await page.getByRole("combobox").fill("Lampen");
  const hit = page.getByRole("option").filter({ hasText: name });
  await expect(hit).toHaveCount(1);
  await hit.click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/locations\/leuchtturm$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  // The context line points at the location list, on its own route too.
  await expect(
    page
      .getByRole("navigation", { name: ui("context.aria") })
      .getByRole("link", { name: ui("browse.title.locations") }),
  ).toHaveAttribute(
    "href",
    "/campaigns/beispiel/locations",
  );
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
  const { title } = await getChapter(api, "01-salzhafen");
  const { name } = await getCampaign(api);

  await page.goto("/campaigns/beispiel");
  await openPalette(page);
  await page.getByRole("combobox").fill("Leuchtfeuer");
  const hit = page.getByRole("option").filter({ hasText: title });
  await expect(hit).toHaveCount(1);
  await hit.click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/chapters\/01-salzhafen$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByRole("article")).toContainText("Herausfinden, warum das Leuchtfeuer");
  // The context line leads back to the chapter overview, where its scenes are.
  await expect(
    page.getByRole("navigation", { name: ui("context.aria") }).getByRole("link"),
  ).toHaveAttribute("href", "/campaigns/beispiel");
  // The topbar marks the chapters section.
  await expect(page.getByRole("link", { name: ui("topbar.nav.chapters"), exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // The campaign's own hit opens the campaign's route: the chapter overview.
  const campaignHits = await api.get<{ results: { kind: string; id: string }[] }>(
    "campaigns/beispiel/search?q=Kampagnenweite",
  );
  expect(campaignHits.results.find((result) => result.kind === "campaign")).toMatchObject({
    kind: "campaign",
    id: "beispiel",
  });
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill("Kampagnenweite");
  const campaignHit = page
    .getByRole("option")
    .filter({ hasText: ui("kind.campaign") })
    .filter({ hasText: name });
  await expect(campaignHit).toHaveCount(1);
  await campaignHit.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
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
  await openPalette(page);
  await page.getByRole("combobox").fill("smugglers");
  const hit = page.getByRole("option").filter({ hasText: TERM });
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText(ui("kind.glossary"));
  await hit.click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/glossary$/);
  await expect(page.getByText(TERM)).toBeVisible();
});

test("sessions and ideas are not in the index, so they never turn up", async ({ api }) => {
  // Words that appear ONLY in the example campaign's session log and in its
  // one idea. Neither list is indexed, so a query for their words finds
  // nothing.
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
  await openPalette(page);
  const input = page.getByRole("combobox");
  await input.fill("zzzqqq");
  await expect(page.getByText(ui("palette.empty"))).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
});
