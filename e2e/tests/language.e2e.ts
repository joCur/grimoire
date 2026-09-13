// The UI language (issue #69) against the real stack.
//
// Three properties are what this spec is about, and none can be shown by a
// unit test:
//
//   1. The switch is REACHABLE — one gear in the topbar, on every route, and
//      on the two surfaces that have no topbar (the cold start, the mobile
//      start) inline in their footer. The campaign switcher's menu, which held
//      it in Scheibe 1, must NOT carry it any more (PO feedback on PR #83).
//   2. The switch is IMMEDIATE — no reload. Topbar, session chip and a dialog
//      all read from the same catalog, so one click changes the whole chrome
//      at once (react-query invalidation of ["settings"]).
//   3. The setting lives on the SERVER, not in the browser (quality floor: no
//      localStorage for data). So it survives a reload — and it is visible in
//      `GET /api/settings`, which is asserted separately from the UI, the way
//      the rest of the suite asserts the stored truth next to the screen.
//
// Plus the one thing the code-per-error work of this issue bought: a SERVER
// error appears in the selected language (see the last test), which is the
// property the German sentences in the server's error bodies made impossible.
//
// German is the suite's fixed default (playwright.config.ts sets locale
// de-DE); every other spec's text locators depend on that, which is exactly
// why this spec always switches BACK before it ends.

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";

/**
 * The switch, wherever it is: native radios in a group. Clicked, never
 * `.check()`ed — the input is CONTROLLED by the server setting, so its checked
 * state flips when the PUT comes back, not on the click. That is the point of
 * the control (one source of truth), and `.check()` would call it a broken
 * checkbox.
 */
const languageRadio = (page: Page, name: "Deutsch" | "English") =>
  page.getByRole("radio", { name });

/** The topbar's gear — the only settings entry on a campaign-scoped route. */
const gear = (page: Page, name: "Einstellungen" | "Settings") =>
  page.getByRole("link", { name });

/**
 * Open /settings through the gear and pick a language. Deliberately through
 * the GEAR rather than `page.goto("/settings")`: that the entry point exists
 * and is reachable is half of what this spec asserts.
 */
async function switchTo(
  page: Page,
  entry: "Einstellungen" | "Settings",
  language: "Deutsch" | "English",
) {
  await gear(page, entry).click();
  await expect(page).toHaveURL(/\/settings(\?|$)/);
  const radio = languageRadio(page, language);
  await expect(radio).toBeVisible();
  await radio.click();
}

test("the gear is the way in, and the campaign menu is not", async ({
  page,
}) => {
  await page.goto("/beispiel");
  await expect(page.getByRole("button", { name: /^Kampagne: / })).toBeVisible();

  // The menu the switch used to live in: campaigns and „Kampagne anlegen",
  // and no language row of any kind.
  await page.getByRole("button", { name: /^Kampagne: / }).click();
  await expect(
    page.getByRole("menuitem", { name: "Kampagne anlegen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitemradio", { name: "Deutsch" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitemradio", { name: "English" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The gear instead — and it is on EVERY campaign-scoped route, in the same
  // slot, because the chrome is global and stable (design/README.md).
  for (const route of [
    "/beispiel",
    "/beispiel/list/npcs",
    "/beispiel/generate",
  ]) {
    await page.goto(route);
    await expect(gear(page, "Einstellungen")).toBeVisible();
  }

  await gear(page, "Einstellungen").click();
  await expect(page).toHaveURL(/\/settings(\?|$)/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Einstellungen",
  );
  // The instance section, named by the heading that labels the radio group.
  await expect(page.getByRole("radiogroup", { name: "Sprache" })).toBeVisible();
  await expect(languageRadio(page, "Deutsch")).toBeChecked();
});

test("the language switch: English and back, server-side and without a reload", async ({
  page,
  api,
}) => {
  await page.goto("/beispiel");

  // The instance has never been told a language, so it follows the browser —
  // de-DE here, which is what every other spec's locators assume.
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({
    locale: null,
  });
  await expect(page.getByRole("button", { name: /^Kampagne: / })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Session starten" }),
  ).toBeVisible();

  // --- to English -----------------------------------------------------------
  await switchTo(page, "Einstellungen", "English");

  // The page under the switch turns over at once, with no navigation.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  await expect(
    page.getByRole("radiogroup", { name: "Language" }),
  ).toBeVisible();
  await expect(languageRadio(page, "English")).toBeChecked();
  // …and so does the chrome around it — which on `/settings` is the chrome of
  // the campaign the gear was pressed in (PO feedback on PR #83), so the
  // switcher is up there in English too.
  await expect(gear(page, "Settings")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Campaign: / })).toBeVisible();

  // The setting is on the SERVER — asserted at the API, not in the browser.
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({
    locale: "en",
  });

  // The whole chrome of a campaign route, at once: the switcher's own label,
  // the nav, the search chip and the session chip.
  await page.goto("/beispiel");
  await expect(page.getByRole("button", { name: /^Campaign: / })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chapters" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Locations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search …" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start session" }),
  ).toBeVisible();
  // …and the German it replaced is really gone, not merely covered.
  await expect(
    page.getByRole("button", { name: "Session starten" }),
  ).toHaveCount(0);

  // A DIALOG reads from the same catalog.
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
  await expect(
    page.getByRole("button", { name: /Session running/ }).first(),
  ).toBeVisible();

  // --- it survives a reload, because it never was in the browser ------------
  await page.reload();
  await expect(page.getByRole("button", { name: /^Campaign: / })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Session running/ }).first(),
  ).toBeVisible();

  // --- and back to German ---------------------------------------------------
  await page.goto("/beispiel");
  await switchTo(page, "Settings", "Deutsch");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Einstellungen",
  );
  await page.goto("/beispiel");
  await expect(page.getByRole("button", { name: /^Kampagne: / })).toBeVisible();
  // Off /live the chip is a LINK back into the session (on /live it is the
  // menu trigger) — its LABEL is what this spec is about either way.
  await expect(
    page.getByRole("link", { name: /Session läuft/ }).first(),
  ).toBeVisible();
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({
    locale: "de",
  });
});

