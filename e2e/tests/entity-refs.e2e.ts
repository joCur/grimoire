// Entity references in body text — `[[slug]]`.
//
// Touches four critical paths (CLAUDE.md):
//
//   2 (reading)          the reference renders as the CURRENT display name,
//                        an unknown slug stays plain text; hover and keyboard
//                        focus show a preview of the target per kind (NPC,
//                        location, scene), Esc closes it, a dead NPC says so
//   3 (⌘K search)        the scene is findable under that display name,
//                        although its body only holds the slug
//   4 (session)          a click opens the DRAWER, it does not navigate —
//                        the whole point of resolving at render time is that
//                        the DM never leaves the running session for a name;
//                        the preview works in the scene column and the drawer
//   6 (generator)        the review renders a draft's `[[…]]` and
//                        previews a resolved one (generator.e2e.ts covers the
//                        rest of the run)
//
// Plus the aside cards: a `[[slug]]` in the excerpt they show reads as the
// name there too.
//
// The scene is SEEDED as an extra scene: it references two npcs, a location,
// a scene and a slug nothing owns.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { SceneProposal } from "@grimoire/shared/scene";
import { E2E_FIXTURES_DIR } from "../support/paths";
import { expect, test } from "../support/test";
import { getLocation, patchLocation } from "../support/location";
import { getNpc, patchNpc } from "../support/npc";
import { getScene } from "../support/scene";
import { ui } from "../support/ui";

/** The scene with the `[[…]]` references, as its fixture holds it. */
const SCENE: SceneProposal = JSON.parse(
  readFileSync(path.join(E2E_FIXTURES_DIR, "entity-refs-scene.json"), "utf8"),
) as SceneProposal;

const SCENE_URL = "/campaigns/beispiel/scenes/entity-refs";
/** The scene's title as its fixture holds it. */
const SCENE_TITLE = "Referenzen am Kai";
/** Seeded names (fixtures/beispiel) of the npc, location and scene it references. */
const JORNA = "Hafenmeisterin Jorna";
const LIGHTHOUSE = "Der Leuchtturm von Salzhafen";
const CAPTURED = "Von den Schmugglern erwischt";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The accessible name of a resolved `[[slug]]`: its kind, then its current name. */
function refName(kind: "npc" | "location" | "scene", name: string): string {
  return ui("markdown.ref.aria", { kind: ui(`kind.${kind}`), name });
}

test.use({ seed: { scenes: [SCENE] } });

test("reading view: references render as the current name, unknown ones stay text", async ({
  page,
}) => {
  await page.goto(SCENE_URL);

  // Resolved: the NPC's CURRENT name, as a link to the npc's own route
  // (decisions/resources). The fixture mentions Jorna twice (prose and read-aloud) — the
  // first one is the paragraph.
  const ref = page.getByRole("link", { name: refName("npc", JORNA), exact: true }).first();
  await expect(ref).toHaveText(JORNA);
  await expect(ref).toHaveAttribute("href", "/campaigns/beispiel/npcs/jorna");

  // The suffix stays outside the reference — "Jornas Boot" reads as German.
  await expect(page.locator(".md-body")).toContainText(`${JORNA}s Boot`);

  // The location resolves too (kind: location) — and links to the location's
  // own route (decisions/resources).
  const locationRef = page.getByRole("link", { name: refName("location", LIGHTHOUSE) }).first();
  await expect(locationRef).toBeVisible();
  await expect(locationRef).toHaveAttribute("href", "/campaigns/beispiel/locations/leuchtturm");

  // …and so does a scene — by its id, on the scene's own route (decisions/resources).
  await expect(
    page.getByRole("link", { name: refName("scene", CAPTURED) }),
  ).toHaveAttribute("href", "/campaigns/beispiel/scenes/smuggler-captured");

  // Degradation: nothing owns `niemand`, so the source stays visible — no
  // error, no warning colour, and it becomes a link the moment it exists.
  await expect(page.locator(".md-body")).toContainText("[[niemand]]");
  await expect(page.getByRole("link", { name: /niemand/ })).toHaveCount(0);

  // The reference is a real link and opens the npc's reading view.
  await ref.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/jorna$/);
  await expect(page.getByRole("heading", { level: 1, name: JORNA })).toBeVisible();
  // Its context line points at the npc list, on its own route too.
  await expect(
    page
      .getByRole("navigation", { name: ui("context.aria") })
      .getByRole("link", { name: ui("browse.title.npcs") }),
  ).toHaveAttribute("href", "/campaigns/beispiel/npcs");
});

