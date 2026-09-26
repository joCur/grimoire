// THE SLUG RULE — one place, both sides.
//
// Entity ids are kebab-case slugs: the README calls them the stable reference
// keys of the format, set once and never changed (decisions/constraints), the database uses
// them as primary keys, and every resource URL names a row by one. The app
// DERIVES an id from a typed title and shows it before the create, and the
// server derives the same one and proposes a free variant on a collision, so
// both read the rule from this module.
//
// Its own module, no runtime dependencies, so the app imports
// `@grimoire/shared/slug` without the package root.

/** Entity ids are kebab slugs: lowercase, digits, single dashes. */
export const ENTITY_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Is this string a legal entity id? */
export function isEntityId(value: string): boolean {
  return ENTITY_SLUG.test(value);
}

/**
 * German transliteration, so a typed title yields an id a DM recognizes:
 * `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`. Everything else diacritical is folded
 * (`é→e`) — only these four carry a spelling of their own in German.
 */
const TRANSLITERATE: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

/**
 * The kebab slug of a display name — the ONE derivation rule.
 * Returns "" when nothing usable is left (a title of only punctuation, or
 * only characters no fold can map into `a-z0-9`, e.g. CJK): the caller has to
 * handle that, because an id is never invented out of nothing.
 */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => TRANSLITERATE[c] ?? c)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The nth variant of a slug — the collision proposal (`hafen` → `hafen-2`).
 * A slug that already ends in `-<n>` is NOT parsed apart: `hafen-2` becomes
 * `hafen-2-2`, which is ugly but honest — a trailing number can perfectly
 * well be part of the name a DM chose (`kapitel-2`), and re-interpreting it
 * would silently propose an id for a different name.
 */
export function slugVariant(slug: string, n: number): string {
  return n <= 1 ? slug : `${slug}-${n}`;
}

/**
 * The first variant of `slug` that `taken` does not claim — `slug` itself
 * when it is free, else `slug-2`, `slug-3`, … The counter is bounded so a
 * pathological data set cannot spin; at the cap the caller gets the last
 * candidate and the collision surfaces as the usual 409.
 */
export function freeSlug(slug: string, taken: (candidate: string) => boolean): string {
  for (let n = 1; n <= 200; n++) {
    const candidate = slugVariant(slug, n);
    if (!taken(candidate)) return candidate;
  }
  return slugVariant(slug, 200);
}
