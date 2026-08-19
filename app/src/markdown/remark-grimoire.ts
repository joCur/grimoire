// Remark plugin for the two Grimoire markdown extensions (see /README.md):
//
// 1. Obsidian-style callouts: a blockquote whose first line starts with
//    `[!kind]`. Known kinds (CALLOUT_KINDS from @grimoire/shared) are turned
//    into `<section data-callout="kind">` via mdast `data.hName`; the marker
//    text is stripped. UNKNOWN kinds are left completely untouched and thus
//    render as a plain blockquote with their text — the format degrades, it
//    never errors.
//
// 2. `## If: <condition>` headings: the heading plus every sibling up to the
//    next depth<=2 heading (or end of document) is wrapped in a custom node
//    that renders as `<details data-if-section>` with the condition as its
//    `<summary>` label.
//
// Both transforms only annotate/regroup mdast nodes; the React side maps the
// resulting elements to components (see Markdown.tsx).

import { CALLOUT_KINDS } from "@grimoire/shared/types";
import type { Blockquote, Heading, Root, RootContent } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";

const CALLOUT_MARKER = /^\[!([a-z0-9-]+)\][ \t]*/i;
const IF_PREFIX = /^if:\s*/i;

const KNOWN_KINDS: readonly string[] = CALLOUT_KINDS;

/**
 * Plain text of a callout body (clipboard payload for the Roll20 chat):
 * soft line breaks collapse to spaces, block children are separated by
 * blank lines.
 */
function plainText(node: Blockquote): string {
  return node.children
    .map((child) => mdastToString(child).replace(/[ \t]*\r?\n[ \t]*/g, " "))
    .join("\n\n")
    .trim();
}

function transformCallouts(tree: Root): void {
  visit(tree, "blockquote", (node: Blockquote) => {
    const firstBlock = node.children[0];
    if (!firstBlock || firstBlock.type !== "paragraph") return;
    const firstInline = firstBlock.children[0];
    if (!firstInline || firstInline.type !== "text") return;

    const match = CALLOUT_MARKER.exec(firstInline.value);
    if (!match) return;
    const kind = (match[1] ?? "").toLowerCase();
    // Unknown kind: leave the blockquote as it is (plain rendering, no error).
    if (!KNOWN_KINDS.includes(kind)) return;

    // Strip the `[!kind]` marker (and a soft line break right after it).
    const rest = firstInline.value.slice(match[0].length).replace(/^\r?\n/, "");
    if (rest.length > 0) {
      firstInline.value = rest;
    } else {
      firstBlock.children.shift();
      if (firstBlock.children.length === 0) node.children.shift();
    }

    node.data = {
      ...node.data,
      hName: "section",
      hProperties: {
        "data-callout": kind,
        // The read-aloud copy button copies plain text for the Roll20 chat.
        ...(kind === "readaloud" ? { "data-copy-text": plainText(node) } : {}),
      },
    };
  });
}

/** Returns the condition text if the heading is a `## If: …` heading. */
function ifCondition(node: Heading): string | null {
  if (node.depth !== 2) return null;
  const text = mdastToString(node);
  const match = IF_PREFIX.exec(text);
  if (!match) return null;
  return text.slice(match[0].length).trim();
}

function transformIfSections(tree: Root): void {
  const result: RootContent[] = [];
  const children = tree.children;

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (!node) continue;

    const condition = node.type === "heading" ? ifCondition(node) : null;
    if (condition === null) {
      result.push(node);
      continue;
    }

    // Collect everything up to the next depth<=2 heading (or the end).
    const body: RootContent[] = [];
    let j = i + 1;
    while (j < children.length) {
      const sibling = children[j];
      if (!sibling) break;
      if (sibling.type === "heading" && sibling.depth <= 2) break;
      body.push(sibling);
      j++;
    }
    i = j - 1;

    const summary = {
      type: "ifSummary",
      data: { hName: "summary" },
      children: [{ type: "text", value: condition }],
    };
    const section = {
      type: "ifSection",
      data: { hName: "details", hProperties: { "data-if-section": condition } },
      children: [summary, ...body],
    };
    // Custom node types are not part of the mdast content union; they carry
    // hName/hProperties so mdast-util-to-hast renders them as elements.
    result.push(section as unknown as RootContent);
  }

  tree.children = result;
}

/** The Grimoire remark plugin: callouts + `## If:` sections. */
export function remarkGrimoire() {
  return (tree: Root): void => {
    // If-sections first, so callouts inside a section are still transformed
    // by the subsequent full-tree visit.
    transformIfSections(tree);
    transformCallouts(tree);
  };
}
