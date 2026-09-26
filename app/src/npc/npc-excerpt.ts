// The short form of an npc — what its aside cards, the hover preview of a
// `[[slug]]` reference, its reading view and a proposed npc's card show of
// it, read off its own fields (ADR #31), never off a section of its text
// (ADR #29).
//
// A reference INSIDE the motivation reads as the current display name, plain
// text (a short form is no place for a second link); an unresolved slug keeps
// its brackets, exactly as the rendered text shows it.
//
// Pure on purpose: the name lookup is passed in, so this runs without a tree,
// a query or a DOM.

import { expandBodyEntityRefs } from "@grimoire/shared/refs";
import type { NpcProposal, NpcStatus } from "@grimoire/shared/npc";

export interface NpcExcerpt {
  role?: string;
  voice?: string;
  /** The `motivation` field, references as names. */
  will?: string;
  /** The quick stats as name/value pairs, values as their text. */
  quickstats: [string, string][];
  status: NpcStatus;
}

/** Non-empty text, or undefined. */
function text(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/**
 * An npc's short form — a stored npc and a proposed one alike;
 * `nameOf` is the current display name of a slug.
 */
export function npcExcerpt(
  npc: Pick<NpcProposal, "role" | "voice" | "motivation" | "quickstats" | "status">,
  nameOf: (slug: string) => string | undefined,
): NpcExcerpt {
  const will = text(npc.motivation);
  return {
    role: text(npc.role),
    voice: text(npc.voice),
    will: will === undefined ? undefined : expandBodyEntityRefs(will, nameOf),
    quickstats: Object.entries(npc.quickstats ?? {}).map(([key, value]) => [key, String(value)]),
    status: npc.status,
  };
}
