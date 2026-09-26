// Critical path 2: reading a scene — callouts, If-sections, NPC cards; see
// CLAUDE.md.
//
// Checked against the two reference scenes CLAUDE.md names as the touchstones
// of the callout renderer.
//
// All six callout kinds appear: readaloud/check/secret/note in
// lighthouse-arrival, check/note/outcome in smuggler-captured — and
// [!loot], which the example campaign does not contain, through an extra
// scene this test seeds into ITS OWN copy of the fixtures.
//
// A scene is its own resource (decisions/resources): its reading view is
// `/campaigns/:c/scenes/:id`, read through `GET …/scenes/:id`.
//
// UI text is found through its catalog key (decisions/testing); the example
// campaign's own content is data and is asserted as it is stored.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { SceneProposal } from "@grimoire/shared/scene";
import { E2E_FIXTURES_DIR } from "../support/paths";
import { expect, test } from "../support/test";
import { locationExists } from "../support/location";
import { createNpc, getNpc, npcExists } from "../support/npc";
import { getScene, patchScene, sceneExists, scenePath } from "../support/scene";
import { ui } from "../support/ui";

/** Reads one of the suite's own scene fixtures. */
function scene(name: string): SceneProposal {
  return JSON.parse(readFileSync(path.join(E2E_FIXTURES_DIR, name), "utf8")) as SceneProposal;
}

/** The scene with the [!loot] callout — the example campaign has none. */
const LOOT_SCENE = scene("loot-scene.json");

/**
 * A scene whose table CANNOT fit 390px — seven columns of long, unbreakable
 * words. The reference scene's W6 table is narrow enough to fit, so it cannot
 * prove that the box overflows instead of the page; this one can.
 */
const WIDE_TABLE_SCENE = scene("wide-table-scene.json");

const ARRIVAL = "/campaigns/beispiel/scenes/lighthouse-arrival";
const CAPTURED = "/campaigns/beispiel/scenes/smuggler-captured";

test("a scene is its own resource: flat on the wire, 404 at its old address", async ({ api }) => {
  // Every field of the scene flat, beside its guard — no `kind`, no `path`,
  // no `properties` map.
  const arrival = await getScene(api, "lighthouse-arrival");
  expect(arrival).toMatchObject({
    id: "lighthouse-arrival",
    title: "Ankunft am Leuchtturm",
    type: "planned",
    chapter: "01-salzhafen",
    location: "leuchtturm",
    npcs: ["jorna"],
    handouts: ["Karte von Salzhafen"],
    tags: ["social", "travel"],
    status: "ready",
  });
  expect(typeof arrival.rev).toBe("number");
  expect(arrival.body).toContain("## Flow");
  for (const key of ["kind", "path", "properties"]) expect(arrival).not.toHaveProperty(key);

  // A nested path under chapter and location names nothing: a scene is reached by its id.
  for (const address of [
    "01-salzhafen/leuchtturm/lighthouse-arrival",
    "01-salzhafen/lighthouse-arrival",
  ]) {
    expect((await api.fetch(`campaigns/beispiel/entries/${address}`)).status).toBe(404);
  }
});

