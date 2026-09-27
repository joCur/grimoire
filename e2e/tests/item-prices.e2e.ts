// The item prices: open the price page from the campaign menu, search an
// item, filter by list, sort by price; see CLAUDE.md.
//
// Item prices are reference data of the instance (decisions/reference-data):
// the migration writes them, so the example campaign seeds none and the page
// has them all the same. The page names its source, and every item does.

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";
import { campaignMenu, openArea } from "../support/campaign-menu";
import { CAMPAIGN } from "../support/paths";
import { ui, uiPattern } from "../support/ui";

const rows = (page: Page) => page.getByTestId("item-price-row");

/** The ids of the rows on screen, in their order. */
const rowIds = (page: Page) =>
  rows(page).evaluateAll((items) => items.map((item) => item.getAttribute("data-id")));

/** The prices of the rows on screen, in their order. */
const rowPrices = (page: Page) =>
  page
    .getByTestId("item-price-value")
    .evaluateAll((values) => values.map((value) => Number(value.getAttribute("data-gp"))));

/** A toggle of the list filter or the order, by its value. */
const toggle = (page: Page, group: "item-prices-lists" | "item-prices-sort", value: string) =>
  page.getByTestId(group).locator(`button[data-value='${value}']`);

test("the campaign menu opens the prices, which search, filter by list and sort by price", async ({
  page,
}) => {
  await page.goto(`/campaigns/${CAMPAIGN}`);
  await openArea(page, "area.itemPrices");
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/item-prices$`));
  await expect(campaignMenu(page)).toHaveAccessibleName(
    uiPattern("campaignMenu.triggerInArea", { name: /.*/, area: ui("area.itemPrices") }),
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("itemPrices.title"));

  // The whole guide, sorted by name; the source is named with its link.
  await expect(rows(page)).toHaveCount(307);
  const source = page.getByTestId("item-prices-source").getByRole("link");
  await expect(source).toHaveAttribute("href", /giantitp\.com/);
  await expect(rows(page).first()).toContainText("Saidoro");

  // Search: every word of the name, in any order.
  await page.getByTestId("item-prices-search").fill("healing potion");
  await expect.poll(() => rowIds(page)).toEqual([
    "potion-of-greater-healing",
    "potion-of-healing",
    "potion-of-superior-healing",
    "potion-of-supreme-healing",
  ]);

  // Sorting by price puts the cheapest first.
  await toggle(page, "item-prices-sort", "price").click();
  await expect(toggle(page, "item-prices-sort", "price")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await rowIds(page))[0]).toBe("potion-of-healing");
  const prices = await rowPrices(page);
  expect(prices).toEqual([...prices].sort((a, b) => a - b));

  // A list keeps only its items; a search that matches none of them says so.
  await page.getByTestId("item-prices-search").fill("");
  await toggle(page, "item-prices-lists", "summoning").click();
  await expect(rows(page)).toHaveCount(16);
  const lists = await rows(page).evaluateAll((items) => items.map((item) => item.getAttribute("data-list")));
  expect(new Set(lists)).toEqual(new Set(["summoning"]));
  await page.getByTestId("item-prices-search").fill("potion");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText(ui("itemPrices.noMatch"))).toBeVisible();
});

test.describe("on the phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the campaign menu leads to the prices, which fit the width", async ({ page }) => {
    await page.goto(`/campaigns/${CAMPAIGN}`);
    await openArea(page, "area.itemPrices");
    await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/item-prices$`));
    await expect(rows(page).first()).toBeVisible();
    // No horizontal scroll at 390px.
    const overflow = await page.evaluate(() =>
      [document.documentElement, document.querySelector("main")!].map(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    );
    expect(overflow).toEqual([0, 0]);
  });
});
