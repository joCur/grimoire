// The instance settings (`GET/PUT /api/settings`).

/**
 * The UI languages the app ships. The list lives HERE, not in the app, because
 * the server validates `PUT /api/settings` against it — the language is an
 * INSTANCE setting, not a browser preference (quality floor: no localStorage
 * for data, the server is the truth).
 */
export const UI_LOCALES = ["de", "en"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

/**
 * GET/PUT /api/settings — the whole instance settings object (Grimoire is a
 * single-user tool, so there is exactly one of it).
 *
 * `locale: null` means NOT DECIDED YET: the app then follows
 * `navigator.language` and writes nothing. Only an explicit switch in the UI
 * stores a value, which is what makes the choice survive a reload and reach
 * the next browser.
 */
export interface InstanceSettings {
  locale: UiLocale | null;
}
