// An address that leads nowhere shows the not-found view inside the layout:
// the topbar stays, one sentence says there is nothing here, and one link
// leads back — to the campaign when the campaign is known, else to the start.
// A route the app does not know and a row the server answers 404 for are the
// same view.

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";

async function expectNotFound(page: Page, back: "Zur Kapitelübersicht" | "Zum Anfang") {
  await expect(page.getByRole("heading", { name: "Diese Seite gibt es nicht" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByText("Server nicht erreichbar")).toHaveCount(0);
  await expect(page.getByRole("link", { name: back })).toBeVisible();
}

test("an unknown route outside a campaign leads back to the start", async ({ page }) => {
  await page.goto("/foo");
  await expectNotFound(page, "Zum Anfang");
  await page.getByRole("link", { name: "Zum Anfang" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
});

test("an unknown route inside a campaign leads back to the chapter overview", async ({ page }) => {
  for (const path of ["/campaigns/beispiel/gibtsnicht", "/campaigns/beispiel/entries/npcs/jorna"]) {
    await page.goto(path);
    await expectNotFound(page, "Zur Kapitelübersicht");
  }
  await page.getByRole("link", { name: "Zur Kapitelübersicht" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
});

test("a row the server does not know is the same view, asked for only once", async ({
  page,
}) => {
  for (const kind of ["chapters", "scenes", "npcs", "locations", "sessions"]) {
    const reads: string[] = [];
    const count = (request: { url(): string }) => {
      if (request.url().endsWith(`/api/campaigns/beispiel/${kind}/gibtsnicht`)) {
        reads.push(request.url());
      }
    };
    page.on("request", count);
    await page.goto(`/campaigns/beispiel/${kind}/gibtsnicht`);
    await expectNotFound(page, "Zur Kapitelübersicht");
    // A 404 is not retried: the row is not there, asking again only delays.
    expect(reads).toHaveLength(1);
    page.off("request", count);
  }
});

test("an unknown campaign leads back to the start, not to itself", async ({ page }) => {
  await page.goto("/campaigns/gibtsnicht");
  await expectNotFound(page, "Zum Anfang");
});
