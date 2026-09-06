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
//    that renders as `<details data-if-section open>` with the condition as
//    its `<summary>` label. Branches are OPEN by default (design reference) —
//    the DM collapses what does not apply.
//
// 3. `[[slug]]` entity references (issue #68): every text node is split and
//    the reference becomes a `<span data-entity-ref="slug">` carrying the
//    literal `[[slug]]` as its text. RESOLUTION IS NOT THIS PLUGIN'S JOB —
//    the name lives in the campaign tree, which only React has (EntityRef in
//    Markdown.tsx). The literal text inside the span is therefore also the
//    degradation: a span whose slug nothing resolves renders exactly what the
//    DM typed. Code (fenced and inline) and link text are skipped, and in a
//    `## If:` summary the reference is marked PLAIN — the row is a toggle.
//
// All three transforms only annotate/regroup mdast nodes; the React side maps
// the resulting elements to components (see Markdown.tsx).

import type { Blockquote, Heading, Parent, PhrasingContent, Root, RootContent } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";

// The marker, the If-prefix and the depth boundary are the FORMAT, not this
// plugin's private business — the Block-Composer reads the same document with
// the same rules (app/src/markdown/grammar.ts).
import {
  CALLOUT_MARKER,
  endsIfSection,
  ifSectionCondition,
  isCalloutKind,
} from "@/markdown/grammar";
// `[[slug]]` is the format too — the server expands the same references for
// the search index and the generator is told to emit them (@grimoire/shared).
import {
  entityRefSource,
  splitEntityRefs,
  type EntityRefPiece,
} from "@grimoire/shared/refs";

/** The attribute the React side reads to resolve a reference. */
export const ENTITY_REF_ATTR = "data-entity-ref";

/**
 * The attribute a SUMMARY's reference carries: a `## If:` summary is a
 * toggle, so a reference in it renders as the resolved NAME AS TEXT — never
 * as a link or a button (see `transformEntityRefs`).
 */
export const ENTITY_REF_PLAIN_ATTR = "data-entity-ref-plain";

/** The read-aloud clipboard payload: `EntityRefPiece[]` as JSON. */
export const COPY_PARTS_ATTR = "data-copy-parts";

/**
 * The read-aloud clipboard payload (Roll20 chat) as PIECES: soft line breaks
 * collapse to spaces, block children are separated by blank lines, and a
 * `[[slug]]` stays a piece of its own so React can put the RESOLVED NAME in
 * the clipboard (Markdown.tsx).
 *
 * Why pieces and not one string: the copy has to equal what the DM READS, and
 * only the mdast knows which brackets are prose. `inlineCode`/`code` children
 * contribute their value literally — a read-aloud that quotes `` `[[jorna]]` ``
 * shows brackets on screen, so the clipboard keeps them too.
 */
function copyParts(node: Blockquote): EntityRefPiece[] {
  const parts: EntityRefPiece[] = [];
  const pushText = (value: string): void => {
    if (value === "") return;
    const last = parts[parts.length - 1];
    if (last !== undefined && last.type === "text") last.value += value;
    else parts.push({ type: "text", value });
  };
  const collapse = (value: string): string => value.replace(/[ \t]*\r?\n[ \t]*/g, " ");

  const walk = (current: unknown): void => {
    const item = current as { type?: string; value?: string; children?: unknown[] };
    if (item.type === "text") {
      for (const piece of splitEntityRefs(item.value ?? "")) {
        if (piece.type === "ref") parts.push(piece);
        else pushText(collapse(piece.value));
      }
      return;
    }
    if (Array.isArray(item.children)) {
      for (const child of item.children) walk(child);
      return;
    }
    // A leaf without text children (inlineCode, code, …): its plain text.
    pushText(collapse(mdastToString(current as Parameters<typeof mdastToString>[0])));
  };

  node.children.forEach((child, index) => {
    if (index > 0) pushText("\n\n");
    walk(child);
  });

  // Trim the ends, exactly as the single-string version did.
  const first = parts[0];
  if (first !== undefined && first.type === "text") first.value = first.value.replace(/^\s+/, "");
  const last = parts[parts.length - 1];
  if (last !== undefined && last.type === "text") last.value = last.value.replace(/\s+$/, "");
  return parts.filter((piece) => piece.type !== "text" || piece.value !== "");
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
    if (!isCalloutKind(kind)) return;

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
        // The read-aloud copy button copies plain text for the Roll20 chat;
        // references are resolved by the React side (Markdown.tsx).
        ...(kind === "readaloud" ? { [COPY_PARTS_ATTR]: JSON.stringify(copyParts(node)) } : {}),
      },
    };
  });
}

