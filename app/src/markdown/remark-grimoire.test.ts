// Transformation tests for the Grimoire remark plugin (bun:test — the
// plugin operates on mdast only, no DOM involved).

import { CALLOUT_KINDS } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import type { Blockquote, Root, RootContent } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { remarkGrimoire } from "./remark-grimoire";

function run(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkGrimoire);
  return processor.runSync(processor.parse(markdown)) as Root;
}

interface NodeData {
  hName?: string;
  hProperties?: Record<string, unknown>;
}

function dataOf(node: RootContent | undefined): NodeData {
  return ((node as { data?: NodeData } | undefined)?.data ?? {}) as NodeData;
}

function childrenOf(node: RootContent | undefined): RootContent[] {
  return (node as { children?: RootContent[] } | undefined)?.children ?? [];
}

describe("callouts", () => {
  test.each([...CALLOUT_KINDS])("transforms [!%s] into a tagged section", (kind) => {
    const tree = run(`> [!${kind}] Inhalt des Callouts.`);
    const node = tree.children[0];
    const data = dataOf(node);
    expect(node?.type).toBe("blockquote");
    expect(data.hName).toBe("section");
    expect(data.hProperties?.["data-callout"]).toBe(kind);
    // marker is stripped from the rendered text
    expect(mdastToString(node)).toBe("Inhalt des Callouts.");
  });

  test("readaloud copy text collapses soft line breaks (Roll20 chat paste)", () => {
    const tree = run("> [!readaloud] Der Turm ragt schwarz\n> gegen den Abendhimmel auf.");
    const data = dataOf(tree.children[0]);
    expect(data.hProperties?.["data-copy-text"]).toBe(
      "Der Turm ragt schwarz gegen den Abendhimmel auf.",
    );
  });

  test("marker casing is accepted, kind is normalized to lowercase", () => {
    const tree = run("> [!NOTE] Groß geschrieben.");
    expect(dataOf(tree.children[0]).hProperties?.["data-callout"]).toBe("note");
  });

  test("marker-only first line keeps the following lines as content", () => {
    const tree = run("> [!note]\n> Erst hier beginnt der Text.");
    const node = tree.children[0];
    expect(dataOf(node).hName).toBe("section");
    expect(mdastToString(node)).toBe("Erst hier beginnt der Text.");
  });

  test("UNKNOWN kind stays an untouched blockquote with its text", () => {
    const tree = run("> [!homebrew] Bleibt einfach Text.");
    const node = tree.children[0] as Blockquote;
    expect(node.type).toBe("blockquote");
    expect(node.data).toBeUndefined();
    // the marker text is preserved, nothing is thrown or hidden
    expect(mdastToString(node)).toBe("[!homebrew] Bleibt einfach Text.");
  });

  test("plain blockquote without marker is untouched", () => {
    const tree = run("> Nur ein Zitat.");
    const node = tree.children[0] as Blockquote;
    expect(node.data).toBeUndefined();
    expect(mdastToString(node)).toBe("Nur ein Zitat.");
  });
});

describe("if-sections", () => {
  test("wraps heading plus content until the next H2 into a details node", () => {
    const tree = run(
      [
        "## If: sie lügen",
        "",
        "Absatz eins.",
        "",
        "- Liste",
        "",
        "## Danach",
        "",
        "Außerhalb.",
      ].join("\n"),
    );

    const section = tree.children[0];
    const data = dataOf(section);
    expect(data.hName).toBe("details");
    expect(data.hProperties?.["data-if-section"]).toBe("sie lügen");
    // branches are open by default (design reference)
    expect(data.hProperties?.["open"]).toBe(true);

    const kids = childrenOf(section);
    // summary + paragraph + list
    expect(kids).toHaveLength(3);
    expect(dataOf(kids[0]).hName).toBe("summary");
    expect(mdastToString(kids[0])).toBe("sie lügen");
    expect(kids[1]?.type).toBe("paragraph");
    expect(kids[2]?.type).toBe("list");

    // the following H2 and its content stay top-level siblings
    expect(tree.children[1]?.type).toBe("heading");
    expect(mdastToString(tree.children[1])).toBe("Danach");
    expect(tree.children[2]?.type).toBe("paragraph");
  });

  test("runs to the end of the document when no further H2 follows", () => {
    const tree = run("## If: die Wache schläft\n\nEins.\n\n### Unterpunkt\n\nZwei.");
    expect(tree.children).toHaveLength(1);
    const kids = childrenOf(tree.children[0]);
    // summary + paragraph + h3 + paragraph — deeper headings do not end the section
    expect(kids).toHaveLength(4);
  });

  test("ordinary H2 headings are untouched", () => {
    const tree = run("## Flow\n\nText.");
    expect(tree.children[0]?.type).toBe("heading");
    expect(dataOf(tree.children[0]).hName).toBeUndefined();
  });

  test("H3 'If:' headings are not sectioned (contract is H2)", () => {
    const tree = run("### If: zu tief verschachtelt\n\nText.");
    expect(tree.children[0]?.type).toBe("heading");
    expect(dataOf(tree.children[0]).hName).toBeUndefined();
  });

  test("callouts inside an if-section are still transformed", () => {
    const tree = run("## If: sie lügen\n\n> [!check] Charisma (Deception) vs. Insight.");
    const kids = childrenOf(tree.children[0]);
    const callout = kids[1];
    expect(dataOf(callout).hName).toBe("section");
    expect(dataOf(callout).hProperties?.["data-callout"]).toBe("check");
  });

  test("empty if-section still renders as details with only the summary", () => {
    const tree = run("## If: nichts passiert\n\n## Danach");
    const kids = childrenOf(tree.children[0]);
    expect(kids).toHaveLength(1);
    expect(dataOf(kids[0]).hName).toBe("summary");
  });

  test("every if-section carries the open attribute", () => {
    const tree = run("## If: a\n\nEins.\n\n## If: b\n\nZwei.");
    expect(tree.children).toHaveLength(2);
    for (const child of tree.children) {
      expect(dataOf(child).hProperties?.["open"]).toBe(true);
    }
  });
});

describe("reference fixtures", () => {
  test("never throws on arbitrary markdown (format degrades)", () => {
    expect(() => run("")).not.toThrow();
    expect(() => run("> ")).not.toThrow();
    expect(() => run("> [!]")).not.toThrow();
    expect(() => run("## If:")).not.toThrow();
    expect(() => run("**kaputt\n\n> [!secret]")).not.toThrow();
  });

  test("marker-only callout with no content at all renders empty section", () => {
    const tree = run("> [!secret]");
    const node = tree.children[0] as Blockquote;
    expect(dataOf(node).hName).toBe("section");
    expect(node.children).toHaveLength(0);
  });
});