test("a scene write: a stale rev is 409, an unknown field 400 naming it", async ({ api }) => {
  const before = await getScene(api, "lighthouse-arrival");
  const patch = (body: Record<string, unknown>) =>
    api.fetch(scenePath(api, "lighthouse-arrival"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const create = (body: Record<string, unknown>) =>
    api.fetch(scenePath(api), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // A second writer moves the row; the first one's rev is stale now.
  const moved = await patchScene(api, "lighthouse-arrival", { status: "played" });
  const stale = await patch({ rev: before.rev, title: "Too late" });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: "rev_conflict",
    rev: moved.rev,
    scene: { id: "lighthouse-arrival", status: "played" },
  });
  expect((await getScene(api, "lighthouse-arrival")).title).toBe("Ankunft am Leuchtturm");

  // A field a scene does not have is refused, by name — on PATCH and POST.
  const unknownPatch = await patch({ rev: moved.rev, atmosphere: "Fog" });
  expect(unknownPatch.status).toBe(400);
  expect(((await unknownPatch.json()) as { error: string }).error).toContain("atmosphere");
  const unknownCreate = await create({ title: "New", chapter: "01-salzhafen", roll20Page: "x" });
  expect(unknownCreate.status).toBe(400);
  expect(((await unknownCreate.json()) as { error: string }).error).toContain("roll20Page");
  expect(await sceneExists(api, "new")).toBe(false);
});

test("reference scene 1: read-aloud, check, secret, note and the NPC card", async ({
  page,
  api,
}) => {
  await page.goto(ARRIVAL);

  // The context line above the title: chapter › group, replacing
  // the topbar breadcrumb. The chapter links back to the chapter overview.
  const context = page.getByRole("navigation", { name: ui("context.aria") });
  await expect(
    context.getByRole("link", { name: "Kapitel 1: Der Leuchtturm von Salzhafen" }),
  ).toBeVisible();
  // The group is the scene's location, resolved to the name its entry
  // carries — no invented prettification.
  await expect(context).toContainText("hafen");
  // The chrome names the campaign exactly ONCE — in the switcher. The old
  // breadcrumb spelled it again right next to the near-identical chapter title.
  await expect(
    page.getByRole("banner").getByText(/Der Leuchtturm von Salzhafen/),
  ).toHaveCount(1);

  const article = page.getByRole("article");
  await expect(article.getByText(ui("sceneArticle.type.planned"))).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  // Chip row from the properties (the scene's location, resolved to its name).
  await expect(article.getByText("Der Leuchtturm von Salzhafen", { exact: true })).toBeVisible();
  await expect(article.getByText(ui("sceneArticle.tag", { tag: "social" }), { exact: true })).toBeVisible();
  await expect(
    article.getByText(ui("sceneArticle.handout", { handout: "Karte von Salzhafen" })),
  ).toBeVisible();
  // The status display IS the control.
  await expect(
    page.getByRole("button", {
      name: ui("status.change.aria", { current: ui("status.scene.ready") }),
    }),
  ).toBeVisible();

  // The signature element: no label row, brass ribbon, copy button on hover.
  const readaloud = page.locator("[data-callout='readaloud']");
  await expect(readaloud).toHaveCount(1);
  await expect(readaloud).toContainText("Der Turm ragt schwarz gegen den Abendhimmel auf.");
  await expect(readaloud.getByRole("button", { name: ui("markdown.readaloud.copy.aria") })).toBeAttached();

  const check = page.locator("[data-callout='check']");
  await expect(check).toContainText(ui("markdown.callout.check"));
  await expect(check).toContainText("Wisdom (Perception) DC 13");

  const secret = page.locator("[data-callout='secret']");
  await expect(secret).toContainText(ui("markdown.callout.secret"));
  await expect(secret).toContainText("Der Leuchtturmwärter ist nicht verschwunden");

  const note = page.locator("[data-callout='note']");
  await expect(note).toContainText(ui("markdown.callout.note"));
  await expect(note).toContainText("Kontingenz");

  // NPC card of the scene: name, mono id, voice, what it wants (the npc's
  // `motivation` field — the body carries no such section), quickstats
  // chips.
  const aside = page.getByRole("complementary").filter({ hasText: ui("scene.npcs.heading") });
  await expect(aside).toContainText("Hafenmeisterin Jorna");
  await expect(aside).toContainText("jorna");
  await expect(aside).toContainText(ui("npcCard.voice"));
  await expect(aside).toContainText("knapp, wetterrau, duzt jeden");
  await expect(aside).toContainText(ui("npcCard.will"));
  await expect(aside).toContainText("Das Leuchtfeuer muss wieder brennen");
  // …and it can only have come from the field: the text does not say it.
  expect((await getNpc(api, "jorna")).body).not.toContain("Das Leuchtfeuer");
  await expect(aside).toContainText("insight");
  await expect(aside).toContainText("passive-perception");

  // The card links into the NPC reading view, on the npc's own route
  // (decisions/resources).
  await aside.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/jorna$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
});

test("reference scene 2: contingency header, collapsible If-sections, consequence", async ({
  page,
}) => {
  await page.goto(CAPTURED);

  await expect(page.getByText(ui("sceneArticle.type.contingency"), { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Von den Schmugglern erwischt",
  );
  await expect(page.getByText(ui("sceneArticle.trigger.label"))).toBeVisible();
  await expect(
    page.getByText("Charaktere werden beim Auskundschaften der Bucht entdeckt"),
  ).toBeVisible();

  // `## If:` sections render as branches — open by default (design reference).
  const branches = page.locator("details[data-if-section]");
  await expect(branches).toHaveCount(2);
  const first = branches.first();
  await expect(first.locator("summary")).toContainText(ui("markdown.ifSection.prefix"));
  await expect(first.locator("summary")).toContainText(
    "sie geben zu, für Jorna zu arbeiten",
  );
  const firstBody = first.getByText("Fenn lässt sie in die alte Räucherkammer sperren", {
    exact: false,
  });
  await expect(firstBody).toBeVisible();

  // Collapsing is the DM's tool: what does not apply gets folded away.
  await first.locator("summary").click();
  await expect(firstBody).toBeHidden();
  await first.locator("summary").click();
  await expect(firstBody).toBeVisible();

  // The second branch carries a check callout, the scene end a consequence.
  await expect(branches.nth(1).locator("[data-callout='check']")).toContainText(
    "Charisma (Deception)",
  );
  const outcome = page.locator("[data-callout='outcome']");
  await expect(outcome).toContainText(ui("markdown.callout.outcome"));
  await expect(outcome).toContainText("Fenn kennt nach dieser Szene die Gesichter der Gruppe");

  await expect(page.locator("[data-callout='note']")).toContainText(
    "Notfall-Ventil: Der gefangene Leuchtturmwärter",
  );

  // Fenn is the scene's npc.
  const aside = page.getByRole("complementary").filter({ hasText: ui("scene.npcs.heading") });
  await expect(aside).toContainText("Fenn");
  await expect(aside).toContainText("leise, höflich");
});

test("a referenced NPC without information is a thin card, not a gap", async ({ page, api }) => {
  // An npc created and not filled in: the aside shows it like any other
  // card — the id as the name, nothing else, no warning and no detour — and
  // the card opens the (equally thin) page.
  expect(await npcExists(api, "holm")).toBe(false);
  await createNpc(api, { name: "holm" });
  await patchScene(api, "lighthouse-arrival", { npcs: ["jorna", "holm"] });
  expect(await npcExists(api, "holm")).toBe(true);

  await page.goto(ARRIVAL);
  const aside = page.getByRole("complementary").filter({ hasText: ui("scene.npcs.heading") });
  await expect(aside).toContainText("holm");

  await aside.getByRole("link", { name: /holm/ }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/holm$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("holm");
  // And it is editable from here like every other npc.
  await expect(page.getByRole("button", { name: ui("common.edit"), exact: true })).toBeVisible();
});

test("a scene location is a REFERENCE: a location that exists, or a 400", async ({ page, api }) => {
  // `location` is always an id or absent — and the id has to name a location
  // that exists (decisions/constraints).
  const patchLocation = async (value: string, rev: number): Promise<Response> =>
    api.fetch(scenePath(api, "smuggler-captured"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev, location: value }),
    });

  // An id nothing holds: refused, and no location appears for it.
  const before = await getScene(api, "smuggler-captured");
  const unknown = await patchLocation("north-cove", before.rev);
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toMatchObject({
    code: "location_unknown",
    value: "north-cove",
  });
  expect(await locationExists(api, "north-cove")).toBe(false);

  // Free text is refused too, with the slug it would have used — the
  // README's free-text exception is gone.
  const text = await patchLocation("The old harbour", before.rev);
  expect(text.status).toBe(400);
  expect(await text.json()).toMatchObject({
    code: "location_not_an_id",
    suggestion: "the-old-harbour",
  });
  expect(await locationExists(api, "the-old-harbour")).toBe(false);

  // With the location created, the patch lands — and the scene stays at its
  // own route, whatever its location says.
  await api.send("POST", "campaigns/beispiel/locations", { name: "North Cove" });
  await patchScene(api, "smuggler-captured", { location: "north-cove" });
  expect((await getScene(api, "smuggler-captured")).location).toBe("north-cove");
  await page.goto(CAPTURED);
  await expect(page.getByRole("article")).toContainText("North Cove");
});

test.describe("with a seeded loot scene", () => {
  test.use({ seed: { scenes: [LOOT_SCENE] } });

  test("the loot callout renders, an unknown kind degrades to a blockquote", async ({
    page,
  }) => {
    // [!loot] is missing from the reference scenes, so the sixth kind is
    // checked on a scene this test seeds into its own copy of the fixtures.
    await page.goto(`/campaigns/beispiel/scenes/${LOOT_SCENE.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Beutezug in der Räucherkammer",
    );

    const loot = page.locator("[data-callout='loot']");
    await expect(loot).toContainText(ui("markdown.callout.loot"));
    await expect(loot).toContainText("Zwei Ballen Schmuggeltabak");

    // Unknown kinds stay a plain blockquote — the format degrades, never errors.
    await expect(page.locator("[data-callout='erfunden']")).toHaveCount(0);
    await expect(page.locator("blockquote")).toContainText("[!erfunden] Unbekannte Callout-Sorte");
  });
});

// The table is part of the same critical path — the reference
// scene carries a W6 table inside its `[!note]`, so path 2 checks it where
// the DM meets it.
test("the reference scene's W6 table renders as a table inside the note callout", async ({
  page,
}) => {
  await page.goto(ARRIVAL);

  const table = page.locator("[data-callout='note'] table");
  await expect(table).toHaveCount(1);
  // Header row distinguished, and the rows are rows — not a wall of pipes.
  await expect(table.locator("thead th").first()).toHaveText("W6");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table).toContainText("Eine Laterne, das Glas rußgeschwärzt");
  // No pipe survived into the rendered text.
  await expect(page.getByRole("article")).not.toContainText("| --- |");
});

test.describe("the table at 390px", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    seed: { scenes: [WIDE_TABLE_SCENE] },
  });

  test("a table too wide for the phone scrolls in its own box, the page does not", async ({
    page,
  }) => {
    await page.goto(`/campaigns/beispiel/scenes/${WIDE_TABLE_SCENE.id}`);

    // Overflowing, so the box IS a named region: the tab stop and the
    // landmark only appear once there is something to scroll.
    const box = page.getByRole("region", { name: ui("markdown.table.aria") });
    await expect(box.locator("table")).toBeVisible();
    const measured = await box.evaluate((node) => ({
      overflowX: getComputedStyle(node).overflowX,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      tabIndex: node.tabIndex,
    }));
    expect(measured.overflowX).toBe("auto");
    // Strictly wider than the box — the content really does not fit.
    expect(measured.scrollWidth).toBeGreaterThan(measured.clientWidth);
    expect(measured.tabIndex).toBe(0);

    // And it actually scrolls, rather than merely being allowed to.
    await box.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    expect(await box.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

    // The PAGE never scrolls sideways.
    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);
  });

  test("the narrow reference table is not a tab stop — nothing to scroll", async ({ page }) => {
    await page.goto(ARRIVAL);

    const table = page.locator("[data-callout='note'] table");
    await expect(table).toBeVisible();
    const measured = await table.evaluate((node) => {
      const box = node.parentElement as HTMLElement;
      return {
        fits: box.scrollWidth <= box.clientWidth,
        tabIndex: box.tabIndex,
        role: box.getAttribute("role"),
      };
    });
    expect(measured.fits).toBe(true);
    expect(measured.tabIndex).toBe(-1);
    expect(measured.role).toBeNull();
  });
});
