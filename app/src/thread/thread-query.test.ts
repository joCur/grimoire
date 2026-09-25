// The cached threads of a chapter after a write: the thread a write answered
// takes its place in the list, a new one goes to the end, a deleted one leaves.

import { describe, expect, test } from "bun:test";
import type { Thread } from "@grimoire/shared/thread";

import { withThread, withoutThread } from "./thread-query";

const SEEDED: Thread = {
  id: "wer-bezahlt-die-schmuggler",
  chapter: "01-salzhafen",
  text: "Wer bezahlt die Schmuggler?",
  done: false,
  rev: 1,
};
const SECOND: Thread = { ...SEEDED, id: "t-2", text: "Lichter in der Bucht" };

describe("withThread", () => {
  test("a written thread replaces itself in its place", () => {
    const ticked = { ...SEEDED, done: true, rev: 2 };
    expect(withThread([SEEDED, SECOND], ticked)).toEqual([ticked, SECOND]);
  });

  test("a new thread goes to the end, also of a list not read yet", () => {
    expect(withThread([SEEDED], SECOND)).toEqual([SEEDED, SECOND]);
    expect(withThread(undefined, SECOND)).toEqual([SECOND]);
  });
});

describe("withoutThread", () => {
  test("the deleted thread leaves, the rest keeps its order", () => {
    expect(withoutThread([SEEDED, SECOND], SEEDED.id)).toEqual([SECOND]);
    expect(withoutThread(undefined, SEEDED.id)).toEqual([]);
  });
});