test("code stays code, and an `## If:` summary toggles instead of navigating", async ({
  page,
}) => {
  await page.goto(SCENE_URL);

  // `` `[[jorna]]` `` is the SYNTAX, quoted: it renders literally and never
  // becomes a link — the same skip the search index applies.
  await expect(
    page.locator(".md-body code").filter({ hasText: "[[jorna]]" }).first(),
  ).toBeVisible();

  // A branch SUMMARY resolves to the name, but as plain text: the row is the
  // toggle, so a click folds the branch instead of leaving the page.
  const details = page.locator("details[data-if-section]").first();
  const summary = details.locator("summary");
  await expect(summary).toContainText(`${JORNA} gewarnt wurde`);
  await expect(summary.getByRole("link")).toHaveCount(0);
  await expect(summary.getByRole("button")).toHaveCount(0);

  await expect(details).toHaveAttribute("open", "");
  await summary.click();
  await expect(details).not.toHaveAttribute("open", "");
  await expect(page).toHaveURL(new RegExp(`${SCENE_URL}$`));
});

test("live view: a reference opens the drawer instead of leaving the session", async ({
  page,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: ui("session.start") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

  await page.getByRole("button", { name: SCENE_TITLE }).click();
  await expect(page.getByRole("heading", { level: 1, name: SCENE_TITLE })).toBeVisible();

  // In the live view the reference is a BUTTON, not a link.
  await page.getByRole("button", { name: refName("npc", JORNA), exact: true }).first().click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { level: 1, name: JORNA })).toBeVisible();
  // The way out leads to the npc's own route (decisions/resources).
  await expect(drawer.getByRole("link", { name: ui("live.drawer.open") })).toHaveAttribute(
    "href",
    "/campaigns/beispiel/npcs/jorna",
  );
  // Still in the live view, still on the same scene.
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
});

