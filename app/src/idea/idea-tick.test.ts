// A failed tick of an idea names its reason: a 409 says the idea was changed
// in the meantime, any other failure keeps the surface's own sentence.

import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";

import { tickFailureKey } from "./idea-tick";

const conflict = new ApiError(409, "idea changed", { code: "rev_conflict", rev: 2 });

describe("tickFailureKey", () => {
  test("a 409 is the stale idea, in the review and in the live aside", () => {
    expect(tickFailureKey(conflict, "review.action.failed")).toBe("idea.tick.stale");
    expect(tickFailureKey(conflict, "live.pc.failed")).toBe("idea.tick.stale");
  });

  test("a server error or a lost connection keeps the surface's sentence", () => {
    expect(tickFailureKey(new ApiError(500, "boom"), "review.action.failed")).toBe(
      "review.action.failed",
    );
    expect(tickFailureKey(new TypeError("Failed to fetch"), "live.pc.failed")).toBe(
      "live.pc.failed",
    );
    expect(tickFailureKey(new ApiError(503, "down"), "live.pc.failed")).toBe("live.pc.failed");
  });
});
