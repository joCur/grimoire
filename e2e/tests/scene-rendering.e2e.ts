// Critical path 2: reading a scene — callouts, If-sections, NPC cards; see
// CLAUDE.md.
//
// Checked against the two reference scenes CLAUDE.md names as the touchstones
// of the callout renderer.
//
// All six callout kinds appear: readaloud/check/secret/note in
// lighthouse-arrival, check/note/outcome in smuggler-captured — and
// [!loot], which examples/ does not contain, through an extra file this test
// seeds into ITS OWN campaign copy (examples/ stays untouched).

import { readFileSync } from "node:fs";
import path from "node:path";

import { FIXTURES_DIR } from "../support/paths";
import { expect, test } from "../support/test";

/** The scene with the [!loot] callout — seeded, examples/ has none. */
const LOOT_SCENE = {
  // The path segment is the scene's ID from the fixture's properties
  // (`loot-check`), like every scene path since issue #57.
  path: "01-salzhafen/hafen/loot-check",
  content: readFileSync(path.join(FIXTURES_DIR, "loot-scene.md"), "utf8"),
};

const ARRIVAL = "/beispiel/file/01-salzhafen/hafen/lighthouse-arrival";
const CAPTURED = "/beispiel/file/01-salzhafen/hafen/smuggler-captured";

test("reference scene 1: read-aloud, check, secret, note and the NPC card", async ({ page }) => {
  await page.goto(ARRIVAL);

  // The context line above the title (issue #34): chapter › group, replacing
  // the topbar breadcrumb. The chapter links back to the pool.
  const context = page.getByRole("navigation", { name: "Kontext" });
  await expect(
    context.getByRole("link", { name: "Kapitel 1: Der Leuchtturm von Salzhafen" }),
  ).toBeVisible();
  // The scene's group directory; "hafen" has no location file, so the slug
  // stands as written (no invented prettification).
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
  // The status display IS the control (issue #28).
  await expect(page.getByRole("button", { name: "Status ändern, aktuell bereit" })).toBeVisible();

  // The signature element: no label row, brass ribbon, copy button on hover.
  const readaloud = page.locator("[data-callout='readaloud']");
  await expect(readaloud).toHaveCount(1);
  await expect(readaloud).toContainText("Der Turm ragt schwarz gegen den Abendhimmel auf.");
  await expect(readaloud.getByRole("button", { name: "Vorlesetext kopieren" })).toBeAttached();

  const check = page.locator("[data-callout='check']");
  await expect(check).toContainText("Check");
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

  // The card links into the NPC reading view (issue #26).
  await aside.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/beispiel\/file\/npcs\/jorna$/);
});

test("reference scene 2: contingency header, collapsible If-sections, consequence", async ({
  page,
}) => {
  await page.goto(CAPTURED);

  await expect(page.getByText("Kontingenz", { exact: true })).toBeVisible();
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
  await expect(outcome).toContainText("Konsequenz");
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
  // Issue #70: referencing creates. Adding an unknown id to a scene's npcs
  // gives that id an EMPTY entry, and the aside shows it like any other card
  // — the id as the name, nothing else. No "NPC-Eintrag fehlt", no
  // "Stub anlegen" detour, and the card opens the (equally thin) page.
  expect(await api.exists("npcs/holm")).toBe(false);
  await api.patchProperties("01-salzhafen/hafen/lighthouse-arrival", {
    npcs: ["jorna", "holm"],
  });
  expect(await api.exists("npcs/holm")).toBe(true);

  await page.goto(ARRIVAL);
  const aside = page.getByRole("complementary").filter({ hasText: "NPCs dieser Szene" });
  await expect(aside).toContainText("holm");
  await expect(aside).not.toContainText("fehlt");
  await expect(aside.getByRole("button", { name: "Stub anlegen" })).toHaveCount(0);

  await aside.getByRole("link", { name: /holm/ }).click();
  await expect(page).toHaveURL(/\/beispiel\/file\/npcs\/holm$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("holm");
  // And it is editable from here like every other entry.
  await expect(page.getByRole("button", { name: "Eigenschaften" })).toBeVisible();
});

test("a scene location that is a slug becomes an entry; free text stays text", async ({
  page,
  api,
}) => {
  // The one ambiguous field of the format (README): an id OR a string.
  await api.patchProperties("01-salzhafen/hafen/smuggler-captured", { location: "nordbucht" });
  expect(await api.exists("locations/nordbucht")).toBe(true);

  await api.patchProperties("01-salzhafen/hafen/smuggler-captured", {
    location: "Der alte Hafen",
  });
  expect(await api.exists("locations/der-alte-hafen")).toBe(false);
  await page.goto(CAPTURED);
  await expect(page.getByRole("article")).toContainText("Der alte Hafen");
});

test.describe("with a seeded loot scene", () => {
  test.use({ seed: { files: { [LOOT_SCENE.path]: LOOT_SCENE.content } } });

  test("the loot callout renders, an unknown kind degrades to a blockquote", async ({
    page,
  }) => {
    // [!loot] is missing from the reference scenes and examples/ must not be
    // reformatted — so the sixth kind is checked on a scene this test seeds into
    // the markdown tree its own database is imported from. Its path segment is
    // the scene's ID (`beutezug`), like every scene path since issue #57.
    await page.goto(`/beispiel/file/${LOOT_SCENE.path}`);
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
