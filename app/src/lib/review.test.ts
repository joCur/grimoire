// Unit tests of the review helpers: the hashtag vocabulary of log rows and
// ideas and the grouping of player-character notes. Rows — threads included —
// arrive from the server and are named by their id, so there is no
// list-out-of-text parsing left to test.

import { describe, expect, test } from "bun:test";

import {
  extractHashtags,
  firstReviewTag,
  groupByPcTag,
  hasPcTag,
  pcGroupTag,
  isReviewTag,
  stripHashtags,
} from "./review";

describe("extractHashtags", () => {
  test("collects hashtags in order, lowercased", () => {
    expect(extractHashtags("Lights in the bay #thread #Loot")).toEqual(["thread", "loot"]);
  });

  test("handles umlauts and digits, ignores lone hashes", () => {
    expect(extractHashtags("Fog oil #björn-cask #date2 # nothing")).toEqual(["björn-cask", "date2"]);
  });

  test("no hashtags yields an empty list", () => {
    expect(extractHashtags("— Break")).toEqual([]);
  });
});

describe("firstReviewTag", () => {
  test("picks the first REVIEW tag, skipping others", () => {
    expect(firstReviewTag("#date Day 4 and #thread open")).toBe("thread");
    expect(firstReviewTag("Tracks found #decision")).toBe("decision");
    expect(firstReviewTag("Improvised: Metta #npc")).toBe("npc");
    expect(firstReviewTag("Chest #loot")).toBe("loot");
  });

  test("undefined without a review tag — those lines stay in the log", () => {
    expect(firstReviewTag("#date Day 4")).toBeUndefined();
    expect(firstReviewTag("— Break")).toBeUndefined();
  });

  test("isReviewTag knows the four harvest tags", () => {
    for (const tag of ["thread", "npc", "loot", "decision"]) expect(isReviewTag(tag)).toBe(true);
    for (const tag of ["date", "idea", ""]) expect(isReviewTag(tag)).toBe(false);
  });

  test("idea rule: the row's tag list keeps every tag in order", () => {
    // use-review names an idea by its first tag, unless a harvest tag
    // appears later in the text.
    expect(extractHashtags("Idea for the harbour #idea #npc")).toEqual(["idea", "npc"]);
  });
});

describe("stripHashtags", () => {
  test("removes hashtags and collapses whitespace", () => {
    expect(stripHashtags("Cliffhanger: Lights in the bay #thread")).toBe(
      "Cliffhanger: Lights in the bay",
    );
    expect(stripHashtags("#thread Lights #loot in the bay")).toBe("Lights in the bay");
  });

  test("a row of nothing but hashtags keeps its text", () => {
    expect(stripHashtags("#thread")).toBe("#thread");
  });
});

describe("player-character notes", () => {
  test("hasPcTag matches the exact tag only", () => {
    expect(hasPcTag(extractHashtags("Item #pc #kaela"))).toBe(true);
    // `#pc` inside a longer tag is a DIFFERENT tag — no match.
    expect(hasPcTag(extractHashtags("Note #pcs"))).toBe(false);
    expect(hasPcTag(extractHashtags("Note #npc"))).toBe(false);
    expect(hasPcTag(extractHashtags("Note without a tag"))).toBe(false);
  });

  test("hasPcTag ignores the writing case (#PC)", () => {
    expect(hasPcTag(extractHashtags("Item #PC"))).toBe(true);
  });

  test("pcGroupTag is the first tag that is not #pc, lowercased", () => {
    expect(pcGroupTag(extractHashtags("Item #pc #Kaela"))).toBe("kaela");
    expect(pcGroupTag(extractHashtags("Item #kaela #pc"))).toBe("kaela");
  });

  test("pcGroupTag is undefined without a second tag", () => {
    expect(pcGroupTag(extractHashtags("Card for everyone #pc"))).toBeUndefined();
  });

  test("pcGroupTag skips the convention tags — those are no character names", () => {
    // The harvest tags (README) and `#date` describe the ROW, not a person.
    expect(pcGroupTag(extractHashtags("Note #pc #thread"))).toBeUndefined();
    expect(pcGroupTag(extractHashtags("Note #npc #pc"))).toBeUndefined();
    expect(pcGroupTag(extractHashtags("Note #pc #date"))).toBeUndefined();
    expect(pcGroupTag(extractHashtags("Note #pc #loot #decision"))).toBeUndefined();
    // …but a character tag next to one of them still wins.
    expect(pcGroupTag(extractHashtags("Note #pc #thread #kaela"))).toBe("kaela");
    expect(pcGroupTag(extractHashtags("Note #pc #kaela #thread"))).toBe("kaela");
  });

  test("a #pc row wins over the harvest tag it also carries", () => {
    // The two predicates the review model branches on, in that order.
    const tags = extractHashtags("Flashback for Kaela #pc #thread");
    expect(hasPcTag(tags)).toBe(true);
    expect(firstReviewTag("Flashback for Kaela #pc #thread")).toBe("thread");
  });

  test("groupByPcTag groups in first-appearance order, the general group last", () => {
    const rows = [
      { text: "Birthday item for Kaela", tags: ["pc", "kaela"] },
      { text: "Prepare the flashback", tags: ["pc", "brann"] },
      { text: "Give everyone a card", tags: ["pc"] },
      { text: "Card for Kaela", tags: ["pc", "kaela"] },
    ];
    const grouped = groupByPcTag(rows, (row) => pcGroupTag(row.tags));
    expect(grouped.map((g) => g.tag)).toEqual(["kaela", "brann", undefined]);
    expect(grouped[0]?.items.map((e) => e.text)).toEqual([
      "Birthday item for Kaela",
      "Card for Kaela",
    ]);
  });

  test("groupByPcTag yields no general group when every entry has a tag", () => {
    const grouped = groupByPcTag(
      [{ tag: "kaela" }, { tag: "kaela" }],
      (entry) => entry.tag,
    );
    expect(grouped).toEqual([{ tag: "kaela", items: [{ tag: "kaela" }, { tag: "kaela" }] }]);
  });

  test("an empty list yields no groups", () => {
    expect(groupByPcTag([], () => undefined)).toEqual([]);
  });
});
