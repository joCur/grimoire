// Critical path 2: reading a scene — callouts, If-sections, NPC cards; see
// CLAUDE.md.
//
// Checked against the two reference scenes CLAUDE.md names as the touchstones
// of the callout renderer.
//
// All six callout kinds appear: readaloud/check/secret/note in
// ankunft-leuchtturm, check/note/outcome in von-schmugglern-erwischt — and
// [!loot], which examples/ does not contain, through an extra file this test
// seeds into ITS OWN campaign copy (examples/ stays untouched).

import { readFile } from "node:fs/promises";
import path from "node:path";

import { FIXTURES_DIR } from "../support/paths";
import { expect, test } from "../support/test";

const ARRIVAL = "/beispiel/file/01-salzhafen/hafen/ankunft-leuchtturm.md";
const CAPTURED = "/beispiel/file/01-salzhafen/hafen/von-schmugglern-erwischt.md";

test("reference scene 1: read-aloud, check, secret, note and the NPC card", async ({ page }) => {
  await page.goto(ARRIVAL);

  const article = page.getByRole("article");
  await expect(article.getByText("Geplante Szene")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  // Chip row from the frontmatter (the breadcrumb carries the same name).
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
  await expect(page).toHaveURL(/\/beispiel\/file\/npcs\/jorna\.md$/);
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

test("the loot callout renders, an unknown kind degrades to a blockquote", async ({
  page,
  files,
}) => {
  // [!loot] is missing from the reference scenes and examples/ must not be
  // reformatted — so the sixth kind is checked on a file this test seeds into
  // its own campaign copy.
  const rel = "01-salzhafen/hafen/beutezug.md";
  await files.write(rel, await readFile(path.join(FIXTURES_DIR, "loot-scene.md"), "utf8"));

  await page.goto(`/beispiel/file/${rel}`);
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
