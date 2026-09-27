// The random tables: import a 5etools file, roll a table, take the result as
// a log line or an idea, remove the source; see CLAUDE.md.
//
// Random tables are reference data the DM imports into the instance
// (decisions/reference-data): nothing ships, so a fresh instance has none and
// the suite imports its own small file. `Math.random` is pinned in the page so
// a roll lands on a known row.

import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";
import type { Idea } from "@grimoire/shared/idea";
import type { RandomTable, RandomTableSource } from "@grimoire/shared/random-table";
import type { Session } from "@grimoire/shared/session";

import { expect, test } from "../support/test";
import { campaignMenu, openArea } from "../support/campaign-menu";
import { getIdeas } from "../support/idea";
import { CAMPAIGN } from "../support/paths";
import {
  HARBOUR_SOURCE,
  RANDOM_TABLES_FILE,
  randomTablePath,
  randomTableSourcePath,
} from "../support/random-table";
import { getSession, sessionPath } from "../support/session";
import { ui, uiPattern } from "../support/ui";

const WEATHER = "harbourtables-harbour-weather";
const STORM = "A storm; the harbour master closes the gate.";

/** Every roll of the page lands on the top face of the die. */
async function pinTopFace(page: Page) {
  await page.addInitScript(() => {
    Math.random = () => 0.999;
  });
}

async function importSuiteFile(page: Page) {
  await page.getByTestId("random-tables-file").setInputFiles(RANDOM_TABLES_FILE);
  await expect(page.getByTestId("random-tables-import-outcome")).toHaveText(
    ui("randomTables.import.done", { titles: "Tables of Salt Harbour", count: 1 }),
  );
}

