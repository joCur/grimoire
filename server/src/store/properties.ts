// Which properties an entry of each kind has, and how a patch reaches them.
//
// The contract is the complete list of keys per kind: there is nothing beside
// them, so a patch naming one that is not on its kind's list is a 400 and a
// seed naming one is refused. Applying a flat patch to a rendered properties
// mapping is the other half, `null` deleting a key.

import { ApiError } from "../api-error";

/**
 * THE CONTRACT KEYS per kind — the complete set of properties a stored entry
 * can carry, in the README's order. There is nothing beside them: a key that
 * is not on its kind's list has no field behind it, so a patch naming one is
 * a 400 and a seed naming one is refused.
 */
export const SCENE_KEYS = [
  "id",
  "title",
  "type",
  "trigger",
  "chapter",
  "location",
  "npcs",
  "handouts",
  "tags",
  "status",
] as const;
export const NPC_KEYS = [
  "id",
  "name",
  "role",
  "chapter",
  "status",
  "statblock",
  "quickstats",
  "voice",
  "appearance",
] as const;
export const LOCATION_KEYS = ["id", "name", "chapter", "roll20-page"] as const;
export const CHAPTER_KEYS = ["id", "title", "status"] as const;
export const CAMPAIGN_KEYS = ["id", "name", "description"] as const;
/**
 * A session is not an entry and has no properties patch (ADR #26). The list
 * survives for the SEED, which writes historic sessions from this shape
 * (db/seed.ts) — `reviewed` is not among them, because the review flag sits
 * on the log row it belongs to.
 */
const SESSION_KEYS = ["id", "started", "ended", "scenes_played", "pauses"] as const;

/** The same lists by kind, for callers that look one up (db/seed.ts). */
export const PROPERTY_CONTRACT = {
  campaign: CAMPAIGN_KEYS,
  chapter: CHAPTER_KEYS,
  scene: SCENE_KEYS,
  npc: NPC_KEYS,
  location: LOCATION_KEYS,
  session: SESSION_KEYS,
} as const satisfies Record<string, readonly string[]>;

/**
 * A patch may only name keys the CONTRACT names (schema.ts rule 1). There is
 * no field behind anything else, and a typo would otherwise become a silent
 * new key.
 */
export function rejectUnknownKeys(patch: Record<string, unknown>, contract: readonly string[]): void {
  for (const key of Object.keys(patch)) {
    if (contract.includes(key)) continue;
    throw new ApiError(400, `unknown property "${key}" — the entry has no such field`);
  }
}

export function rejectIdPatch(patch: Record<string, unknown>, current: string): void {
  if (!("id" in patch)) return;
  const next = patch.id;
  if (typeof next === "string" && next === current) return; // a no-op patch is fine
  throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
}

// --- applying a flat patch ----------------------------------------------------

/** Keys that would hit Object.prototype machinery instead of data. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Apply a flat properties patch to a rendered properties mapping — `null`
 * deletes a key. The columns behind the mapping are the values, so nothing
 * is parsed on the way in or out.
 */
export function applyPatch(
  props: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...props };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "" || UNSAFE_KEYS.has(key)) throw new ApiError(400, `invalid patch key: ${key}`);
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}
