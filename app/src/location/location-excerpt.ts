// The short form of a location — what its aside card, the hover preview of a
// `[[slug]]` reference and its reading view show of it, read off its own
// fields (ADR #31), never off a section of its text (ADR #29).
//
// A reference INSIDE the atmosphere reads as the current display name, plain
// text (a short form is no place for a second link); an unresolved slug keeps
// its brackets, exactly as the rendered text shows it.
//
// Pure on purpose: the name lookup is passed in, so this runs without a tree,
// a query or a DOM.

import { expandBodyRefs } from "@grimoire/shared/refs";
import type { Location } from "@grimoire/shared/location";

export interface LocationExcerpt {
  /** The `atmosphere` field, references as names. */
  mood?: string;
  /** The Roll20 page reference — shown only where there is no mood line. */
  page?: string;
}

/** A location's short form; `nameOf` is the current display name of a slug. */
export function locationExcerpt(
  location: Location,
  nameOf: (slug: string) => string | undefined,
): LocationExcerpt {
  const { atmosphere, roll20Page } = location;
  return {
    ...(atmosphere === undefined || atmosphere === ""
      ? {}
      : { mood: expandBodyRefs(atmosphere, nameOf) }),
    ...(roll20Page === undefined || roll20Page === "" ? {} : { page: roll20Page }),
  };
}
