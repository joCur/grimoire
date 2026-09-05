// The session id rule (issue #58 review, finding 1): server and app share ONE
// comparator, because the obvious local shortcut — comparing the ids as
// strings — puts `…-10` before `…-2`.

import { describe, expect, test } from "bun:test";
import {
  compareSessionIdsNewestFirst,
  sessionIdDate,
  sessionIdSeq,
} from "../src/session-id";

/** Newest first, the way both callers use the comparator. */
const sorted = (ids: string[]): string[] => [...ids].sort(compareSessionIdsNewestFirst);

describe("sessionIdDate / sessionIdSeq", () => {
  test("a plain date is its day's first session", () => {
    expect(sessionIdDate("2026-09-06")).toBe("2026-09-06");
    expect(sessionIdSeq("2026-09-06")).toBe(1);
  });

  test("a suffix is the sequence number, multi-digit included", () => {
    expect(sessionIdDate("2026-09-06-2")).toBe("2026-09-06");
    expect(sessionIdSeq("2026-09-06-2")).toBe(2);
    expect(sessionIdSeq("2026-09-06-10")).toBe(10);
  });

  test("a degraded id parses to nothing instead of throwing", () => {
    for (const id of ["", "kaputt", "2026-9-6", "2026-09-06-", "2026-09-06-x"]) {
      expect(sessionIdDate(id)).toBeUndefined();
      expect(sessionIdSeq(id)).toBe(0);
    }
  });
});

describe("compareSessionIdsNewestFirst", () => {
  test("the date decides", () => {
    expect(sorted(["2026-09-06", "2026-09-07", "2025-12-31"])).toEqual([
      "2026-09-07",
      "2026-09-06",
      "2025-12-31",
    ]);
  });

  test("inside a day the sequence decides NUMERICALLY (-10 is newer than -2)", () => {
    expect(sorted(["2026-09-06-2", "2026-09-06", "2026-09-06-10", "2026-09-06-9"])).toEqual([
      "2026-09-06-10",
      "2026-09-06-9",
      "2026-09-06-2",
      "2026-09-06",
    ]);
  });

  test("a later day beats a high sequence on an earlier one", () => {
    expect(sorted(["2026-09-06-10", "2026-09-07"])).toEqual(["2026-09-07", "2026-09-06-10"]);
  });

  test("degraded ids rank last and keep a stable order among themselves", () => {
    expect(sorted(["kaputt", "2026-09-06", "aaa"])).toEqual(["2026-09-06", "aaa", "kaputt"]);
    expect(compareSessionIdsNewestFirst("kaputt", "kaputt")).toBe(0);
  });

  test("the comparator is antisymmetric (a sort can rely on it)", () => {
    const ids = ["2026-09-06", "2026-09-06-2", "2026-09-06-10", "2026-09-07", "kaputt"];
    for (const a of ids) {
      for (const b of ids) {
        const ab = Math.sign(compareSessionIdsNewestFirst(a, b));
        const ba = Math.sign(compareSessionIdsNewestFirst(b, a));
        expect(ab + ba).toBe(0);
        expect(ab === 0).toBe(a === b);
      }
    }
  });
});