test("a stored language wins over the browser's preference", async ({
  page,
  api,
}) => {
  // The instance was switched to English once; a browser that asks for German
  // must still get the language the INSTANCE was told (issue #69 AK2 — the
  // browser is only the fallback for "never decided").
  await api.send("PUT", "settings", { locale: "en" });

  await page.goto("/beispiel");
  await expect(page.getByRole("button", { name: /^Campaign: / })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start session" }),
  ).toBeVisible();

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

  test("a stored language is the only one ever painted", async ({
    page,
    api,
  }) => {
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
      }).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });

    await page.goto("/beispiel");
    // Wait until the chrome is really up — the window in which a flash could
    // have happened is then definitively over.
    await expect(
      page.getByRole("button", { name: /^Kampagne: / }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Session starten" }),
    ).toBeVisible();

    const painted = await page.evaluate(
      () => (window as unknown as { __painted: string[] }).__painted,
    );
    // The German did arrive…
    expect(painted).toContain("Session starten");
    // …and not one word of the browser's English ever did.
    for (const english of [
      "Start session",
      "Chapters",
      "Locations",
      "Search …",
      "Language",
    ]) {
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

  await switchTo(page, "Einstellungen", "English");
  await expect(
    page.getByRole("radiogroup", { name: "Language" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // …and it comes back from the server on a reload, like the language itself.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({
    locale: "en",
  });

  await languageRadio(page, "Deutsch").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
});

// --- a SERVER error in the selected language --------------------------------
//
// The point of the error CODES (issue #69): the server is language-free, so
// its 409 bodies carry `{ code: "slug_taken", kind, id, suggestion }` plus an
// English technical `error` text, and the APP builds the sentence. Before
// that, an English UI answered a collision in German — the one case where the
// catalog could not help, because the copy was on the other side of the wire.
//
// This drives the collision through the UI in BOTH languages, so the assertion
// is about the sentence the DM actually reads and not about a wire body.
test("a server error is read in the selected language", async ({
  page,
  api,
}) => {
  // „Jorna" slugs to `jorna`, which the example campaign already has — so this
  // is the real 409 the create dialog is built around, driven through the UI.
  const taken = "Jorna";

  // --- German (the default) -------------------------------------------------
  await page.goto("/beispiel/list/npcs");
  await page.getByRole("button", { name: "NPC anlegen" }).click();
  await page.getByLabel("Name").fill(taken);
  await page.getByRole("button", { name: "Anlegen" }).click();
  // The whole sentence, built from the code: the kind, the taken id, the free
  // proposal. Nothing here comes off the wire as prose.
  await expect(
    page.getByText('NPC „jorna" existiert schon — Vorschlag: „jorna-2"'),
  ).toBeVisible();
  // …and the 409 wrote nothing.
  expect(await api.exists("npcs/jorna-2")).toBe(false);
  await page.getByRole("button", { name: "Abbrechen" }).click();

  // --- the same collision in English ----------------------------------------
  await api.send("PUT", "settings", { locale: "en" });
  await page.goto("/beispiel/list/npcs");
  await page.getByRole("button", { name: "Create NPC" }).click();
  await page.getByLabel("Name").fill(taken);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText("NPC “jorna” already exists — suggestion: “jorna-2”"),
  ).toBeVisible();
  // The German sentence is GONE, not merely covered — this is the regression
  // the codes exist to prevent.
  await expect(page.getByText("existiert schon", { exact: false })).toHaveCount(
    0,
  );
  expect(await api.exists("npcs/jorna-2")).toBe(false);

  // Back to German for the rest of the suite.
  await api.send("PUT", "settings", { locale: null });
});

// --- which campaign /settings is about, and what is NOT a campaign ----------

