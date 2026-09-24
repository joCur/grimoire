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
//   6 (generator)        the review renders the stub draft's `[[…]]` and
//                        previews a resolved one (generator.e2e.ts covers the
//                        rest of the run)
//
// Plus the aside cards: a `[[slug]]` in the excerpt they show reads as the
// name there too.
//
// The scene is SEEDED as an extra entry: it references two npcs, a location,
// a scene and a slug nothing owns.

import { readFileSync } from "node:fs";
import path from "node:path";

import { E2E_FIXTURES_DIR } from "../support/paths";
import { expect, test, type SeedEntry } from "../support/test";

/** The scene with the `[[…]]` references, as an entry. */
const SCENE: SeedEntry = JSON.parse(
  readFileSync(path.join(E2E_FIXTURES_DIR, "entity-refs-scene.json"), "utf8"),
) as SeedEntry;

/** Its address: chapter, location and the scene's id. */
const SCENE_PATH = "01-salzhafen/leuchtturm/entity-refs";

const SCENE_URL = "/campaigns/beispiel/entries/01-salzhafen/leuchtturm/entity-refs";
const SCENE_TITLE = "Referenzen am Kai";
const JORNA = "Hafenmeisterin Jorna";

test.use({ seed: { entries: { "scene-entity-refs": SCENE } } });

test("reading view: references render as the current name, unknown ones stay text", async ({
  page,
}) => {
  await page.goto(SCENE_URL);

  // Resolved: the NPC's CURRENT name, as a link into the entity view.
  // The fixture mentions Jorna twice (prose and read-aloud) — the first one
  // is the paragraph.
  const ref = page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }).first();
  await expect(ref).toHaveText(JORNA);
  await expect(ref).toHaveAttribute("href", "/campaigns/beispiel/entries/npcs/jorna");

  // The suffix stays outside the reference — "Jornas Boot" reads as German.
  await expect(page.locator(".md-body")).toContainText(`${JORNA}s Boot`);

  // The location resolves too (kind: location) — and links to the location's
  // own route (ADR #31).
  const locationRef = page.getByRole("link", { name: "Ort: Der Leuchtturm von Salzhafen" }).first();
  await expect(locationRef).toBeVisible();
  await expect(locationRef).toHaveAttribute("href", "/campaigns/beispiel/locations/leuchtturm");

  // Degradation: nothing owns `niemand`, so the source stays visible — no
  // error, no warning colour, and it becomes a link the moment it exists.
  await expect(page.locator(".md-body")).toContainText("[[niemand]]");
  await expect(page.getByRole("link", { name: /niemand/ })).toHaveCount(0);

  // The reference is a real link and opens the entity.
  await ref.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/entries\/npcs\/jorna$/);
  await expect(page.getByRole("heading", { level: 1, name: JORNA })).toBeVisible();
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
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

  await page.getByRole("button", { name: SCENE_TITLE }).click();
  await expect(page.getByRole("heading", { level: 1, name: SCENE_TITLE })).toBeVisible();

  // In the live view the reference is a BUTTON, not a link.
  await page.getByRole("button", { name: `NPC: ${JORNA}`, exact: true }).first().click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { level: 1, name: JORNA })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Eintrag öffnen" })).toBeVisible();
  // Still in the live view, still on the same scene.
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
});

test("a changed display name reaches the prose without touching the body", async ({
  page,
  api,
}) => {
  const NEW_NAME = "Hafenmeisterin Jorna Salzhand";
  await page.goto(SCENE_URL);
  await expect(
    page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }).first(),
  ).toBeVisible();

  // The NAME changes, the body does not.
  await api.patchProperties("npcs/jorna", { name: NEW_NAME });
  const stored = await api.entry(SCENE_PATH);
  expect(stored.body).toContain("[[jorna]]");
  expect(stored.body).not.toContain(NEW_NAME);

  // The version poll refetches the tree; the prose follows by itself.
  await expect(
    page.getByRole("link", { name: `NPC: ${NEW_NAME}`, exact: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }),
  ).toHaveCount(0);

  // Critical path 3: the scene is findable under the NEW name, although its
  // body only ever held the slug (the server expands references when it
  // indexes — server/src/store/refs.ts).
  const found = await api.get<{ results: { id: string; kind: string }[] }>(
    `campaigns/beispiel/search?q=${encodeURIComponent("Salzhand")}`,
  );
  expect(found.results.map((r) => `${r.kind}:${r.id}`)).toContain("scene:entity-refs");
});