/**
 * Returns the condition text if the heading is a `## If: …` heading. The
 * heading's PLAIN text is what decides (mdastToString), so `## *If:* x` is a
 * section too — the shared predicate strips the same wrappers for the composer.
 */
function ifCondition(node: Heading): string | null {
  return ifSectionCondition(node.depth, mdastToString(node));
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
      if (sibling.type === "heading" && endsIfSection(sibling.depth)) break;
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
      data: { hName: "details", hProperties: { "data-if-section": condition, open: true } },
      children: [summary, ...body],
    };
    // Custom node types are not part of the mdast content union; they carry
    // hName/hProperties so mdast-util-to-hast renders them as elements.
    result.push(section as unknown as RootContent);
  }

  tree.children = result;
}

/**
 * Split every text node on `[[slug]]` references (issue #68).
 *
 * Walked by hand instead of with `visit`, for two reasons that both matter:
 *
 *   * a text node is REPLACED BY SEVERAL nodes, which needs the parent's
 *     children array, and
 *   * text inside a LINK is skipped — a resolved reference renders as an
 *     anchor, and an anchor inside an anchor is not a document. Reference-style
 *     links (`linkReference`, `imageReference`) count as links here: they also
 *     become an anchor, and `[text with [[ref]]][label]` would nest one.
 *     `inlineCode` and `code` are skipped for free: their content is not a
 *     text node.
 *
 * Inside a `## If:` SUMMARY the reference stays PLAIN: the summary row is the
 * branch's toggle, and a link or button in it would navigate away instead of
 * folding the branch (the same reason the live view turns refs into buttons).
 * The resolved NAME is still what it shows — a toggle that reads "Falls Jorna
 * gewarnt wurde" is what the DM wants, `[[jorna]]` is not.
 */
const LINK_TYPES = new Set(["link", "linkReference", "imageReference"]);

function transformEntityRefs(node: Parent, insideLink: boolean, insideSummary = false): void {
  const next: RootContent[] = [];
  let changed = false;

  for (const child of node.children) {
    if (child.type === "text" && !insideLink) {
      const pieces = splitEntityRefs(child.value);
      if (pieces.length > 1 || pieces[0]?.type === "ref") {
        changed = true;
        for (const piece of pieces) {
          if (piece.type === "text") {
            next.push({ type: "text", value: piece.value });
            continue;
          }
          next.push({
            type: "entityRef",
            data: {
              hName: "span",
              hProperties: {
                [ENTITY_REF_ATTR]: piece.slug,
                ...(insideSummary ? { [ENTITY_REF_PLAIN_ATTR]: "" } : {}),
              },
            },
            // The literal source IS the fallback rendering (see the header).
            children: [{ type: "text", value: entityRefSource(piece.slug) }],
          } as unknown as PhrasingContent as RootContent);
        }
        continue;
      }
    }
    if ("children" in child && Array.isArray(child.children)) {
      transformEntityRefs(
        child as Parent,
        insideLink || LINK_TYPES.has(child.type),
        insideSummary || (child.type as string) === "ifSummary",
      );
    }
    next.push(child);
  }

  if (changed) node.children = next as Parent["children"];
}

/** The Grimoire remark plugin: callouts, `## If:` sections, `[[refs]]`. */
export function remarkGrimoire() {
  return (tree: Root): void => {
    // If-sections first, so callouts inside a section are still transformed
    // by the subsequent full-tree visit.
    transformIfSections(tree);
    transformCallouts(tree);
    // References LAST: the callout pass reads the raw first text node of a
    // blockquote to find its `[!kind]` marker, and a marker line that also
    // carries a reference must still be a callout.
    transformEntityRefs(tree, false);
  };
}
