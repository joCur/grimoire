// Critical path 2: reading a scene — callouts, If-sections, NPC cards; see
// CLAUDE.md.
//
// Checked against the two reference scenes CLAUDE.md names as the touchstones
// of the callout renderer.
//
// All six callout kinds appear: readaloud/check/secret/note in
// lighthouse-arrival, check/note/outcome in smuggler-captured — and
// [!loot], which the example campaign does not contain, through an extra
// entry this test seeds into ITS OWN copy of the fixtures.

import { readFileSync } from "node:fs";
import path from "node:path";

import { E2E_FIXTURES_DIR } from "../support/paths";
import { expect, test, type SeedEntry } from "../support/test";

/** Reads one of the suite's own entry fixtures. */
function entry(name: string): SeedEntry {
  return JSON.parse(
    readFileSync(path.join(E2E_FIXTURES_DIR, name), "utf8"),
  ) as SeedEntry;
}

/** The scene with the [!loot] callout — the example campaign has none. */
const LOOT_SCENE = entry("loot-scene.json");
/** Its address: chapter, location and the scene's id from its properties. */
const LOOT_SCENE_PATH = "01-salzhafen/leuchtturm/loot-check";

/**
 * A scene whose table CANNOT fit 390px — seven columns of long, unbreakable
 * words. The reference scene's W6 table is narrow enough to fit, so it cannot
 * prove that the box overflows instead of the page; this one can.
 */
const WIDE_TABLE_SCENE = entry("wide-table-scene.json");
const WIDE_TABLE_SCENE_PATH = "01-salzhafen/leuchtturm/wide-table";

const ARRIVAL = "/beispiel/entry/01-salzhafen/leuchtturm/lighthouse-arrival";
const CAPTURED = "/beispiel/entry/01-salzhafen/bucht/smuggler-captured";

test("reference scene 1: read-aloud, check, secret, note and the NPC card", async ({ page }) => {
  await page.goto(ARRIVAL);

  // The context line above the title: chapter › group, replacing
  // the topbar breadcrumb. The chapter links back to the pool.
  const context = page.getByRole("navigation", { name: "Kontext" });
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
  await expect(article.getByText("Geplante Szene")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  // Chip row from the properties (the scene's location, resolved to its name).
  await expect(article.getByText("Der Leuchtturm von Salzhafen", { exact: true })).toBeVisible();
  await expect(article.getByText("#social", { exact: true })).toBeVisible();
  await expect(article.getByText("Handout: Karte von Salzhafen")).toBeVisible();
  // The status display IS the control.
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Bereit" })).toBeVisible();

  // The signature element: no label row, brass ribbon, copy button on hover.
  const readaloud = page.locator("[data-callout='readaloud']");
  await expect(readaloud).toHaveCount(1);
  await expect(readaloud).toContainText("Der Turm ragt schwarz gegen den Abendhimmel auf.");
  await expect(readaloud.getByRole("button", { name: "Vorlesetext kopieren" })).toBeAttached();

  const check = page.locator("[data-callout='check']");
  await expect(check).toContainText("Probe");
  await expect(check).toContainText("Wisdom (Perception) DC 13");

  const secret = page.locator("[data-callout='secret']");
  await expect(secret).toContainText("Geheim");
  await expect(secret).toContainText("Der Leuchtturmwärter ist nicht verschwunden");

  const note = page.locator("[data-callout='note']");
  await expect(note).toContainText("Notiz");
  await expect(note).toContainText("Kontingenz");

  // NPC card of the scene: name, mono id, voice, "Will", quickstats chips.
  const aside = page.getByRole("complementary").filter({ hasText: "NPCs dieser Szene" });
  await expect(aside).toContainText("Hafenmeisterin Jorna");
  await expect(aside).toContainText("jorna");
  await expect(aside).toContainText("Stimme");
  await expect(aside).toContainText("knapp, wetterrau, duzt jeden");
  await expect(aside).toContainText("Will");
  await expect(aside).toContainText("Das Leuchtfeuer muss wieder brennen");
  await expect(aside).toContainText("insight");
  await expect(aside).toContainText("passive-perception");

  // The card links into the NPC reading view.
  await aside.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/beispiel\/entry\/npcs\/jorna$/);
});

