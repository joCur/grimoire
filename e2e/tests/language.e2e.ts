// The UI language against the real stack.
//
// Three properties are what this spec is about, and none can be shown by a
// unit test:
//
//   1. The switch is REACHABLE — one gear in the topbar, on every route, and
//      on the two surfaces that have no topbar (the cold start, the mobile
//      start) inline in their footer. The campaign switcher's menu does NOT
//      carry it.
//   2. The switch is IMMEDIATE — no reload. Topbar, session chip and a dialog
//      all read from the same catalog, so one click changes the whole chrome
//      at once (react-query invalidation of ["settings"]).
//   3. The setting lives on the SERVER, not in the browser (quality floor: no
//      localStorage for data). So it survives a reload — and it is visible in
//      `GET /api/settings`, which is asserted separately from the UI, the way
//      the rest of the suite asserts the stored truth next to the screen.
//
// Plus what the per-error codes buy: a SERVER error appears in the selected
// language (see the last test) — the property German sentences in the server's
// error bodies would make impossible.
//
// German is the suite's fixed default (playwright.config.ts sets locale
// de-DE); every other spec's catalog lookups (`ui()`) read the German
// catalog, which is exactly why this spec always switches BACK before it
// ends. Every text here comes from the catalog of the language the UI is in
// at that moment (`uiIn`), so the spec says which language it expects.

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";
import { npcExists } from "../support/npc";
import { uiIn } from "../support/ui";
import type { Locale } from "../../app/src/i18n/messages";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The switch, wherever it is: native radios in a group. Clicked, never
 * `.check()`ed — the input is CONTROLLED by the server setting, so its checked
 * state flips when the PUT comes back, not on the click. That is the point of
 * the control (one source of truth), and `.check()` would call it a broken
 * checkbox. `shownIn` is the language the UI is in; `language` the one the
 * radio stands for.
 */
const languageRadio = (page: Page, shownIn: Locale, language: Locale) =>
  page.getByRole("radio", {
    name: uiIn(shownIn, language === "de" ? "language.de" : "language.en"),
  });

/** The topbar's gear — the only settings entry on a campaign-scoped route. */
const gear = (page: Page, shownIn: Locale) =>
  page.getByRole("link", { name: uiIn(shownIn, "settings.title") });

/** The campaign switcher, whichever campaign it names. */
const switcher = (page: Page, shownIn: Locale) =>
  page.getByRole("button", { name: switcherName(shownIn) });

/** The accessible name of the campaign switcher, up to the campaign's name. */
function switcherPrefix(shownIn: Locale): string {
  const marker = "\u0000";
  return uiIn(shownIn, "campaign.switcher.current", { name: marker }).split(marker)[0]!;
}

function switcherName(shownIn: Locale): RegExp {
  return new RegExp(`^${escapeRegExp(switcherPrefix(shownIn))}`);
}

/** The session chip's running label, in whatever form the chip wraps it. */
function sessionRunning(shownIn: Locale): RegExp {
  return new RegExp(escapeRegExp(uiIn(shownIn, "session.state.running")));
}

/**
 * Open /settings through the gear and pick a language. Deliberately through
 * the GEAR rather than `page.goto("/settings")`: that the entry point exists
 * and is reachable is half of what this spec asserts.
 */
async function switchTo(page: Page, shownIn: Locale, language: Locale) {
  await gear(page, shownIn).click();
  await expect(page).toHaveURL(/\/settings(\?|$)/);
  const radio = languageRadio(page, shownIn, language);
  await expect(radio).toBeVisible();
  await radio.click();
}

