// Kritischer Pfad 8: Mobil-Startfläche und Inbox-Einwurf bei 390px.
//
// Mobil ist laut UI-BRIEF Suche, Leseansicht und Inbox — genau das wird hier
// bei 390×844 (iPhone-Größe) geprüft, inklusive der Datei auf der Platte.

import { expect, test } from "../support/test";

test.use({ viewport: { width: 390, height: 844 } });

const IDEA = "Nachtmarkt im Hafen als Aufhänger #thread";

test("Mobil-Startfläche: Suche, Inbox-Einwurf, Nachschlagen-Listen", async ({ page, files }) => {
  await page.goto("/beispiel");

  // The desktop topbar is desktop chrome — below md the surface carries its
  // own wordmark instead.
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(page.getByRole("main").getByText("Grimoire", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Kampagne: Der Leuchtturm von Salzhafen"),
  ).toBeVisible();
  // The desktop pool is not rendered here.
  await expect(page.getByText("Falls es schiefgeht")).toBeHidden();

  // Lookup rows with their counts from the tree.
  const lookup = page.getByRole("navigation", { name: "Nachschlagen" });
  await expect(lookup.getByRole("link", { name: /Szenen/ })).toContainText("2 Szenen");
  await expect(lookup.getByRole("link", { name: /NPCs/ })).toContainText("2 NPCs");
  await expect(lookup.getByRole("link", { name: /Orte/ })).toContainText("1 Ort");

  // --- Inbox-Einwurf -------------------------------------------------------
  const inbox = page.getByLabel("Inbox");
  await inbox.fill(IDEA);
  await page.getByRole("button", { name: "Einwerfen" }).click();

  await expect(page.getByText("Eingeworfen.")).toBeVisible();
  await expect(inbox).toHaveValue("");
  await expect.poll(() => files.read("inbox.md")).toContain(`- ${IDEA}`);
  // Append-only: the line that was already there survives.
  await expect
    .poll(() => files.read("inbox.md"))
    .toContain("- 2026-01-10 Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug");

  // --- Suche und Leseansicht ----------------------------------------------
  await page.getByRole("button", { name: "Szenen, NPCs, Orte suchen …" }).click();
  const search = page.getByRole("combobox");
  await expect(search).toBeVisible();
  await search.fill("fenn");
  await page.getByRole("option").filter({ hasText: "Fenn" }).first().click();

  await expect(page).toHaveURL(/\/beispiel\/file\/npcs\/fenn\.md$/);
  // The mobile read view has its own way back to the start surface.
  const back = page.getByRole("link", { name: "Pool" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/beispiel$/);
  await expect(page.getByLabel("Inbox")).toBeVisible();
});

test("Mobil: die Leseansicht der Referenzszene bleibt lesbar", async ({ page }) => {
  await page.goto("/beispiel/file/01-salzhafen/hafen/ankunft-leuchtturm.md");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(page.locator("[data-callout='readaloud']")).toBeVisible();
  // The NPC cards stack below the body instead of sitting in a sticky aside.
  await expect(page.getByRole("link", { name: /Hafenmeisterin Jorna/ })).toBeVisible();

  // Nothing may scroll the page sideways at 390px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
