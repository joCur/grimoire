import { describe, expect, test } from "bun:test";

import { hasNoteInScene, scenesWithNotes } from "./session-scenes";

const note = (id: string, sceneId?: string) => ({
  id,
  at: "19:30",
  ...(sceneId === undefined ? {} : { sceneId }),
  text: "Notiz",
  reviewed: false,
  rev: 1,
});

describe("hasNoteInScene", () => {
  test("a note taken in the scene: true", () => {
    expect(hasNoteInScene({ log: [note("n1", "harbor")] }, "harbor")).toBe(true);
  });

  test("no note, or notes only elsewhere or in no scene: false", () => {
    expect(hasNoteInScene({ log: [] }, "harbor")).toBe(false);
    expect(hasNoteInScene({ log: [note("n1", "tower"), note("n2")] }, "harbor")).toBe(false);
  });
});

describe("scenesWithNotes", () => {
  test("each scene once, in the order of its first note; notes without a scene count for none", () => {
    expect(
      scenesWithNotes({
        log: [note("n1", "tower"), note("n2"), note("n3", "harbor"), note("n4", "tower")],
      }),
    ).toEqual(["tower", "harbor"]);
  });

  test("an empty log names no scene", () => {
    expect(scenesWithNotes({ log: [] })).toEqual([]);
  });
});