// --- the hover preview ---------------------------------------------------------

test("reading view: hovering a reference previews its target, per kind", async ({ page }) => {
  await page.goto(SCENE_URL);
  const tooltip = page.getByRole("tooltip");

  // NPC: head line with kind and status, then the rows of the compact card.
  const jorna = page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }).first();
  await jorna.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("NPC");
  await expect(tooltip).toContainText("Lebendig");
  await expect(tooltip).toContainText(JORNA);
  await expect(tooltip).toContainText("Auftraggeberin, Hafenmeisterin von Salzhafen");
  await expect(tooltip).toContainText("knapp, wetterrau, duzt jeden");
  await expect(tooltip).toContainText("Will: Das Leuchtfeuer muss wieder brennen");
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
  await page.getByRole("link", { name: "Ort: Der Leuchtturm von Salzhafen" }).first().hover();
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toContainText("Ort");
  await expect(tooltip).toContainText("Der Leuchtturm von Salzhafen");
  await expect(tooltip).toContainText("Verlassen in Eile, nicht im Kampf");
  await expect(tooltip).not.toContainText("Lebendig");
  await expect(jorna).not.toHaveAttribute("aria-describedby", /.+/);

  // Scene: its type is its kind; trigger and location as rows.
  await page.getByRole("link", { name: "Szene: Von den Schmugglern erwischt" }).hover();
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toContainText("Eventualszene");
  await expect(tooltip).toContainText("Bereit");
  await expect(tooltip).toContainText("Von den Schmugglern erwischt");
  await expect(tooltip).toContainText(
    /Auslöser\s*Charaktere werden beim Auskundschaften der Bucht entdeckt/,
  );
  await expect(tooltip).toContainText(/Ort\s*Die Nordbucht/);

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
  await page.getByRole("link", { name: "NPC: Fenn" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/entries\/npcs\/fenn$/);
  await expect(tooltip).toHaveCount(0);
});

test("keyboard focus previews, Esc closes, a dead npc is marked", async ({ page, api }) => {
  await api.patchProperties("npcs/fenn", { status: "dead" });
  await page.goto(SCENE_URL);
  const tooltip = page.getByRole("tooltip");

  // Tab onto the reference: the preview follows the keyboard focus.
  await page.getByRole("link", { name: "Ort: Der Leuchtturm von Salzhafen" }).first().focus();
  await page.keyboard.press("Tab");
  const fenn = page.getByRole("link", { name: "NPC: Fenn" });
  await expect(fenn).toBeFocused();
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toContainText("Fenn");
  await expect(tooltip).toContainText("Anführer der Schmuggler in der Nordbucht");

  // The dead status in the destructive color, with the skull in front of it.
  const dead = tooltip.getByText("Tot", { exact: true });
  await expect(dead).toBeVisible();
  await expect(dead).toHaveClass(/text-destructive/);
  await expect(dead.locator("svg.lucide-skull")).toBeVisible();
  await expect(tooltip).not.toContainText("Lebendig");

  // Esc closes it and leaves the focus where it is. The card takes no focus.
  await expect(tooltip).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(fenn).toBeFocused();

  // Blur closes at once: Tab on to the scene reference, whose card follows.
  await fenn.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Szene: Von den Schmugglern erwischt" })).toBeFocused();
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toContainText("Eventualszene");
});

