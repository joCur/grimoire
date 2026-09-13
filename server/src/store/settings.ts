// Instance settings (issue #69) — GET/PUT /api/settings.
//
// Grimoire is a single-user tool, so there is exactly ONE settings object and
// it needs no table of its own: the existing `meta` key/value table carries it
// under the `setting:` prefix. That keeps the migration surface at zero (no
// 0006_*.sql) while the setting is still SERVER state, which is the point —
// the quality floor forbids localStorage for data, so the UI language has to
// survive a reload and reach the next browser.
//
// Unset is a real state and answers `null`: the app then follows
// `navigator.language` (app/src/i18n/messages.ts) and writes nothing, so a
// fresh instance is never wrong about the language it was never told.

import { eq } from "drizzle-orm";
import { isUiLocale, type InstanceSettings } from "@grimoire/shared";

import { ApiError } from "../campaign-fs";
import { meta } from "../db/schema";
import { getDb } from "./handle";

/** `meta` key of the UI language. */
const LOCALE_KEY = "setting:locale";

export async function readSettings(): Promise<InstanceSettings> {
  const db = await getDb();
  const rows = await db.select().from(meta).where(eq(meta.key, LOCALE_KEY));
  const stored = rows[0]?.value;
  return { locale: isUiLocale(stored) ? stored : null };
}

/**
 * Store the UI language. `null` DELETES the setting — back to "not decided",
 * which is a state the app can reach again deliberately rather than a value
 * it has to special-case.
 */
export async function writeSettings(patch: unknown): Promise<InstanceSettings> {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw new ApiError(400, "settings: object body expected");
  }
  const locale = (patch as Record<string, unknown>).locale;
  if (locale !== null && !isUiLocale(locale)) {
    throw new ApiError(400, "settings: locale must be one of de, en, or null");
  }
  const db = await getDb();
  if (locale === null) {
    await db.delete(meta).where(eq(meta.key, LOCALE_KEY));
  } else {
    await db
      .insert(meta)
      .values({ key: LOCALE_KEY, value: locale })
      .onConflictDoUpdate({ target: meta.key, set: { value: locale } });
  }
  return readSettings();
}