test("the gear carries the campaign it was opened FROM, and has a way back", async ({
  page,
}) => {
  // The gear is campaign-independent as a ROUTE but not as a moment: the
  // page has to be about the campaign the DM was just looking at, not about
  // whichever one the "/" heuristic would guess (PO feedback on PR #83).
  await page.goto("/beispiel/list/npcs");
  await gear(page, "Einstellungen").click();
  await expect(page).toHaveURL(/\/settings\?from=beispiel$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Einstellungen",
  );
  // The way back is THAT campaign's pool. The row is mobile chrome, so the
  // claim is checked where it is on screen: a phone width.
  await page.setViewportSize({ width: 390, height: 780 });
  const back = page.getByRole("link", { name: "Pool" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/beispiel$/);
});

test("anything below /settings is not a campaign — it redirects", async ({
  page,
}) => {
  // `/:campaign/list/:kind` happily matched `campaign: "settings"` and left
  // the DM on a half-empty list page with no way out (PR #83 review).
  await page.goto("/settings/list/npcs");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Einstellungen",
  );
  await expect(page.getByRole("radiogroup", { name: "Sprache" })).toBeVisible();
  // No `?from=` survives that redirect, so the chrome falls back to the same
  // campaign "/" would open — the chrome is global, and the only instance
  // without it is one without any campaign (the cold start below).
  await expect(
    page.getByRole("button", {
      name: "Kampagne: Der Leuchtturm von Salzhafen",
    }),
  ).toBeVisible();
});

test.describe("the cold start", () => {
  // An EMPTY instance: no campaign, so the settings page has no campaign
  // section and the page itself is the least interesting thing on screen —
  // „Kampagne anlegen" is. The switch is inline in the footer so the FIRST
  // screen of a fresh installation needs no detour to change its language.
  test.use({ seed: { skip: true } });

  test("carries the switch in its footer", async ({ page, api }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Willkommen bei Grimoire",
    );
    // There is no campaign switcher at all here.
    await expect(page.getByRole("button", { name: /^Kampagne: / })).toHaveCount(
      0,
    );

    const group = page.getByRole("radiogroup", { name: "Sprache" });
    await expect(group).toBeVisible();
    await expect(languageRadio(page, "Deutsch")).toBeChecked();

    await languageRadio(page, "English").click();

    // The page it sits on switches — heading, labels and the group's own name.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Welcome to Grimoire",
    );
    await expect(
      page.getByRole("button", { name: "Create campaign" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "Language" }),
    ).toBeVisible();
    await expect(languageRadio(page, "English")).toBeChecked();
    // Stored on the server, as every switch is.
    expect(await api.get<{ locale: string | null }>("settings")).toEqual({
      locale: "en",
    });

    // And back — the suite's rest depends on German.
    await languageRadio(page, "Deutsch").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Willkommen bei Grimoire",
    );
  });

  test("and the settings page works without any campaign", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Willkommen bei Grimoire",
    );
    // The gear is on the cold start's topbar too — a fresh instance must be
    // able to reach its settings.
    await gear(page, "Einstellungen").click();
    await expect(page).toHaveURL(/\/settings(\?|$)/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Einstellungen",
    );
    await expect(
      page.getByRole("radiogroup", { name: "Sprache" }),
    ).toBeVisible();
    // No campaign section, and no heading over nothing.
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Sprache");
    // And no campaign CHROME either: `/settings` is campaign-independent, so
    // the topbar's own `matchPath` must not read "settings" as a campaign id
    // (it did, and dressed this page in a „Kampagne: settings" switcher).
    await expect(page.getByRole("button", { name: /^Kampagne: / })).toHaveCount(
      0,
    );
    await expect(page.getByRole("navigation", { name: /Kapitel/ })).toHaveCount(
      0,
    );
  });

  test("and at 390px, with a touch-sized target", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Willkommen bei Grimoire",
    );

    const english = languageRadio(page, "English");
    const box = await english.boundingBox();
    // Inside the viewport (the row wraps rather than pushing the page wide).
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await english.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Welcome to Grimoire",
    );
    await languageRadio(page, "Deutsch").click();
  });
});

test.describe("the mobile start surface", () => {
  // Below `md` this surface REPLACES the topbar, so the gear is not on screen
  // at all. The switch therefore stays INLINE in the footer rather than
  // becoming a link to /settings: the mobile job is looking things up and
  // throwing notes in (docs/UI-BRIEF.md), and the reading language is the one
  // instance setting a phone plausibly needs — the page's other (campaign)
  // sections are prep work the mobile brief excludes.
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
    await expect(
      page.getByRole("radiogroup", { name: "Language" }),
    ).toBeVisible();
    expect(await api.get<{ locale: string | null }>("settings")).toEqual({
      locale: "en",
    });

    await languageRadio(page, "Deutsch").click();
    await expect(
      page.getByRole("radiogroup", { name: "Sprache" }),
    ).toBeVisible();
  });
});
