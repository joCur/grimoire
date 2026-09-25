// The npc a review note introduces: the dialog that creates it from a log or
// inbox row needs an id the DM chooses — a note is prose, and ids are the
// stable keys of the format (README) — so it proposes a kebab-case slug
// derived from the name the note most likely means. Pure, so the derivation
// is unit-testable.

import { isEntityId, toSlug } from "@grimoire/shared/slug";

/** An npc id follows the one slug rule of the whole app (@grimoire/shared/slug). */
export function isNpcSlug(id: string): boolean {
  return isEntityId(id);
}

const QUOTED = /["“„»'‚]([^"“”„«»'‚‘]{2,40})["”“«'‘]/u;
const CAPITALIZED = /\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*){0,2}/gu;

/**
 * The name a log row probably introduces: a quoted name wins
 * (`Improvisiert: Fischerin "Old Metta" am Steg` → `Old Metta`), otherwise
 * the first run of capitalized words that is not a label ending in `:`.
 * Undefined when nothing looks like a name — the dialog then starts empty.
 */
export function npcNameFromText(text: string): string | undefined {
  const quoted = QUOTED.exec(text);
  const inQuotes = quoted?.[1]?.trim();
  if (inQuotes !== undefined && inQuotes !== "") return inQuotes;

  for (const match of text.matchAll(CAPITALIZED)) {
    const name = match[0].trim();
    const after = text.charAt((match.index ?? 0) + match[0].length);
    if (after === ":") continue; // "Improvisiert:", "Neuer NPC:" — a label
    if (name !== "") return name;
  }
  return undefined;
}

/**
 * Slug proposal for the dialog (editable there): kebab-case, German
 * transliteration, diacritics folded — the rule the server and the create
 * dialogs share (@grimoire/shared/slug). "" when the text carries no
 * recognizable name.
 */
export function deriveNpcSlug(text: string): string {
  const name = npcNameFromText(text);
  return name === undefined ? "" : toSlug(name);
}
