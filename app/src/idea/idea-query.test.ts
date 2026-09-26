// The cached ideas after a write: the idea a write answered takes its place in
// the list, a new one goes to the end.

import { describe, expect, test } from "bun:test";
import type { Idea } from "@grimoire/shared/idea";

import { withIdea } from "./idea-query";

const SEEDED: Idea = {
  id: "village-smith",
  text: "Idea: The village smith repairs smuggling tools suspiciously often #thread",
  done: false,
  rev: 1,
};
const SECOND: Idea = { id: "i-2", text: "Watch the smith", done: false, rev: 1 };

describe("withIdea", () => {
  test("a ticked idea replaces itself in its place", () => {
    const ticked = { ...SEEDED, done: true, rev: 2 };
    expect(withIdea([SEEDED, SECOND], ticked)).toEqual([ticked, SECOND]);
  });

  test("a new idea goes to the end, also of a list not read yet", () => {
    expect(withIdea([SEEDED], SECOND)).toEqual([SEEDED, SECOND]);
    expect(withIdea(undefined, SECOND)).toEqual([SECOND]);
  });
});
