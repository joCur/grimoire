// A patch changes the anchored block and nothing else: every other byte of
// the body — blank-line runs, wrapping, the leading blank line, the trailing
// newline — stays as it was. Checked over the reference scenes, which carry
// every shape the format has.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { blockTreeMarkdown, parseBlocks, type SceneBlock } from "../src/blocks";
import { applyBodyOperation, findAnchor } from "../src/body-patch";

function sceneBody(id: string): string {
  const raw = readFileSync(new URL(`../../fixtures/scenes/${id}.json`, import.meta.url), "utf8");
  return (JSON.parse(raw) as { body: string }).body;
}

/** Every block of a body in reading order, each with its full markdown. */
function flatMarkdown(body: string): string[] {
  const out: string[] = [];
  const walk = (block: SceneBlock): void => {
    out.push(blockTreeMarkdown(block));
    if (block.type === "ifSection") block.children.forEach(walk);
  };
  parseBlocks(body).forEach(walk);
  return out;
}

const captured = sceneBody("smuggler-captured");
const arrival = sceneBody("lighthouse-arrival");

const CHECK =
  "> [!check] Charisma (Deception) of each character vs. Fenn's\n> Wisdom (Insight) +2. Advantage/Disadvantage by plausibility,\n> for each character separately.";

describe("applyBodyOperation", () => {
  test("a replace inside an If section changes only that block, byte for byte", () => {
    const result = applyBodyOperation(captured, {
      op: "replace",
      anchor: CHECK,
      text: "> [!check] Charisma (Deception) DC 15.",
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.body).toBe(captured.replace(CHECK, "> [!check] Charisma (Deception) DC 15."));
    const before = flatMarkdown(captured);
    const after = flatMarkdown(result.body);
    expect(after.length).toBe(before.length);
    const changed = before.flatMap((markdown, index) => (after[index] === markdown ? [] : [index]));
    // The check itself and the section holding it — nothing else.
    expect(changed.map((index) => before[index]!.split("\n")[0])).toEqual([
      "## If: they lie (shipwrecked, lost travellers ...)",
      "> [!check] Charisma (Deception) of each character vs. Fenn's",
    ]);
  });

  test("the anchor is compared with whitespace read as one space", () => {
    const anchor = CHECK.replace(/\n/g, "   \n  ").replace(/ vs\. /, "\tvs.  ");
    const result = applyBodyOperation(captured, { op: "remove", anchor });
    expect(result.ok).toBe(true);
  });

  test("an insert puts a block of its own after the anchored one", () => {
    const anchor = "> [!secret] The lighthouse keeper has not vanished — he is held in\n> the cove so the beacon stays dark.";
    const result = applyBodyOperation(arrival, {
      op: "insertAfter",
      anchor,
      text: "\n> [!loot] A brass key.\n\n",
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.body).toBe(arrival.replace(anchor, `${anchor}\n\n> [!loot] A brass key.`));
  });

  test("a remove takes the block and its separator, and nothing else", () => {
    const paragraph = "The party reaches the lighthouse at nightfall.\nHarbourmaster Jorna waits at the foot of the stairs — she hired the party\nand wants to see results.";
    const result = applyBodyOperation(arrival, { op: "remove", anchor: paragraph });
    if (!result.ok) throw new Error(result.reason);
    expect(result.body).toBe(arrival.replace(`${paragraph}\n\n`, ""));
  });

  test("removing the last block keeps the body's own ending", () => {
    const outcome = "> [!outcome] After this scene Fenn knows the party's faces —\n> however it ends.";
    const result = applyBodyOperation(captured, { op: "remove", anchor: outcome });
    if (!result.ok) throw new Error(result.reason);
    expect(result.body).toBe(captured.replace(`\n\n${outcome}\n`, "\n"));
  });

  test("a whole If section is one anchor, its heading and everything it holds", () => {
    const section = captured.slice(
      captured.indexOf("## If: they admit"),
      captured.indexOf("\n\n## If: they lie"),
    );
    expect(findAnchor(captured, section)).toEqual({ ok: true, markdown: section });
    const result = applyBodyOperation(captured, { op: "remove", anchor: section });
    if (!result.ok) throw new Error(result.reason);
    expect(result.body).toBe(captured.replace(`${section}\n\n`, ""));
  });

  test("a CRLF body gets the new text with its own line ending", () => {
    const body = "First.\r\n\r\nSecond.\r\n";
    const result = applyBodyOperation(body, { op: "replace", anchor: "Second.", text: "Two\nlines." });
    expect(result).toEqual({ ok: true, body: "First.\r\n\r\nTwo\r\nlines.\r\n" });
  });
});

describe("an anchor that does not hit exactly one block", () => {
  test("missing: nothing changes", () => {
    expect(
      applyBodyOperation(arrival, { op: "replace", anchor: "The keeper waves from the top.", text: "x" }),
    ).toEqual({ ok: false, reason: "missing" });
    expect(findAnchor(arrival, "")).toEqual({ ok: false, reason: "missing" });
  });

  test("a part of a block is not an anchor", () => {
    expect(applyBodyOperation(arrival, { op: "remove", anchor: "The party reaches the lighthouse at nightfall." })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  test("ambiguous: two identical blocks, nothing changes", () => {
    const body = "## Flow\n\nSame.\n\nSame.\n";
    expect(applyBodyOperation(body, { op: "remove", anchor: "Same." })).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });

  test("a replace without text is not applied", () => {
    expect(applyBodyOperation(arrival, { op: "replace", anchor: "## Flow", text: " \n " })).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});
