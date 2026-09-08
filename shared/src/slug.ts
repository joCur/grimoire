// THE SLUG RULE — one place, both sides (issue #56).
//
// Entity ids are kebab-case slugs: the README calls them the stable reference
// keys of the format ("id … NIE ändern"), the database uses them as primary
// keys, and every address is built from them (store/paths.ts). Until now the
// rule was written down three times — `ENTITY_SLUG` in the server's
// store/write.ts, a copy in the app's lib/entity.ts, and the German
// transliteration in the app's lib/review.ts (the npc-stub dialog). With
// issue #56 the app DERIVES an id from a typed title for five kinds and the
// server has to derive the same one and propose a free variant on a
// collision, so the three copies became one module.
//
// Its own file, no runtime dependencies: the package root pulls in
// gray-matter (parse.ts), which has no business in a browser bundle, so the
// app imports `@grimoire/shared/slug` the way it imports `/kind`.

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