test("import a 5etools file, roll a table and keep the result as an idea", async ({
  page,
  api,
}) => {
  await pinTopFace(page);
  await page.goto(`/campaigns/${CAMPAIGN}`);
  await openArea(page, "area.randomTables");
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/random-tables$`));
  await expect(campaignMenu(page)).toHaveAccessibleName(
    uiPattern("campaignMenu.triggerInArea", { name: /.*/, area: ui("area.randomTables") }),
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("randomTables.title"));

  // A fresh instance has none: nothing ships.
  await expect(page.getByTestId("random-tables-empty")).toBeVisible();
  expect(await api.get(randomTableSourcePath())).toEqual([]);

  // The file comes in; the source without tables stays out.
  await importSuiteFile(page);
  const sources = await api.get<RandomTableSource[]>(randomTableSourcePath());
  expect(sources.map((source) => source.id)).toEqual([HARBOUR_SOURCE]);
  const source = page.getByTestId("random-table-source");
  await expect(source).toHaveCount(1);
  const credit = source.getByTestId("random-table-source-credit");
  await expect(credit).toContainText(ui("randomTables.by", { authors: "Grimoire Test Suite" }));
  await expect(credit.getByRole("link", { name: "Tables of Salt Harbour" })).toHaveAttribute(
    "href",
    "https://example.org/salt-harbour-tables",
  );

  // Unfold the source and open a table.
  await source
    .getByRole("button", { name: ui("randomTables.unfold", { title: "Tables of Salt Harbour" }) })
    .click();
  await expect(page.getByTestId("random-table-link")).toHaveText([
    /Harbour Weather\s*d6/,
    /Dockside Names/,
  ]);
  await page.getByTestId("random-table-link").first().click();
  await expect(page).toHaveURL(new RegExp(`\\?table=${WEATHER}$`));
  const card = page.getByTestId("random-table-card");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Harbour Weather");
  await expect(card).toContainText("Roll at the start of a day at sea.");

  // The roll lands on a 6: the storm, its inline tag read as plain text.
  await card.getByTestId("random-table-roll").click();
  await expect(card.getByTestId("random-table-result-value")).toHaveText("6");
  await expect(card.getByTestId("random-table-result")).toContainText(STORM);
  await card.getByRole("button", { name: ui("randomTables.showRows", { count: 3 }) }).click();
  await expect(card.locator("tr[aria-current='true']")).toContainText(STORM);

  // No session runs, so the result becomes an idea.
  const take = card.getByTestId("random-table-take");
  await expect(take).toHaveText(ui("randomTables.take.idea"));
  await take.click();
  await expect(card.getByTestId("random-table-taken")).toHaveText(ui("randomTables.take.ideaDone"));
  const ideas = await getIdeas(api);
  expect(ideas.at(-1)).toMatchObject<Partial<Idea>>({
    text: `Harbour Weather: ${STORM}`,
    done: false,
  });
});

test("with a session running, a rolled result becomes a log line", async ({ page, api }) => {
  await api.send(
    "POST",
    randomTableSourcePath(),
    JSON.parse(await readFile(RANDOM_TABLES_FILE, "utf8")),
  );
  const session = await api.send<Session>("POST", sessionPath(api), {});
  await pinTopFace(page);

  // A table without dice ranges: every row alike, the result names its columns.
  await page.goto(`/campaigns/${CAMPAIGN}/random-tables?table=harbourtables-dockside-names`);
  const card = page.getByTestId("random-table-card");
  await card.getByTestId("random-table-roll").click();
  await expect(card.getByTestId("random-table-result-value")).toHaveCount(0);
  await expect(card.getByTestId("random-table-result")).toContainText(
    "Name: Old Tobin; Trade: ferryman",
  );
  await card.getByTestId("random-table-take").click();
  await expect(card.getByTestId("random-table-taken")).toHaveText(
    ui("randomTables.take.loggedDone"),
  );

  const log = (await getSession(api, session.id)).log;
  expect(log.at(-1)).toMatchObject({ text: "Dockside Names: Name: Old Tobin; Trade: ferryman" });
});

test("⌘K finds a table and opens it on the page", async ({ page, api }) => {
  await api.send(
    "POST",
    randomTableSourcePath(),
    JSON.parse(await readFile(RANDOM_TABLES_FILE, "utf8")),
  );

  await page.goto(`/campaigns/${CAMPAIGN}`);
  await expect(
    page
      .getByRole("banner")
      .getByRole("button", { name: new RegExp(`^${uiPattern("topbar.search").source}`) }),
  ).toBeVisible();
  const input = page.getByRole("combobox");
  await expect(async () => {
    if (!(await input.isVisible())) await page.keyboard.press("ControlOrMeta+KeyK");
    await expect(input).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await input.fill("harbour weather");
  const hit = page.getByRole("option").filter({ hasText: "Harbour Weather" });
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText(ui("kind.randomTable"));
  await hit.click();

  await expect(page).toHaveURL(
    new RegExp(`/campaigns/${CAMPAIGN}/random-tables\\?table=${WEATHER}$`),
  );
  await expect(page.getByTestId("random-table-card").getByRole("heading", { level: 2 })).toHaveText(
    "Harbour Weather",
  );
  // The source holding the open table stands unfolded, the table marked.
  await expect(
    page.locator("[data-testid='random-table-link'][aria-current='true']"),
  ).toHaveAttribute("data-id", WEATHER);
});

test("a file that is no 5etools file writes nothing; removing a source asks first", async ({
  page,
  api,
}) => {
  await page.goto(`/campaigns/${CAMPAIGN}/random-tables`);
  await page.getByTestId("random-tables-file").setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ notes: ["not a table"] })),
  });
  await expect(page.getByTestId("random-tables-import-outcome")).toHaveText(
    ui("server.import_not_fivetools"),
  );
  expect(await api.get(randomTableSourcePath())).toEqual([]);

  await importSuiteFile(page);
  const source = page.getByTestId("random-table-source");
  await source.getByRole("button", { name: ui("randomTables.remove") }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText(
    ui("randomTables.removeDialog.title", { title: "Tables of Salt Harbour" }),
  );
  // Keeping it changes nothing.
  await dialog.getByRole("button", { name: ui("randomTables.removeDialog.keep") }).click();
  await expect(source).toHaveCount(1);

  await source.getByRole("button", { name: ui("randomTables.remove") }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: ui("randomTables.removeDialog.confirm") })
    .click();
  await expect(page.getByTestId("random-tables-empty")).toBeVisible();
  expect(await api.get(randomTableSourcePath())).toEqual([]);
  expect(await api.get<RandomTable[]>(randomTablePath())).toEqual([]);
});

test.describe("on the phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the campaign menu leads to the random tables, which fit the width", async ({
    page,
    api,
  }) => {
    await api.send(
      "POST",
      randomTableSourcePath(),
      JSON.parse(await readFile(RANDOM_TABLES_FILE, "utf8")),
    );
    await page.goto(`/campaigns/${CAMPAIGN}`);
    await openArea(page, "area.randomTables");
    await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/random-tables$`));
    await page.getByTestId("random-table-source").getByRole("button").first().click();
    await page.getByTestId("random-table-link").first().click();
    await page.getByTestId("random-table-roll").click();
    await expect(page.getByTestId("random-table-result")).toBeVisible();
    // No horizontal scroll at 390px.
    const overflow = await page.evaluate(() =>
      [document.documentElement, document.querySelector("main")!].map(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    );
    expect(overflow).toEqual([0, 0]);
  });
});