test("reference scene 2: contingency header, collapsible If-sections, consequence", async ({
  page,
}) => {
  await page.goto(CAPTURED);

  await expect(page.getByText("Eventualszene", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Von den Schmugglern erwischt",
  );
  await expect(page.getByText("Auslöser")).toBeVisible();
  await expect(
    page.getByText("Charaktere werden beim Auskundschaften der Bucht entdeckt"),
  ).toBeVisible();

  // `## If:` sections render as branches — open by default (design reference).
  const branches = page.locator("details[data-if-section]");
  await expect(branches).toHaveCount(2);
  const first = branches.first();
  await expect(first.locator("summary")).toContainText("Falls:");
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
  await expect(outcome).toContainText("Ergebnis");
  await expect(outcome).toContainText("Fenn kennt nach dieser Szene die Gesichter der Gruppe");

  await expect(page.locator("[data-callout='note']")).toContainText(
    "Notfall-Ventil: Der gefangene Leuchtturmwärter",
  );

  // Fenn is the scene's npc.
  const aside = page.getByRole("complementary").filter({ hasText: "NPCs dieser Szene" });
  await expect(aside).toContainText("Fenn");
  await expect(aside).toContainText("leise, höflich");
});

test("a referenced NPC without information is a thin card, not a gap", async ({ page, api }) => {
  // An npc entry created and not filled in: the aside shows it like any
  // other card — the id as the name, nothing else. No "NPC-Eintrag fehlt",
  // no "Stub anlegen" detour, and the card opens the (equally thin) page.
  expect(await api.exists("npcs/holm")).toBe(false);
  await api.send("POST", "beispiel/npcs", { name: "holm" });
  await api.patchProperties("01-salzhafen/leuchtturm/lighthouse-arrival", {
    npcs: ["jorna", "holm"],
  });
  expect(await api.exists("npcs/holm")).toBe(true);

  await page.goto(ARRIVAL);
  const aside = page.getByRole("complementary").filter({ hasText: "NPCs dieser Szene" });
  await expect(aside).toContainText("holm");
  await expect(aside).not.toContainText("fehlt");
  await expect(aside.getByRole("button", { name: "Stub anlegen" })).toHaveCount(0);

  await aside.getByRole("link", { name: /holm/ }).click();
  await expect(page).toHaveURL(/\/beispiel\/entry\/npcs\/holm$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("holm");
  // And it is editable from here like every other entry.
  await expect(page.getByRole("button", { name: "Eigenschaften" })).toBeVisible();
});

test("a scene location is a REFERENCE: an Ort that exists, or a 400", async ({ page, api }) => {
  // `location` is the scene's group, so it is always an id or empty — and
  // the id has to have an entry (ADR #19).
  const scene = "01-salzhafen/bucht/smuggler-captured";
  const patchLocation = async (value: string, rev: number): Promise<Response> =>
    api.fetch("beispiel/properties", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: scene, rev, patch: { location: value } }),
    });

  // An id nothing holds: refused, and no entry appears for it.
  const before = await api.file(scene);
  const unknown = await patchLocation("nordbucht", before.rev);
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toMatchObject({
    code: "location_unknown",
    value: "nordbucht",
  });
  expect(await api.exists("locations/nordbucht")).toBe(false);

  // Free text is refused too, with the slug it would have used — the
  // README's free-text exception is gone.
  const text = await patchLocation("Der alte Hafen", before.rev);
  expect(text.status).toBe(400);
  expect(await text.json()).toMatchObject({
    code: "location_not_an_id",
    suggestion: "der-alte-hafen",
  });
  expect(await api.exists("locations/der-alte-hafen")).toBe(false);

  // With the Ort created, the patch lands and the scene MOVES with it.
  await api.send("POST", "beispiel/locations", { name: "Nordbucht" });
  await api.patchProperties(scene, { location: "nordbucht" });
  const moved = await api.file(scene);
  expect(moved.path).toBe("01-salzhafen/nordbucht/smuggler-captured");
  await page.goto(`/beispiel/entry/${moved.path}`);
  await expect(page.getByRole("article")).toContainText("Nordbucht");
});

test.describe("with a seeded loot scene", () => {
  test.use({ seed: { entries: { "scene-loot": LOOT_SCENE } } });

  test("the loot callout renders, an unknown kind degrades to a blockquote", async ({
    page,
  }) => {
    // [!loot] is missing from the reference scenes, so the sixth kind is
    // checked on a scene this test seeds into its own copy of the fixtures.
    // Its last address segment is the scene's id, like every scene address.
    await page.goto(`/beispiel/entry/${LOOT_SCENE_PATH}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Beutezug in der Räucherkammer",
    );

    const loot = page.locator("[data-callout='loot']");
    await expect(loot).toContainText("Beute");
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
    seed: { entries: { "scene-wide-table": WIDE_TABLE_SCENE } },
  });

  test("a table too wide for the phone scrolls in its own box, the page does not", async ({
    page,
  }) => {
    await page.goto(`/beispiel/entry/${WIDE_TABLE_SCENE_PATH}`);

    // Overflowing, so the box IS a named region: the tab stop and the
    // landmark only appear once there is something to scroll.
    const box = page.getByRole("region", { name: "Tabelle" });
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

    // AK 2: the PAGE never scrolls sideways.
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