test("a changed display name reaches the prose without touching the body", async ({
  page,
  api,
}) => {
  const NEW_NAME = "Harbourmistress Jorna Saltcrest";
  await page.goto(SCENE_URL);
  await expect(
    page.getByRole("link", { name: refName("npc", JORNA), exact: true }).first(),
  ).toBeVisible();

  // The NAME changes, the body does not.
  await patchNpc(api, "jorna", { name: NEW_NAME });
  const stored = await getScene(api, SCENE.id);
  expect(stored.body).toContain("[[jorna]]");
  expect(stored.body).not.toContain(NEW_NAME);

  // The version poll refetches the tree; the prose follows by itself.
  await expect(
    page.getByRole("link", { name: refName("npc", NEW_NAME), exact: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("link", { name: refName("npc", JORNA), exact: true }),
  ).toHaveCount(0);

  // Critical path 3: the scene is findable under the NEW name, although its
  // body only ever held the slug (the server expands references when it
  // indexes — server/src/store/refs.ts).
  const found = await api.get<{ results: { id: string; kind: string }[] }>(
    `campaigns/beispiel/search?q=${encodeURIComponent("Saltcrest")}`,
  );
  expect(found.results.map((r) => `${r.kind}:${r.id}`)).toContain("scene:entity-refs");
});

// --- the hover preview ---------------------------------------------------------

test("reading view: hovering a reference previews its target, per kind", async ({ page }) => {
  await page.goto(SCENE_URL);
  const tooltip = page.getByRole("tooltip");

  // NPC: head line with kind and status, then the rows of the compact card.
  const jorna = page.getByRole("link", { name: refName("npc", JORNA), exact: true }).first();
  await jorna.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(ui("kind.npc"));
  await expect(tooltip).toContainText(ui("status.npc.alive"));
  await expect(tooltip).toContainText(JORNA);
  await expect(tooltip).toContainText("Auftraggeberin, Hafenmeisterin von Salzhafen");
  await expect(tooltip).toContainText("knapp, wetterrau, duzt jeden");
  await expect(tooltip).toContainText(
    `${ui("npcCard.will.inline")} Das Leuchtfeuer muss wieder brennen`,
  );
  await expect(tooltip).toContainText("passive-perception 12");
  // Passive: nothing in it is a link or a control.
  await expect(tooltip.getByRole("link")).toHaveCount(0);
  await expect(tooltip.getByRole("button")).toHaveCount(0);
  // The reference is described by the card while it is open.
  const tooltipId = await tooltip.getAttribute("id");
  expect(tooltipId).not.toBeNull();
  await expect(jorna).toHaveAttribute("aria-describedby", tooltipId ?? "");

  // Location: name and its `atmosphere` property, no status.
  // Only ever ONE preview is open.
  await page.getByRole("link", { name: refName("location", LIGHTHOUSE) }).first().hover();
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toContainText(ui("kind.location"));
  await expect(tooltip).toContainText(LIGHTHOUSE);
  await expect(tooltip).toContainText("Verlassen in Eile, nicht im Kampf");
  await expect(tooltip).not.toContainText(ui("status.npc.alive"));
  await expect(jorna).not.toHaveAttribute("aria-describedby", /.+/);

  // Scene: its type is its kind; trigger and location as rows.
  await page.getByRole("link", { name: refName("scene", CAPTURED) }).hover();
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toContainText(ui("sceneArticle.type.contingency"));
  await expect(tooltip).toContainText(ui("status.scene.ready"));
  await expect(tooltip).toContainText(CAPTURED);
  await expect(tooltip).toContainText(
    new RegExp(
      `${escapeRegExp(ui("sceneArticle.trigger.label"))}\\s*Charaktere werden beim Auskundschaften der Bucht entdeckt`,
    ),
  );
  await expect(tooltip).toContainText(
    new RegExp(`${escapeRegExp(ui("refPreview.scene.location"))}\\s*Die Nordbucht`),
  );

  // Leaving reference and card closes it.
  await page.getByRole("heading", { level: 1, name: SCENE_TITLE }).hover();
  await expect(tooltip).toHaveCount(0);

  // An unresolved reference is no element to hover at all, and the resolved
  // name in an `## If:` summary is text — neither previews anything.
  await expect(page.getByRole("link", { name: /niemand/ })).toHaveCount(0);
  await page.locator("details[data-if-section] summary").first().hover();
  await page.waitForTimeout(500);
  await expect(tooltip).toHaveCount(0);

  // The click is what it always was: the reading view navigates.
  await page.getByRole("link", { name: refName("npc", "Fenn") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/fenn$/);
  await expect(tooltip).toHaveCount(0);
});

test("keyboard focus previews, Esc closes, a dead npc is marked", async ({ page, api }) => {
  await patchNpc(api, "fenn", { status: "dead" });
  await page.goto(SCENE_URL);
  const tooltip = page.getByRole("tooltip");

  // Tab onto the reference: the preview follows the keyboard focus.
  await page.getByRole("link", { name: refName("location", LIGHTHOUSE) }).first().focus();
  await page.keyboard.press("Tab");
  const fenn = page.getByRole("link", { name: refName("npc", "Fenn") });
  await expect(fenn).toBeFocused();
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toContainText("Fenn");
  await expect(tooltip).toContainText("Anführer der Schmuggler in der Nordbucht");

  // The dead status in the destructive color, with the skull in front of it.
  const dead = tooltip.getByText(ui("status.npc.dead"), { exact: true });
  await expect(dead).toBeVisible();
  await expect(dead).toHaveClass(/text-destructive/);
  await expect(dead.locator("svg.lucide-skull")).toBeVisible();
  await expect(tooltip).not.toContainText(ui("status.npc.alive"));

  // Esc closes it and leaves the focus where it is. The card takes no focus.
  await expect(tooltip).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(fenn).toBeFocused();

  // Blur closes at once: Tab on to the scene reference, whose card follows.
  await fenn.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: refName("scene", CAPTURED) })).toBeFocused();
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toContainText(ui("sceneArticle.type.contingency"));
});

test("a reference inside an excerpt reads as the name — in the preview and on the cards", async ({
  page,
  api,
}) => {
  // The excerpt is the `motivation` FIELD. A `## Will` section written into
  // the body next to it is free text and shows on neither surface.
  const { motivation, body } = await getNpc(api, "jorna");
  await patchNpc(api, "jorna", {
    motivation: `[[leuchtturm]]: ${String(motivation)}`,
    body: `\n## Will\n\nBody text only, never on the card.\n${body}`,
  });
  await page.goto(SCENE_URL);

  // The scene aside's NPC card (callouts are asides too — hence the filter).
  const aside = page
    .locator("aside")
    .filter({ has: page.getByRole("heading", { name: ui("scene.npcs.heading") }) });
  await expect(aside).toContainText(`${LIGHTHOUSE}: Das Leuchtfeuer muss`);
  await expect(aside).not.toContainText("[[leuchtturm]]");
  await expect(aside).not.toContainText("Body text only");

  // The preview: the same excerpt, and the name in it is TEXT — no link, and
  // hovering it opens nothing further.
  await page.getByRole("link", { name: refName("npc", JORNA), exact: true }).first().hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText(`${LIGHTHOUSE}: Das Leuchtfeuer muss`);
  await expect(tooltip).not.toContainText("[[leuchtturm]]");
  await expect(tooltip).not.toContainText("Body text only");
  await expect(tooltip.getByRole("link")).toHaveCount(0);
});

