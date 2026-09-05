// Critical path 8: the mobile start surface and the inbox capture at 390px;
// see CLAUDE.md.
//
// Mobile is search, reading view and inbox (UI-BRIEF) — exactly that, checked
// at 390×844 (iPhone size), including the file on disk.

import { expect, test } from "../support/test";

test.use({ viewport: { width: 390, height: 844 } });

const IDEA = "Nachtmarkt im Hafen als Aufhänger #thread";

test("mobile start surface: search, inbox capture, lookup lists", async ({ page, files }) => {
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

  // --- inbox capture -------------------------------------------------------
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

  // --- search and reading view ---------------------------------------------
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

// Issue #40 AK2: a running session must be visible on EVERY route, mobile
// included — where the topbar is not the chrome, the indicator is its own row.
test("mobile: a running session shows its own live row with the way back", async ({
  page,
  files,
}) => {
  // A session that started YESTERDAY and was never ended — the case the
  // client could not see before (it derived today's file name itself).
  const yesterday = new Date(Date.now() - 24 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const id = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
  await files.write(
    `sessions/${id}.md`,
    `---\nid: ${id}\nstarted: ${id}T22:30\nscenes_played: []\n---\n\n## Log\n`,
  );

  await page.goto("/beispiel");
  // The same chip the desktop topbar carries (PO feedback on issue #40) — in
  // link mode, in the mobile row: one tap back into the session.
  const row = page.getByRole("link", { name: /Session läuft/ });
  await expect(row).toBeVisible();
  // The runtime is computed from the SERVER's reading of `started`, so it is
  // a real elapsed time (well over an hour by now), not 0:00:00.
  await expect(row).toContainText(/\d+:\d{2}:\d{2}/);
  await row.click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);
});

test("mobile: the reference scene's reading view stays readable", async ({ page }) => {
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
