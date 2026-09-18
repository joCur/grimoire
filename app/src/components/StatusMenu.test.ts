// The no-op filter of the status menu.
//
// A radio group reports every select, the one of the already-checked option
// included — and for the chapter's `active` that select is not a null write
// but a SWAP of two chapters, which pulls the flag back off the chapter the DM
// just picked. The predicate is what the menu asks before it writes; the
// render side of the control lives in ChapterStatusMenu.test.tsx /
// SceneStatusMenu.test.tsx.

import { describe, expect, test } from "bun:test";

import { statusSelectionWrites } from "./StatusMenu";

describe("statusSelectionWrites", () => {
  test("a different value is a change", () => {
    expect(statusSelectionWrites("active", "planned")).toBe(true);
    expect(statusSelectionWrites("done", "active")).toBe(true);
  });

  test("the value already shown is not", () => {
    expect(statusSelectionWrites("active", "active")).toBe(false);
    expect(statusSelectionWrites("planned", "planned")).toBe(false);
  });

  test("while a write runs, its TARGET is the value shown", () => {
    // The trigger already reads „Aktiv" (dimmed) — selecting it again is the
    // same no-op, not a second swap.
    expect(statusSelectionWrites("active", "planned", "active")).toBe(false);
    // …and the stored value is selectable again, which is how a DM takes it
    // back while the write is still in flight.
    expect(statusSelectionWrites("planned", "planned", "active")).toBe(true);
  });
});