test("a location's atmosphere is its field: a `## Atmosphäre` section does not change it", async ({
  page,
  api,
}) => {
  const { body } = await getLocation(api, "leuchtturm");
  await patchLocation(api, "leuchtturm", {
    atmosphere: "Cold, still — [[jorna]] was here last.",
    body: `\n## Atmosphäre\n\nBody text only, never in the preview.\n${body}`,
  });
  await page.goto(SCENE_URL);

  await page.getByRole("link", { name: refName("location", LIGHTHOUSE) }).first().hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText(`Cold, still — ${JORNA} was here last.`);
  await expect(tooltip).not.toContainText("Body text only");

  // Emptied, the preview falls back to the Roll20 page — the section in the
  // body still does not stand in.
  await patchLocation(api, "leuchtturm", { atmosphere: null });
  await page.reload();
  await page.getByRole("link", { name: refName("location", LIGHTHOUSE) }).first().hover();
  await expect(tooltip).toContainText(ui("locationCard.roll20", { value: "Leuchtturm" }));
  await expect(tooltip).not.toContainText("Body text only");
});

test("session view: previews in the scene column and in the drawer; the click opens the drawer", async ({
  page,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: ui("session.start") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  // Exact: until the live view has rendered, the chapter overview's reorder
  // buttons carry the scene title in their names too.
  await page.getByRole("button", { name: SCENE_TITLE, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: SCENE_TITLE })).toBeVisible();

  const tooltip = page.getByRole("tooltip");
  const column = page.locator("main .md-body");

  // Scene column: the card stays inside the text column — never over the NPC
  // aside, the log or the quick note.
  await column.getByRole("button", { name: refName("scene", CAPTURED) }).hover();
  await expect(tooltip).toContainText(CAPTURED);
  const card = await tooltip.boundingBox();
  const text = await column.boundingBox();
  const aside = await page
    .locator("aside")
    .filter({ has: page.getByRole("textbox", { name: ui("live.note.aria") }) }).boundingBox();
  expect(card).not.toBeNull();
  expect(text).not.toBeNull();
  expect(aside).not.toBeNull();
  if (card !== null && text !== null && aside !== null) {
    expect(card.x).toBeGreaterThanOrEqual(text.x);
    expect(card.x + card.width).toBeLessThanOrEqual(text.x + text.width);
    expect(card.x + card.width).toBeLessThan(aside.x);
  }

  // The click still opens the drawer (and closes the preview).
  await column.getByRole("button", { name: refName("npc", JORNA), exact: true }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { level: 1, name: JORNA })).toBeVisible();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

  // Inside the drawer: Jorna's `## Beziehungen` names Fenn.
  const fenn = drawer.getByRole("button", { name: refName("npc", "Fenn") });
  await fenn.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Anführer der Schmuggler in der Nordbucht");

  // Esc closes the preview first — the drawer stays open. Pressed once the
  // card has settled, as a person would: not in the frame it appears in.
  await expect(tooltip).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(drawer).toBeVisible();

  // And the click in the drawer switches the drawer, as before.
  await fenn.click();
  await expect(drawer.getByRole("heading", { level: 1, name: "Fenn" })).toBeVisible();
});

test("draft review: a resolved reference previews, an unresolved one stays text", async ({
  page,
}) => {
  await page.goto("/campaigns/beispiel/generate");
  await page
    .getByLabel(ui("generate.input.sourceLabel"))
    .fill("The party watches the quay at low tide while Fenn's crew shifts a cargo.");
  await page.getByRole("button", { name: ui("generate.input.submit.scene") }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("generate.review.title"), {
    timeout: 30_000,
  });

  const fenn = page.getByRole("link", { name: refName("npc", "Fenn") }).first();
  await fenn.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Fenn");
  await expect(tooltip).toContainText(ui("status.npc.alive"));
  await expect(tooltip).toContainText("Anführer der Schmuggler in der Nordbucht");

  // `[[grella]]` is only proposed in this run — no entry, no link, no preview.
  await expect(page.getByRole("link", { name: /grella/i })).toHaveCount(0);
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("no preview on a touch device — a tap navigates", async ({ page }) => {
    await page.goto(SCENE_URL);
    // The device really presents itself as touch-first.
    expect(await page.evaluate(() => matchMedia("(hover: none), (pointer: coarse)").matches)).toBe(
      true,
    );
    const jorna = page.getByRole("link", { name: refName("npc", JORNA), exact: true }).first();
    await jorna.focus();
    await page.waitForTimeout(500);
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    await jorna.tap();
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/jorna$/);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });
});
