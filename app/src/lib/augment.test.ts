// The review's arithmetic (issue #36): word diff, line diff, block alignment
// and the body an accept assembles.

import { describe, expect, test } from "bun:test";

import {
  alignBlocks,
  assembleBody,
  defaultAccepted,
  formatPropertyValue,
  lineDiff,
  similarity,
  tokenizeWords,
  wordDiff,
} from "./augment";
import { blockMarkdown, blockTreeMarkdown } from "./blocks";

describe("wordDiff", () => {
  test("tokenizing is lossless", () => {
    const text = "Der  Turm ragt\nschwarz auf.";
    expect(tokenizeWords(text).join("")).toBe(text);
  });

  test("one changed word is visible as ONE word", () => {
    const tokens = wordDiff("Die Gruppe erreicht den Leuchtturm", "Die Gruppe erreicht den Kai");
    expect(tokens.filter((t) => t.kind === "removed").map((t) => t.text)).toEqual(["Leuchtturm"]);
    expect(tokens.filter((t) => t.kind === "added").map((t) => t.text)).toEqual(["Kai"]);
    // …and the rest is neutral, in one run.
    expect(tokens.filter((t) => t.kind === "same").map((t) => t.text).join("")).toBe(
      "Die Gruppe erreicht den ",
    );
  });

  test("identical text has no highlight at all", () => {
    expect(wordDiff("gleich", "gleich")).toEqual([{ text: "gleich", kind: "same" }]);
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
    const diff = lineDiff("eins\nzwei\n", "eins\nzwei\ndrei\n");
    expect(diff.map((d) => d.kind)).toEqual(["same", "same", "added"]);
    expect(diff[2]!.after).toBe("drei");
  });

  test("a lightly edited line becomes ONE changed line with a word diff", () => {
    const diff = lineDiff("Jorna wartet am Kai\n", "Jorna wartet am Leuchtturm\n");
    expect(diff).toHaveLength(1);
    expect(diff[0]!.kind).toBe("changed");
    expect(diff[0]!.words?.filter((t) => t.kind === "added").map((t) => t.text)).toEqual([
      "Leuchtturm",
    ]);
  });

  test("a wholly different line is a remove plus an add", () => {
    const diff = lineDiff("alpha beta gamma\n", "ganz etwas anderes hier\n");
    expect(diff.map((d) => d.kind)).toEqual(["removed", "added"]);
  });
});

// --- block alignment ------------------------------------------------------------

const CURRENT = [
  "## Flow",
  "",
  "Die Gruppe erreicht den Leuchtturm bei Einbruch der Dunkelheit.",
  "",
  "> [!readaloud] Der Turm ragt schwarz gegen den Abendhimmel auf.",
  "",
].join("\n");

