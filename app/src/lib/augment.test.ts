// The review's arithmetic: word diff, line diff, block alignment
// and the body an accept assembles.

import { describe, expect, test } from "bun:test";

import {
  alignBlocks,
  assembleBody,
  defaultAccepted,
  formatFieldValue,
  lineDiff,
  similarity,
  tokenizeWords,
  wordDiff,
} from "./augment";
import { blockMarkdown, blockTreeMarkdown } from "./blocks";

describe("wordDiff", () => {
  test("tokenizing is lossless", () => {
    const text = "The  tower rises\nblack.";
    expect(tokenizeWords(text).join("")).toBe(text);
  });

  test("one changed word is visible as ONE word", () => {
    const tokens = wordDiff("The party reaches the lighthouse", "The party reaches the quay");
    expect(tokens.filter((t) => t.kind === "removed").map((t) => t.text)).toEqual(["lighthouse"]);
    expect(tokens.filter((t) => t.kind === "added").map((t) => t.text)).toEqual(["quay"]);
    // …and the rest is neutral, in one run.
    expect(tokens.filter((t) => t.kind === "same").map((t) => t.text).join("")).toBe(
      "The party reaches the ",
    );
  });

  test("identical text has no highlight at all", () => {
    expect(wordDiff("same", "same")).toEqual([{ text: "same", kind: "same" }]);
  });

  test("the two sides re-join to the two inputs", () => {
    const before = "a b c d e";
    const after = "a x c d y z";
    const tokens = wordDiff(before, after);
    const left = tokens.filter((t) => t.kind !== "added").map((t) => t.text).join("");
    const right = tokens.filter((t) => t.kind !== "removed").map((t) => t.text).join("");
    expect(left).toBe(before);
    expect(right).toBe(after);
  });
});

describe("lineDiff", () => {
  test("an added line is an addition, not a rewrite", () => {
    const diff = lineDiff("one\ntwo\n", "one\ntwo\nthree\n");
    expect(diff.map((d) => d.kind)).toEqual(["same", "same", "added"]);
    expect(diff[2]!.after).toBe("three");
  });

  test("a lightly edited line becomes ONE changed line with a word diff", () => {
    const diff = lineDiff("Jorna waits at the quay\n", "Jorna waits at the lighthouse\n");
    expect(diff).toHaveLength(1);
    expect(diff[0]!.kind).toBe("changed");
    expect(diff[0]!.words?.filter((t) => t.kind === "added").map((t) => t.text)).toEqual([
      "lighthouse",
    ]);
  });

  test("a wholly different line is a remove plus an add", () => {
    const diff = lineDiff("alpha beta gamma\n", "something else entirely here\n");
    expect(diff.map((d) => d.kind)).toEqual(["removed", "added"]);
  });
});

// --- block alignment ------------------------------------------------------------

const CURRENT = [
  "## Flow",
  "",
  "The party reaches the lighthouse at nightfall.",
  "",
  "> [!readaloud] The tower rises black against the evening sky.",
  "",
].join("\n");

