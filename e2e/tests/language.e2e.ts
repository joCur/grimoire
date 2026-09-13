// The UI language (issue #69, Scheibe 1) against the real stack.
//
// Two properties are what this spec is about, and neither can be shown by a
// unit test:
//
//   1. The switch is IMMEDIATE — no reload. Topbar, session chip and a dialog
//      all read from the same catalog, so one click changes the whole chrome
//      at once (react-query invalidation of ["settings"]).
//   2. The setting lives on the SERVER, not in the browser (quality floor: no
//      localStorage for data). So it survives a reload — and it is visible in
//      `GET /api/settings`, which is asserted separately from the UI, the way
//      the rest of the suite asserts the stored truth next to the screen.
//
// German is the suite's fixed default (playwright.config.ts sets locale
// de-DE); every other spec's text locators depend on that, which is exactly
// why this spec always switches BACK before it ends.

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";

/** The campaign switcher's trigger — the menu that carries the language. */
const switcherTrigger = (page: Page, name: RegExp) => page.getByRole("button", { name });

/** Open the switcher menu and pick a language. */
async function switchTo(page: Page, current: RegExp, language: "Deutsch" | "English") {
  await switcherTrigger(page, current).click();
  const item = page.getByRole("menuitemradio", { name: language });
  await expect(item).toBeVisible();
  await item.click();
}

test("the language switch: English and back, server-side and without a reload", async ({
  page,
  api,
}) => {
  await page.goto("/beispiel");

  // The instance has never been told a language, so it follows the browser —
  // de-DE here, which is what every other spec's locators assume.
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({ locale: null });
  await expect(page.getByRole("button", { name: /^Kampagne: / })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session starten" })).toBeVisible();

  // --- to English -----------------------------------------------------------
  await switchTo(page, /^Kampagne: /, "English");

  // The whole chrome, at once and with no navigation: the switcher's own
  // label, the nav, the search chip and the session chip.
  await expect(page.getByRole("button", { name: /^Campaign: / })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chapters" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Locations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search …" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
  // …and the German it replaced is really gone, not merely covered.
  await expect(page.getByRole("button", { name: "Session starten" })).toHaveCount(0);

  // The setting is on the SERVER — asserted at the API, not in the browser.
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({ locale: "en" });

  // A DIALOG reads from the same catalog (the create dialogs of Scheibe 1).
  await page.getByRole("button", { name: /^Campaign: / }).click();
  await page.getByRole("menuitem", { name: "Create campaign" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Create campaign");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  // The SESSION CHIP in its running state — the one label that is rebuilt
  // every second from the catalog plus `Intl`.
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);
  await expect(page.getByRole("button", { name: /Session running/ }).first()).toBeVisible();

  // --- it survives a reload, because it never was in the browser ------------
  await page.reload();
  await expect(page.getByRole("button", { name: /^Campaign: / })).toBeVisible();
  await expect(page.getByRole("button", { name: /Session running/ }).first()).toBeVisible();

  // --- and back to German ---------------------------------------------------
  await switchTo(page, /^Campaign: /, "Deutsch");
  await expect(page.getByRole("button", { name: /^Kampagne: / })).toBeVisible();
  await expect(page.getByRole("button", { name: /Session läuft/ }).first()).toBeVisible();
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({ locale: "de" });
});

test("a stored language wins over the browser's preference", async ({ page, api }) => {
  // The instance was switched to English once; a browser that asks for German
  // must still get the language the INSTANCE was told (issue #69 AK2 — the
  // browser is only the fallback for "never decided").
  await api.send("PUT", "settings", { locale: "en" });

  await page.goto("/beispiel");
  await expect(page.getByRole("button", { name: /^Campaign: / })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();

  // Cleared again -> back to following the browser, which is de-DE here.
  await api.send("PUT", "settings", { locale: null });
  await page.reload();
  await expect(page.getByRole("button", { name: /^Kampagne: / })).toBeVisible();
});