describe("alignBlocks", () => {
  test("an untouched body is all `same` and no decision", () => {
    const changes = alignBlocks(CURRENT, CURRENT);
    expect(changes.every((c) => c.kind === "same")).toBe(true);
    expect(defaultAccepted(changes).size).toBe(0);
  });

  test("a new plot thread arrives as ADDED blocks, the existing ones untouched", () => {
    const proposed = `${CURRENT}\n## If: die Gruppe fragt nach dem Spitzel\n\nJorna wird einsilbig.\n`;
    const changes = alignBlocks(CURRENT, proposed);
    expect(changes.filter((c) => c.kind === "same")).toHaveLength(3);
    expect(changes.filter((c) => c.kind === "changed")).toHaveLength(0);
    expect(changes.filter((c) => c.kind === "removed")).toHaveLength(0);
    const added = changes.filter((c) => c.kind === "added");
    expect(added).toHaveLength(1);
    expect(blockMarkdown(added[0]!.after!)).toContain("## If: die Gruppe fragt nach dem Spitzel");
    // AK2 default: new material is preselected.
    expect(defaultAccepted(changes)).toEqual(new Set(added.map((c) => c.id)));
  });

  test("an added `## If:` section carries its BODY, not just the heading", () => {
    // The card shows one block per decision, so the section the DM accepts
    // has to be READABLE in it — heading and paragraph. Before this the
    // section's body lived in `children` and no card ever printed it.
    const body = "[[jorna]] wird einsilbig und schiebt die Frage auf den nächsten Morgen.";
    const proposed = `${CURRENT}\n## If: die Gruppe fragt nach dem Spitzel\n\n${body}\n`;
    const changes = alignBlocks(CURRENT, proposed);
    const added = changes.filter((c) => c.kind === "added");
    expect(added).toHaveLength(1);
    const shown = blockTreeMarkdown(added[0]!.after!);
    expect(shown).toContain("## If: die Gruppe fragt nach dem Spitzel");
    expect(shown).toContain(body);
    // …and accepting it writes exactly that.
    expect(assembleBody(changes, defaultAccepted(changes))).toContain(body);
  });

  test("an `## If:` section whose BODY alone changed is a decision, not `same`", () => {
    // The heading is byte-identical; aligning on the heading line alone made
    // the rewritten branch invisible.
    const current = `${CURRENT}\n## If: die Gruppe fragt nach dem Spitzel\n\nJorna wird einsilbig.\n`;
    const proposed = current.replace("Jorna wird einsilbig.", "Jorna wird sehr einsilbig.");
    const changes = alignBlocks(current, proposed);
    const changed = changes.filter((c) => c.kind === "changed");
    expect(changed).toHaveLength(1);
    expect(blockTreeMarkdown(changed[0]!.after!)).toContain("Jorna wird sehr einsilbig.");
    // A rewrite is never preselected.
    expect(defaultAccepted(changes).size).toBe(0);
  });

  test("a rewritten paragraph is ONE changed block with a word diff", () => {
    const proposed = CURRENT.replace("bei Einbruch der Dunkelheit", "kurz vor Mitternacht");
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
    const current = "Die Gruppe wartet am Kai.\n\n> [!note] Der Wachwechsel ist um vier.\n";
    const proposed =
      "Die Gruppe wartet am Kai.\n\n## If: jemand fragt nach dem Leuchtturm\n\nSie schweigen.\n";
    const changes = alignBlocks(current, proposed);
    expect(changes.filter((c) => c.kind === "changed")).toHaveLength(0);
    expect(changes.filter((c) => c.kind === "removed")).toHaveLength(1);
    const added = changes.filter((c) => c.kind === "added");
    expect(added.length).toBeGreaterThan(0);
    // The addition keeps its „übernehmen" default, the removal has none.
    expect(defaultAccepted(changes)).toEqual(new Set(added.map((c) => c.id)));
  });

  test("a genuinely rewritten block at the same position IS one `changed` row", () => {
    const current = "Die Gruppe wartet am Kai auf die Hafenmeisterin.\n";
    const proposed = "Die Gruppe wartet am Kai auf die Hafenmeisterin Jorna.\n";
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
    expect(similarity("die Bucht liegt still", "die Bucht liegt still")).toBe(1);
    expect(similarity("die Bucht liegt still", "Regeln für Fackeln")).toBeLessThan(0.2);
  });

  test("a huge pair is measured cheaply instead of quadratically", () => {
    // Past the word-diff bound the bag ratio decides — the LCS on 40k tokens
    // per side would allocate a matrix of 1.6 billion cells.
    const a = Array.from({ length: 40_000 }, (_, i) => `wort${i % 97}`).join(" ");
    const b = `${a} und noch ein Satz`;
    const started = Date.now();
    expect(similarity(a, b)).toBeGreaterThan(0.9);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("assembleBody", () => {
  test("accepting nothing gives the current body back, byte for byte", () => {
    const proposed = `${CURRENT}\n## If: neu\n\nText.\n`;
    const changes = alignBlocks(CURRENT, proposed);
    expect(assembleBody(changes, new Set())).toBe(CURRENT);
  });

  test("accepting the default adds the new blocks and nothing else", () => {
    const proposed = `${CURRENT}\n## If: neu\n\nText.\n`;
    const changes = alignBlocks(CURRENT, proposed);
    const body = assembleBody(changes, defaultAccepted(changes));
    expect(body).toContain("## If: neu");
    expect(body).toContain("Die Gruppe erreicht den Leuchtturm bei Einbruch der Dunkelheit.");
  });

  test("a changed block takes the proposal only when it is accepted", () => {
    const proposed = CURRENT.replace("Einbruch der Dunkelheit", "Mitternacht");
    const changes = alignBlocks(CURRENT, proposed);
    const changed = changes.find((c) => c.kind === "changed")!;
    expect(assembleBody(changes, new Set())).toContain("Einbruch der Dunkelheit");
    expect(assembleBody(changes, new Set([changed.id]))).toContain("Mitternacht");
  });

  test("a removed block only disappears when the removal is accepted", () => {
    const proposed = CURRENT.split("\n\n").slice(0, 2).join("\n\n");
    const changes = alignBlocks(CURRENT, proposed);
    const removed = changes.find((c) => c.kind === "removed")!;
    expect(assembleBody(changes, new Set())).toContain("[!readaloud]");
    expect(assembleBody(changes, new Set([removed.id]))).not.toContain("[!readaloud]");
  });
});

describe("formatPropertyValue", () => {
  test("lists and mappings read as one line", () => {
    expect(formatPropertyValue(["social", "travel"])).toBe("social, travel");
    expect(formatPropertyValue({ wis: "+2" })).toBe("wis: +2");
    expect(formatPropertyValue(undefined)).toBe("");
  });
});
