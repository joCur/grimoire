// GFM TABLES — and nothing else from GFM (issue #96).
//
// The format grew one borrowed construct: the pipe table, because a random
// table („W6 — was treibt in der Bucht?") is the one thing a DM writes that
// prose cannot carry. The PO's decision is explicit: tables only.
//
// Why this module instead of `remark-gfm`: the umbrella plugin turns on FIVE
// extensions at once (tables, strikethrough, task lists, autolink literals,
// footnotes) and offers no switch to leave four of them off — `singleTilde`
// only narrows strikethrough, it does not disable it. Two of the four would
// change documents we already have:
//
//   * TASK LISTS would eat the inbox syntax. `- [x] erledigt` is a LINE IN A
//     FILE that the app checks off through the API (README, Inbox); rendered
//     as a checkbox it becomes a control that writes nothing, and the DM's own
//     `- [ ]` notes in a scene would silently turn into UI.
//   * AUTOLINK LITERALS and FOOTNOTES invent meaning in prose nobody wrote for
//     them; strikethrough collides with nothing but is not part of the format
//     either.
//
// So we take the two micro-packages `remark-gfm` itself is built from —
// `micromark-extension-gfm-table` (the syntax) and `mdast-util-gfm-table` (the
// mdast nodes) — and register exactly those. Everything else stays literal
// text, which is the same degradation rule as the rest of the format: a
// `~~wort~~` renders as `~~wort~~`, no error, no surprise.
//
// The mdast side needs no renderer of its own: `table`/`tableRow`/`tableCell`
// are core mdast-util-to-hast nodes and become `<table>`/`<tr>`/`<td>`. The
// horizontal-scroll wrapper and the styling live with the rest of the
// rendering (Markdown.tsx, index.css).

import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTable } from "micromark-extension-gfm-table";
import type { Processor } from "unified";

/**
 * Remark plugin: enable GFM pipe tables. Registered next to remarkGrimoire —
 * order does not matter, this one only extends the PARSER while the Grimoire
 * plugin transforms the tree it produces.
 */
export function remarkTable(this: Processor): undefined {
  const data = this.data();
  const micromarkExtensions = (data.micromarkExtensions ??= []);
  const fromMarkdownExtensions = (data.fromMarkdownExtensions ??= []);
  micromarkExtensions.push(gfmTable());
  fromMarkdownExtensions.push(gfmTableFromMarkdown());
}
