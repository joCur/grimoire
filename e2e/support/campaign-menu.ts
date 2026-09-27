// The campaign menu — the one way into the areas of a campaign
// (app/src/lib/areas.ts). In the topbar from md up, in the phone's own row
// below; whichever is on screen is the one these helpers reach.

import escapeStringRegexp from "escape-string-regexp";
import type { Locator, Page } from "@playwright/test";

import type { Locale, MessageKey } from "../../app/src/i18n/messages";
import { uiIn, uiPattern } from "./ui";

/** The catalog key of an area's label. */
export type AreaKey = Extract<MessageKey, `area.${string}`>;

/** The trigger of the campaign menu that is on screen. */
export function campaignMenu(page: Page, locale: Locale = "de"): Locator {
  return page.getByRole("button", {
    name: uiPattern("campaignMenu.trigger", { name: /.*/ }, { locale }),
  });
}

/**
 * An area's entry in the opened menu — a menu item on the desktop, a link in
 * the phone's sheet. Anchored at the label's start: the session review's
 * entry carries its open count after it.
 */
export function areaEntry(page: Page, area: AreaKey, locale: Locale = "de"): Locator {
  const name = new RegExp(`^${escapeStringRegexp(uiIn(locale, area))}`);
  return page
    .getByRole("menuitem", { name })
    .or(page.getByRole("dialog").getByRole("link", { name }));
}

/** The entry the opened menu marks as the current area. */
export function currentAreaEntry(page: Page): Locator {
  return page
    .getByRole("menu")
    .or(page.getByRole("dialog"))
    .locator("[aria-current='page']");
}

/** Open the campaign menu and go to an area. */
export async function openArea(page: Page, area: AreaKey, locale: Locale = "de"): Promise<void> {
  await campaignMenu(page, locale).click();
  await areaEntry(page, area, locale).click();
}
