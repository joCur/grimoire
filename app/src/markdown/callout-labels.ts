// The UI names of the six callouts, as catalog keys. The words themselves live
// in app/src/i18n — but which key belongs to which kind is part of the
// format's vocabulary: the reading view's label row (Callout.tsx) and the
// composer's cards and type picker (lib/block-labels.ts) must name a block
// identically, in every language. The format's own predicates live in
// @grimoire/shared/grammar.
//
// Only a key lookup, no translator: this module stays free of React and of the
// catalogs, so every side can keep asking it what a block is called.

import type { CalloutKind } from "@grimoire/shared/callouts";

import type { MessageKey } from "@/i18n";

export const CALLOUT_LABEL_KEYS: Record<CalloutKind, MessageKey> = {
  readaloud: "markdown.callout.readaloud",
  check: "markdown.callout.check",
  secret: "markdown.callout.secret",
  outcome: "markdown.callout.outcome",
  loot: "markdown.callout.loot",
  note: "markdown.callout.note",
};