test("the gear is the way in, and the campaign menu is not", async ({
  page,
}) => {
  await page.goto("/campaigns/beispiel");
  await expect(switcher(page, "de")).toBeVisible();

  // What the menu holds: the campaigns and the create-campaign item, and no
  // language row of any kind.
  await switcher(page, "de").click();
  await expect(
    page.getByRole("menuitem", { name: uiIn("de", "create.campaign.title") }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitemradio", { name: uiIn("de", "language.de") }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitemradio", { name: uiIn("de", "language.en") }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The gear instead — and it is on EVERY campaign-scoped route, in the same
  // slot, because the chrome is global and stable (design/README.md).
  for (const route of [
    "/campaigns/beispiel",
    "/campaigns/beispiel/npcs",
    "/campaigns/beispiel/generate",
  ]) {
    await page.goto(route);
    await expect(gear(page, "de")).toBeVisible();
  }

  await gear(page, "de").click();
  await expect(page).toHaveURL(/\/settings(\?|$)/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    uiIn("de", "settings.title"),
  );
  // The instance section, named by the heading that labels the radio group.
  await expect(
    page.getByRole("radiogroup", { name: uiIn("de", "settings.language.heading") }),
  ).toBeVisible();
  await expect(languageRadio(page, "de", "de")).toBeChecked();
});

test("the language switch: English and back, server-side and without a reload", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");

  // The instance has never been told a language, so it follows the browser —
  // de-DE here, which is what every other spec's locators assume.
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({
    locale: null,
  });
  await expect(switcher(page, "de")).toBeVisible();
  await expect(
    page.getByRole("button", { name: uiIn("de", "session.start") }),
  ).toBeVisible();

  // --- to English -----------------------------------------------------------
  await switchTo(page, "de", "en");

  // The page under the switch turns over at once, with no navigation.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    uiIn("en", "settings.title"),
  );
  await expect(
    page.getByRole("radiogroup", { name: uiIn("en", "settings.language.heading") }),
  ).toBeVisible();
  await expect(languageRadio(page, "en", "en")).toBeChecked();
  // …and so does the chrome around it — which on `/settings` is the chrome of
  // the campaign the gear was pressed in, so the switcher is up there in
  // English too.
  await expect(gear(page, "en")).toBeVisible();
  await expect(switcher(page, "en")).toBeVisible();

  // The setting is on the SERVER — asserted at the API, not in the browser.
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({
    locale: "en",
  });

  // The whole chrome of a campaign route, at once: the switcher's own label,
  // the nav, the search chip and the session chip.
  await page.goto("/campaigns/beispiel");
  await expect(switcher(page, "en")).toBeVisible();
  // The topbar's own trio — scoped, because the chapter overview's lookup
  // line links to two of the same pages with the same words.
  const trio = page.getByRole("navigation", { name: uiIn("en", "topbar.nav.aria") });
  await expect(trio.getByRole("link", { name: uiIn("en", "topbar.nav.chapters") })).toBeVisible();
  await expect(trio.getByRole("link", { name: uiIn("en", "topbar.nav.locations") })).toBeVisible();
  // And the line under the campaign header is translated along with it.
  await expect(
    page.getByRole("navigation", { name: uiIn("en", "lookup.heading") }).getByRole("link"),
  ).toHaveText([
    uiIn("en", "browse.title.npcs"),
    uiIn("en", "browse.title.locations"),
    uiIn("en", "glossary.title"),
    uiIn("en", "knowledge.title"),
  ]);
  await expect(page.getByRole("button", { name: uiIn("en", "topbar.search") })).toBeVisible();
  await expect(
    page.getByRole("button", { name: uiIn("en", "session.start") }),
  ).toBeVisible();
  // …and the German it replaced is really gone, not merely covered.
  await expect(
    page.getByRole("button", { name: uiIn("de", "session.start") }),
  ).toHaveCount(0);

  // A DIALOG reads from the same catalog.
  await switcher(page, "en").click();
  await page.getByRole("menuitem", { name: uiIn("en", "create.campaign.title") }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(uiIn("en", "create.campaign.title"));
  await expect(dialog.getByRole("button", { name: uiIn("en", "common.cancel") })).toBeVisible();
  await dialog.getByRole("button", { name: uiIn("en", "common.cancel") }).click();
  await expect(dialog).toHaveCount(0);

  // The SESSION CHIP in its running state — the one label that is rebuilt
  // every second from the catalog plus `Intl`.
  await page.getByRole("button", { name: uiIn("en", "session.start") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  await expect(
    page.getByRole("button", { name: sessionRunning("en") }).first(),
  ).toBeVisible();

  // --- it survives a reload, because it never was in the browser ------------
  await page.reload();
  await expect(switcher(page, "en")).toBeVisible();
  await expect(
    page.getByRole("button", { name: sessionRunning("en") }).first(),
  ).toBeVisible();

  // --- and back to German ---------------------------------------------------
  await page.goto("/campaigns/beispiel");
  await switchTo(page, "en", "de");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    uiIn("de", "settings.title"),
  );
  await page.goto("/campaigns/beispiel");
  await expect(switcher(page, "de")).toBeVisible();
  // Off /live the chip is a LINK back into the session (on /live it is the
  // menu trigger) — its LABEL is what this spec is about either way.
  await expect(
    page.getByRole("link", { name: sessionRunning("de") }).first(),
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
  // must still get the language the INSTANCE was told — the browser is only
  // the fallback for "never decided".
  await api.send("PUT", "settings", { locale: "en" });

  await page.goto("/campaigns/beispiel");
  await expect(switcher(page, "en")).toBeVisible();
  await expect(
    page.getByRole("button", { name: uiIn("en", "session.start") }),
  ).toBeVisible();

  // Cleared again -> back to following the browser, which is de-DE here.
  await api.send("PUT", "settings", { locale: null });
  await page.reload();
  await expect(switcher(page, "de")).toBeVisible();
});

// --- the first paint -------------------------------------------------------
//
// `GET /api/settings` is one local round trip, and rendering
// `navigator.language` for its duration would give an instance set to German
// an ENGLISH chrome for a frame and then swap it. This asserts the absence of
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

    // Every text node that reaches the DOM, from the very first one.
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
        // `document`, not `document.documentElement`: this runs at
        // document-start, where the latter may not exist yet — and the
        // `document` node sees its own children appear.
      }).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });

    await page.goto("/campaigns/beispiel");
    // Wait until the chrome is really up — the window in which a flash could
    // have happened is then definitively over.
    await expect(switcher(page, "de")).toBeVisible();
    await expect(
      page.getByRole("button", { name: uiIn("de", "session.start") }),
    ).toBeVisible();

    const painted = await page.evaluate(
      () => (window as unknown as { __painted: string[] }).__painted,
    );
    // The German did arrive…
    expect(painted).toContain(uiIn("de", "session.start"));
    // …and not one word of the browser's English ever did.
    for (const english of [
      uiIn("en", "session.start"),
      uiIn("en", "topbar.nav.chapters"),
      uiIn("en", "topbar.nav.locations"),
      uiIn("en", "topbar.search"),
      uiIn("en", "language.heading"),
    ]) {
      expect(painted).not.toContain(english);
    }
    // Belt and braces: not even a stray English switcher prefix.
    const englishPrefix = switcherPrefix("en").trim();
    expect(painted.filter((text) => text.startsWith(englishPrefix))).toEqual([]);
  });
});