test("a reference inside an excerpt reads as the name — in the preview and on the cards", async ({
  page,
  api,
}) => {
  // The excerpt is the `motivation` PROPERTY. A `## Will` section written into
  // the body next to it is free text and shows on neither surface.
  const { properties, body } = await api.entry("npcs/jorna");
  await api.patchEntry("npcs/jorna", {
    properties: {
      motivation: String(properties.motivation).replace(
        "Das Leuchtfeuer muss",
        "Das Leuchtfeuer auf [[leuchtturm]] muss",
      ),
    },
    body: `\n## Will\n\nNur im Text, nie auf der Karte.\n${body}`,
  });
  await page.goto(SCENE_URL);

  // The scene aside's NPC card (callouts are asides too — hence the filter).
  const aside = page.locator("aside").filter({ hasText: "NPCs dieser Szene" });
  await expect(aside).toContainText("Das Leuchtfeuer auf Der Leuchtturm von Salzhafen muss");
  await expect(aside).not.toContainText("[[leuchtturm]]");
  await expect(aside).not.toContainText("Nur im Text");

  // The preview: the same excerpt, and the name in it is TEXT — no link, and
  // hovering it opens nothing further.
  await page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }).first().hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Das Leuchtfeuer auf Der Leuchtturm von Salzhafen muss");
  await expect(tooltip).not.toContainText("[[leuchtturm]]");
  await expect(tooltip).not.toContainText("Nur im Text");
  await expect(tooltip.getByRole("link")).toHaveCount(0);
});

test("a location's atmosphere is its field: a `## Atmosphäre` section does not change it", async ({
  page,
  api,
}) => {
  const { body } = await api.location("leuchtturm");
  await api.patchLocation("leuchtturm", {
    atmosphere: "Kalt, still — [[jorna]] war zuletzt hier.",
    body: `\n## Atmosphäre\n\nNur im Text, nie in der Vorschau.\n${body}`,
  });
  await page.goto(SCENE_URL);

  await page.getByRole("link", { name: "Ort: Der Leuchtturm von Salzhafen" }).first().hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText(`Kalt, still — ${JORNA} war zuletzt hier.`);
  await expect(tooltip).not.toContainText("Nur im Text");

  // Emptied, the preview falls back to the Roll20 page — the section in the
  // body still does not stand in.
  await api.patchLocation("leuchtturm", { atmosphere: null });
  await page.reload();
  await page.getByRole("link", { name: "Ort: Der Leuchtturm von Salzhafen" }).first().hover();
  await expect(tooltip).toContainText("Roll20-Seite: Leuchtturm");
  await expect(tooltip).not.toContainText("Nur im Text");
});

test("session view: previews in the scene column and in the drawer; the click opens the drawer", async ({
  page,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  await page.getByRole("button", { name: SCENE_TITLE }).click();
  await expect(page.getByRole("heading", { level: 1, name: SCENE_TITLE })).toBeVisible();

  const tooltip = page.getByRole("tooltip");
  const column = page.locator("main .md-body");

  // Scene column: the card stays inside the text column — never over the NPC
  // aside, the log or the quick note.
  await column.getByRole("button", { name: "Szene: Von den Schmugglern erwischt" }).hover();
  await expect(tooltip).toContainText("Von den Schmugglern erwischt");
  const card = await tooltip.boundingBox();
  const text = await column.boundingBox();
  const aside = await page.locator("aside").filter({ hasText: "Schnellnotiz" }).boundingBox();
  expect(card).not.toBeNull();
  expect(text).not.toBeNull();
  expect(aside).not.toBeNull();
  if (card !== null && text !== null && aside !== null) {
    expect(card.x).toBeGreaterThanOrEqual(text.x);
    expect(card.x + card.width).toBeLessThanOrEqual(text.x + text.width);
    expect(card.x + card.width).toBeLessThan(aside.x);
  }

  // The click still opens the drawer (and closes the preview).
  await column.getByRole("button", { name: `NPC: ${JORNA}`, exact: true }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { level: 1, name: JORNA })).toBeVisible();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

  // Inside the drawer: Jorna's `## Beziehungen` names Fenn.
  const fenn = drawer.getByRole("button", { name: "NPC: Fenn" });
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
    .getByLabel("Quelltext (EN)")
    .fill("The party watches the quay at low tide while Fenn's crew shifts a cargo.");
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  const fenn = page.getByRole("link", { name: "NPC: Fenn" }).first();
  await fenn.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Fenn");
  await expect(tooltip).toContainText("Lebendig");
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
    const jorna = page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }).first();
    await jorna.focus();
    await page.waitForTimeout(500);
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    await jorna.tap();
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/entries\/npcs\/jorna$/);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });
});
