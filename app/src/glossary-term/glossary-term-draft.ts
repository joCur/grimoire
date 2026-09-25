// What the glossary page does with a term, pure: which terms it shows in
// which order, what an open term's form holds and what a save writes.

import type { GlossaryTerm, GlossaryTermChange } from "@grimoire/shared/glossary-term";

/** The form of one term: its two fields. */
export type GlossaryTermDraft = Pick<GlossaryTerm, "term" | "explanation">;

/**
 * The glossary as the page shows it: ALPHABETICAL by term, filtered by term
 * and explanation.
 *
 * Alphabetical and not the order of creation, because a glossary is looked
 * things up in, and „where did I put it" is not a question a reference list
 * should ask — which is also why the page offers no up/down.
 */
export function visibleGlossaryTerms(terms: readonly GlossaryTerm[], filter = ""): GlossaryTerm[] {
  const needle = filter.trim().toLocaleLowerCase("de");
  const matches = (text: string) => text.toLocaleLowerCase("de").includes(needle);
  return terms
    .filter((term) => needle === "" || matches(term.term) || matches(term.explanation))
    .sort((a, b) => a.term.localeCompare(b.term, "de"));
}

/** The form of a stored term. */
export function glossaryTermDraft(term: GlossaryTerm): GlossaryTermDraft {
  return { term: term.term, explanation: term.explanation };
}

/** An empty term — what the new-term button opens. */
export function emptyGlossaryTermDraft(): GlossaryTermDraft {
  return { term: "", explanation: "" };
}

/**
 * Is a term worth saving? A term-less one is one the DM opened and left
 * alone — the server would refuse it, so the save button stays disabled
 * instead of answering with an error.
 */
export function isSendableGlossaryTerm(draft: GlossaryTermDraft): boolean {
  return draft.term.trim() !== "";
}

/**
 * The write of an open term: ONLY the fields that moved since it was opened,
 * so a forced save after a conflict keeps what somebody else changed in the
 * other field.
 */
export function glossaryTermChange(
  original: GlossaryTermDraft,
  draft: GlossaryTermDraft,
): GlossaryTermChange {
  return {
    ...(draft.term === original.term ? {} : { term: draft.term }),
    ...(draft.explanation === original.explanation ? {} : { explanation: draft.explanation }),
  };
}
