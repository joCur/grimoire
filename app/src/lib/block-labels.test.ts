// The labels of the block types come from the catalog and the translator is
// passed in (decisions/i18n): a callout is named with the key the reading view
// uses.

import { describe, expect, test } from "bun:test";
import { makeCallout, makeHeading, makeIfSection, makeText, parseBlocks } from "@grimoire/shared/blocks";

import { translator } from "@/i18n/format";

import { blockLabel, calloutLabel } from "./block-labels";

const t = translator("de");

describe("labels", () => {
  test("the six callouts use the names the reading view already shows", () => {
    const kinds = ["readaloud", "check", "secret", "outcome", "loot", "note"] as const;
    const expected = kinds.map((kind) => t(`markdown.callout.${kind}`));
    expect(kinds.map((kind) => blockLabel(makeCallout(kind, "x"), t))).toEqual(expected);
    expect(kinds.map((kind) => calloutLabel(kind, t))).toEqual(expected);
  });

  test("structural blocks are named by their block type", () => {
    expect(blockLabel(makeIfSection("a"), t)).toBe(t("composer.blockType.ifSection"));
    expect(blockLabel(makeHeading(2, "Flow"), t)).toBe(t("composer.blockType.heading"));
    expect(blockLabel(makeText("Paragraph"), t)).toBe(t("composer.blockType.text"));
    const raw = parseBlocks("> [!warning] x\n")[0];
    if (raw === undefined) throw new Error("expected a block");
    expect(blockLabel(raw, t)).toBe(t("composer.blockType.markdown"));
  });
});
