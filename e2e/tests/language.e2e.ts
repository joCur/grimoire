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

// --- the first paint -------------------------------------------------------
//
// `GET /api/settings` is one local round trip, but for its duration the app
// used to render `navigator.language`: an instance set to German showed an
// ENGLISH chrome for a frame and then swapped it. This asserts the absence of
// that frame, which no screenshot and no `toBeVisible` can do — so the browser
// records every text node it is ever asked to paint, and the spec checks that
// none of them was English.
test.describe("no language flash", () => {
  // The interesting combination: the instance says German, the BROWSER asks
  // for English. Without the gate the English catalog wins the first paint.
  test.use({ locale: "en-US" });

  test("a stored language is the only one ever painted", async ({ page, api }) => {
    await api.send("PUT", "settings", { locale: "de" });

    // Every text node that reaches the document, from the very first one.
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __painted: string[] }).__painted = seen;
      const collect = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.nodeValue?.trim();
          if (text !== undefined && text !== "") seen.push(text);
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let current = walker.nextNode();
        while (current !== null) {
          const text = current.nodeValue?.trim();
          if (text !== undefined && text !== "") seen.push(text);
          current = walker.nextNode();
        }
      };
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "characterData") collect(record.target);
          for (const added of record.addedNodes) collect(added);
        }
        // `document`, not `document.documentElement`: this runs at document
        // START, where the latter may not exist yet — and the document node
        // sees its own children appear.
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });

    await page.goto("/beispiel");
    // Wait until the chrome is really up — the window in which a flash could
    // have happened is then definitively over.
    await expect(page.getByRole("button", { name: /^Kampagne: / })).toBeVisible();
    await expect(page.getByRole("button", { name: "Session starten" })).toBeVisible();

    const painted = await page.evaluate(
      () => (window as unknown as { __painted: string[] }).__painted,
    );
    // The German did arrive…
    expect(painted).toContain("Session starten");
    // …and not one word of the browser's English ever did.
    for (const english of ["Start session", "Chapters", "Locations", "Search …", "Language"]) {
      expect(painted).not.toContain(english);
    }
    // Belt and braces: not even a stray „Campaign: " prefix.
    expect(painted.filter((text) => text.startsWith("Campaign:"))).toEqual([]);
  });
});

// --- <html lang> -----------------------------------------------------------
//
// `index.html` can only carry a static value, so the provider sets it. A wrong
// `lang` mis-pronounces the whole page in a screen reader and mis-hyphenates
// it in the browser — it is not cosmetic.
test("<html lang> follows the UI language", async ({ page, api }) => {
  await page.goto("/beispiel");
  await expect(page.getByRole("button", { name: /^Kampagne: / })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");

  await switchTo(page, /^Kampagne: /, "English");
  await expect(page.getByRole("button", { name: /^Campaign: / })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // …and it comes back from the server on a reload, like the language itself.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({ locale: "en" });

  await switchTo(page, /^Campaign: /, "Deutsch");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
});

// --- the switch is reachable where there is no campaign switcher -----------

/**
 * The standalone switch (components/LanguageSwitch.tsx) — native radios.
 *
 * Clicked, never `.check()`ed: the input is CONTROLLED by the server setting,
 * so its checked state flips when the PUT comes back, not on the click. That
 * is the point of the control (one source of truth), and `.check()` would call
 * it a broken checkbox.
 */
const languageRadio = (page: Page, name: "Deutsch" | "English") =>
  page.getByRole("radio", { name });

test.describe("the cold start", () => {
  // An EMPTY instance: no campaign, therefore no topbar switcher — this is the
  // first screen of a fresh installation, and it used to be the one screen
  // whose language could not be changed at all.
  test.use({ seed: { skip: true } });

  test("carries the switch in its footer", async ({ page, api }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Willkommen bei Grimoire");
    // There is no campaign switcher to hide it in.
    await expect(page.getByRole("button", { name: /^Kampagne: / })).toHaveCount(0);

    // Radio semantics, like the menu version: one group, one current value.
    const group = page.getByRole("radiogroup", { name: "Sprache" });
    await expect(group).toBeVisible();
    await expect(languageRadio(page, "Deutsch")).toBeChecked();

    await languageRadio(page, "English").click();

    // The page it sits on switches — heading, labels and the group's own name.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome to Grimoire");
    await expect(page.getByRole("button", { name: "Create campaign" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Language" })).toBeVisible();
    await expect(languageRadio(page, "English")).toBeChecked();
    // Stored on the server, as every switch is.
    expect(await api.get<{ locale: string | null }>("settings")).toEqual({ locale: "en" });

    // And back — the suite's rest depends on German.
    await languageRadio(page, "Deutsch").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Willkommen bei Grimoire");
  });

  test("and at 390px, with a touch-sized target", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Willkommen bei Grimoire");

    const english = languageRadio(page, "English");
    const box = await english.boundingBox();
    // Inside the viewport (the row wraps rather than pushing the page wide).
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await english.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome to Grimoire");
    await languageRadio(page, "Deutsch").click();
  });
});

test.describe("the mobile start surface", () => {
  // Below `md` this surface REPLACES the topbar, so the campaign switcher's
  // menu — the switch's usual home — is not on screen at all.
  test.use({ viewport: { width: 390, height: 844 } });

  test("carries the switch at the end of its rows", async ({ page, api }) => {
    await page.goto("/beispiel");
    await expect(page.getByRole("banner")).toBeHidden();

    const group = page.getByRole("radiogroup", { name: "Sprache" });
    // It is the LAST thing on the surface, below „Nachschlagen" — a footer,
    // not a setting to deal with before starting.
    await group.scrollIntoViewIfNeeded();
    await expect(group).toBeVisible();
    await expect(languageRadio(page, "Deutsch")).toBeChecked();

    await languageRadio(page, "English").click();
    await expect(page.getByRole("radiogroup", { name: "Language" })).toBeVisible();
    expect(await api.get<{ locale: string | null }>("settings")).toEqual({ locale: "en" });

    await languageRadio(page, "Deutsch").click();
    await expect(page.getByRole("radiogroup", { name: "Sprache" })).toBeVisible();
  });
});