describe("alignBlocks", () => {
  test("an untouched body is all `same` and no decision", () => {
    const changes = alignBlocks(CURRENT, CURRENT);
    expect(changes.every((c) => c.kind === "same")).toBe(true);
    expect(defaultAccepted(changes).size).toBe(0);
  });

  test("a new plot thread arrives as ADDED blocks, the existing ones untouched", () => {
    const proposed = `${CURRENT}\n## If: the party asks about the informant\n\nJorna turns curt.\n`;
    const changes = alignBlocks(CURRENT, proposed);
    expect(changes.filter((c) => c.kind === "same")).toHaveLength(3);
    expect(changes.filter((c) => c.kind === "changed")).toHaveLength(0);
    expect(changes.filter((c) => c.kind === "removed")).toHaveLength(0);
    const added = changes.filter((c) => c.kind === "added");
    expect(added).toHaveLength(1);
    expect(blockMarkdown(added[0]!.after!)).toContain("## If: the party asks about the informant");
    // By default, new material is preselected.
    expect(defaultAccepted(changes)).toEqual(new Set(added.map((c) => c.id)));
  });

  test("an added `## If:` section carries its BODY, not just the heading", () => {
    // The card shows one block per decision, so the section the DM accepts
    // has to be READABLE in it — heading and paragraph, including the body
    // that lives in the section's `children`.
    const body = "[[jorna]] turns curt and puts the question off until the next morning.";
    const proposed = `${CURRENT}\n## If: the party asks about the informant\n\n${body}\n`;
    const changes = alignBlocks(CURRENT, proposed);
    const added = changes.filter((c) => c.kind === "added");
    expect(added).toHaveLength(1);
    const shown = blockTreeMarkdown(added[0]!.after!);
    expect(shown).toContain("## If: the party asks about the informant");
    expect(shown).toContain(body);
    // …and accepting it writes exactly that.
    expect(assembleBody(changes, defaultAccepted(changes))).toContain(body);
  });

  test("an `## If:` section whose BODY alone changed is a decision, not `same`", () => {
    // The heading is byte-identical, so the section is compared as a whole,
    // body included, to keep the rewritten branch visible.
    const current = `${CURRENT}\n## If: the party asks about the informant\n\nJorna turns curt.\n`;
    const proposed = current.replace("Jorna turns curt.", "Jorna turns very curt.");
    const changes = alignBlocks(current, proposed);
    const changed = changes.filter((c) => c.kind === "changed");
    expect(changed).toHaveLength(1);
    expect(blockTreeMarkdown(changed[0]!.after!)).toContain("Jorna turns very curt.");
    // A rewrite is never preselected.
    expect(defaultAccepted(changes).size).toBe(0);
  });

  test("a rewritten paragraph is ONE changed block with a word diff", () => {
    const proposed = CURRENT.replace("at nightfall", "shortly before midnight");
    const changes = alignBlocks(CURRENT, proposed);
    const changed = changes.filter((c) => c.kind === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]!.words?.some((t) => t.kind === "added")).toBe(true);
    // …and a changed block is NOT preselected — never a silent overwrite.
    expect(defaultAccepted(changes).has(changed[0]!.id)).toBe(false);
  });

  test("an unrelated drop and add stay two decisions, not one `changed` row", () => {
    // Same position, nothing in common: pairing them positionally would hide
    // the deletion inside a word diff and cost the addition its default.
    const current = "The party waits at the quay.\n\n> [!note] The watch changes at four.\n";
    const proposed =
      "The party waits at the quay.\n\n## If: someone asks about the lighthouse\n\nThey stay silent.\n";
    const changes = alignBlocks(current, proposed);
    expect(changes.filter((c) => c.kind === "changed")).toHaveLength(0);
    expect(changes.filter((c) => c.kind === "removed")).toHaveLength(1);
    const added = changes.filter((c) => c.kind === "added");
    expect(added.length).toBeGreaterThan(0);
    // The addition is taken by default, the removal is not.
    expect(defaultAccepted(changes)).toEqual(new Set(added.map((c) => c.id)));
  });

  test("a genuinely rewritten block at the same position IS one `changed` row", () => {
    const current = "The party waits at the quay for the harbourmaster.\n";
    const proposed = "The party waits at the quay for Harbourmaster Jorna.\n";
    const changes = alignBlocks(current, proposed);
    expect(changes.filter((c) => c.kind === "changed")).toHaveLength(1);
    expect(changes.filter((c) => c.kind === "removed")).toHaveLength(0);
  });

  test("a block the proposal dropped is a `removed` decision, defaulting to keep", () => {
    const proposed = CURRENT.split("\n\n").slice(0, 2).join("\n\n");
    const changes = alignBlocks(CURRENT, proposed);
    expect(changes.some((c) => c.kind === "removed")).toBe(true);
    expect(defaultAccepted(changes).size).toBe(0);
  });
});

describe("similarity", () => {
  test("identical text is 1, unrelated text is near 0", () => {
    expect(similarity("the bay lies still", "the bay lies still")).toBe(1);
    expect(similarity("the bay lies still", "rules for torches")).toBeLessThan(0.2);
  });

  test("a huge pair is measured cheaply instead of quadratically", () => {
    // Past the word-diff bound the bag ratio decides — the LCS on 40k tokens
    // per side would allocate a matrix of 1.6 billion cells.
    const a = Array.from({ length: 40_000 }, (_, i) => `word${i % 97}`).join(" ");
    const b = `${a} and one more sentence`;
    const started = Date.now();
    expect(similarity(a, b)).toBeGreaterThan(0.9);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("assembleBody", () => {
  test("accepting nothing gives the current body back, byte for byte", () => {
    const proposed = `${CURRENT}\n## If: new\n\nText.\n`;
    const changes = alignBlocks(CURRENT, proposed);
    expect(assembleBody(changes, new Set())).toBe(CURRENT);
  });

  test("accepting the default adds the new blocks and nothing else", () => {
    const proposed = `${CURRENT}\n## If: new\n\nText.\n`;
    const changes = alignBlocks(CURRENT, proposed);
    const body = assembleBody(changes, defaultAccepted(changes));
    expect(body).toContain("## If: new");
    expect(body).toContain("The party reaches the lighthouse at nightfall.");
  });

  test("a changed block takes the proposal only when it is accepted", () => {
    const proposed = CURRENT.replace("nightfall", "midnight");
    const changes = alignBlocks(CURRENT, proposed);
    const changed = changes.find((c) => c.kind === "changed")!;
    expect(assembleBody(changes, new Set())).toContain("nightfall");
    expect(assembleBody(changes, new Set([changed.id]))).toContain("midnight");
  });

  test("a removed block only disappears when the removal is accepted", () => {
    const proposed = CURRENT.split("\n\n").slice(0, 2).join("\n\n");
    const changes = alignBlocks(CURRENT, proposed);
    const removed = changes.find((c) => c.kind === "removed")!;
    expect(assembleBody(changes, new Set())).toContain("[!readaloud]");
    expect(assembleBody(changes, new Set([removed.id]))).not.toContain("[!readaloud]");
  });
});

describe("formatFieldValue", () => {
  test("lists and mappings read as one line", () => {
    expect(formatFieldValue(["social", "travel"])).toBe("social, travel");
    expect(formatFieldValue({ wis: "+2" })).toBe("wis: +2");
    expect(formatFieldValue(undefined)).toBe("");
  });
});
