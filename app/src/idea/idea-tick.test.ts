// A failed tick of an idea names its reason: a 409 says the idea was changed
// in the meantime, any other failure keeps the surface's own sentence.

import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { translator } from "@/i18n/format";

import { tickFailureKey } from "./idea-tick";

const conflict = new ApiError(409, "idea changed", { code: "rev_conflict", rev: 2 });

describe("tickFailureKey", () => {
  test("a 409 is the stale idea, in the review and in the live aside", () => {
    expect(tickFailureKey(conflict, "review.action.failed")).toBe("idea.tick.stale");
    expect(tickFailureKey(conflict, "live.pc.failed")).toBe("idea.tick.stale");
    expect(translator("de")(tickFailureKey(conflict, "review.action.failed"))).toBe(
      "Diese Idee wurde inzwischen geändert. Die Liste ist neu geladen.",
    );
    expect(translator("en")(tickFailureKey(conflict, "live.pc.failed"))).toBe(
      "This idea was changed in the meantime. The list has been reloaded.",
    );
  });

  test("a server error or a lost connection keeps the surface's sentence", () => {
    expect(tickFailureKey(new ApiError(500, "boom"), "review.action.failed")).toBe(
      "review.action.failed",
    );
    expect(tickFailureKey(new TypeError("Failed to fetch"), "live.pc.failed")).toBe(
      "live.pc.failed",
    );
    expect(translator("de")(tickFailureKey(new ApiError(503, "down"), "live.pc.failed"))).toBe(
      "Nicht gespeichert — Server prüfen.",
    );
  });
});