// --- <html lang> -----------------------------------------------------------
//
// `index.html` can only carry a static value, so the provider sets it. A wrong
// `lang` mis-pronounces the whole page in a screen reader and mis-hyphenates
// it in the browser — it is not cosmetic.
test("<html lang> follows the UI language", async ({ page, api }) => {
  await page.goto("/campaigns/beispiel");
  await expect(switcher(page, "de")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");

  await switchTo(page, "de", "en");
  await expect(
    page.getByRole("radiogroup", { name: uiIn("en", "settings.language.heading") }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // …and it comes back from the server on a reload, like the language itself.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await api.get<{ locale: string | null }>("settings")).toEqual({
    locale: "en",
  });

  await languageRadio(page, "en", "de").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
});

// --- a SERVER error in the selected language --------------------------------
//
// The point of the error CODES: the server is language-free, so
// its 409 bodies carry `{ code: "slug_taken", kind, id, suggestion }` plus an
// English technical `error` text, and the APP builds the sentence. Prose on
// the wire would answer an English UI's collision in German — the one case the
// catalog cannot help with, because the copy sits on the other side.
//
// This drives the collision through the UI in BOTH languages, so the assertion
// is about the sentence the DM actually reads and not about a wire body.
test("a server error is read in the selected language", async ({
  page,
  api,
}) => {
  // The typed name slugs to `jorna`, which the example campaign already has —
  // so this is the real 409 the create dialog is built around, driven through
  // the UI.
  const taken = "Jorna";

  // The sentence the app builds from the code, in one language: the kind,
  // the taken id, the free proposal.
  const collision = (locale: Locale) =>
    uiIn(locale, "server.slug_taken", {
      kind: uiIn(locale, "server.kind.npc"),
      id: "jorna",
      suggestion: "jorna-2",
    });

  // --- German (the default) -------------------------------------------------
  await page.goto("/campaigns/beispiel/npcs");
  await page.getByRole("button", { name: uiIn("de", "create.npc.title") }).click();
  await page.getByLabel(uiIn("de", "create.npc.nameLabel")).fill(taken);
  await page.getByRole("button", { name: uiIn("de", "common.create"), exact: true }).click();
  // The whole sentence, built from the code. Nothing here comes off the wire
  // as prose.
  await expect(page.getByText(collision("de"))).toBeVisible();
  // …and the 409 wrote nothing.
  expect(await npcExists(api, "jorna-2")).toBe(false);
  await page.getByRole("button", { name: uiIn("de", "common.cancel") }).click();

  // --- the same collision in English ----------------------------------------
  await api.send("PUT", "settings", { locale: "en" });
  await page.goto("/campaigns/beispiel/npcs");
  await page.getByRole("button", { name: uiIn("en", "create.npc.title") }).click();
  await page.getByLabel(uiIn("en", "create.npc.nameLabel")).fill(taken);
  await page.getByRole("button", { name: uiIn("en", "common.create"), exact: true }).click();
  await expect(page.getByText(collision("en"))).toBeVisible();
  // The German sentence is GONE, not merely covered — this is the regression
  // the codes exist to prevent.
  await expect(page.getByText(collision("de"))).toHaveCount(0);
  expect(await npcExists(api, "jorna-2")).toBe(false);

  // Back to German for the rest of the suite.
  await api.send("PUT", "settings", { locale: null });
});

// --- which campaign /settings is about, and what is NOT a campaign ----------

test("the gear carries the campaign it was opened FROM, and has a way back", async ({
  page,
}) => {
  // The gear is campaign-independent as a ROUTE but not as a moment: the
  // page has to be about the campaign the DM was just looking at, not about
  // whichever one the "/" heuristic would guess.
  await page.goto("/campaigns/beispiel/npcs");
  await gear(page, "de").click();
  await expect(page).toHaveURL(/\/settings\?from=beispiel$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    uiIn("de", "settings.title"),
  );
  // The way back is THAT campaign's chapter overview. The row is mobile chrome, so the
  // claim is checked where it is on screen: a phone width.
  await page.setViewportSize({ width: 390, height: 780 });
  const back = page.getByRole("link", { name: uiIn("de", "mobileBack.chapterOverview") });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
});

test.describe("the cold start", () => {
  // An EMPTY instance: no campaign, so the settings page has no campaign
  // section and the page itself is the least interesting thing on screen —
  // creating a campaign is. The switch is inline in the footer so the FIRST
  // screen of a fresh installation needs no detour to change its language.
  test.use({ seed: { skip: true } });

  test("carries the switch in its footer", async ({ page, api }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      uiIn("de", "coldstart.title"),
    );
    // There is no campaign switcher at all here.
    await expect(switcher(page, "de")).toHaveCount(0);

    const group = page.getByRole("radiogroup", { name: uiIn("de", "language.heading") });
    await expect(group).toBeVisible();
    await expect(languageRadio(page, "de", "de")).toBeChecked();

    await languageRadio(page, "de", "en").click();

    // The page it sits on switches — heading, labels and the group's own name.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      uiIn("en", "coldstart.title"),
    );
    await expect(
      page.getByRole("button", { name: uiIn("en", "create.campaign.title") }),
    ).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: uiIn("en", "language.heading") }),
    ).toBeVisible();
    await expect(languageRadio(page, "en", "en")).toBeChecked();
    // Stored on the server, as every switch is.
    expect(await api.get<{ locale: string | null }>("settings")).toEqual({
      locale: "en",
    });

    // And back — the suite's rest depends on German.
    await languageRadio(page, "en", "de").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      uiIn("de", "coldstart.title"),
    );
  });

  test("and the settings page works without any campaign", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      uiIn("de", "coldstart.title"),
    );
    // The gear is on the cold start's topbar too — a fresh instance must be
    // able to reach its settings.
    await gear(page, "de").click();
    await expect(page).toHaveURL(/\/settings(\?|$)/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      uiIn("de", "settings.title"),
    );
    await expect(
      page.getByRole("radiogroup", { name: uiIn("de", "settings.language.heading") }),
    ).toBeVisible();
    // No campaign section, and no heading over nothing.
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      uiIn("de", "settings.language.heading"),
    );
    // And no campaign CHROME either: `/settings` is campaign-independent, so
    // the topbar's own `matchPath` must not read "settings" as a campaign id
    // and dress this page in a campaign switcher naming it.
    await expect(switcher(page, "de")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: uiIn("de", "topbar.nav.aria") }),
    ).toHaveCount(0);
  });

  test("and at 390px, with a touch-sized target", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      uiIn("de", "coldstart.title"),
    );

    const english = languageRadio(page, "de", "en");
    const box = await english.boundingBox();
    // Inside the viewport (the row wraps rather than pushing the page wide).
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await english.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      uiIn("en", "coldstart.title"),
    );
    await languageRadio(page, "en", "de").click();
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
    await page.goto("/campaigns/beispiel");
    await expect(page.getByRole("banner")).toBeHidden();

    const group = page.getByRole("radiogroup", { name: uiIn("de", "language.heading") });
    // It is the LAST thing on the surface, below the lookup section — a
    // footer, not a setting to deal with before starting.
    await group.scrollIntoViewIfNeeded();
    await expect(group).toBeVisible();
    await expect(languageRadio(page, "de", "de")).toBeChecked();

    await languageRadio(page, "de", "en").click();
    await expect(
      page.getByRole("radiogroup", { name: uiIn("en", "language.heading") }),
    ).toBeVisible();
    expect(await api.get<{ locale: string | null }>("settings")).toEqual({
      locale: "en",
    });

    await languageRadio(page, "en", "de").click();
    await expect(
      page.getByRole("radiogroup", { name: uiIn("de", "language.heading") }),
    ).toBeVisible();
  });
});
