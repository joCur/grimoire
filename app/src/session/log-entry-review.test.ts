// A failed review of a log entry names its reason: a 409 says the entry was
// changed in the meantime, any other failure keeps the surface's own sentence.

import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { translator } from "@/i18n/format";

import { reviewFailureKey } from "./log-entry-review";

const conflict = new ApiError(409, "log entry changed", { code: "rev_conflict", rev: 2 });

describe("reviewFailureKey", () => {
  test("a 409 is the stale log entry, in the review and in the live aside", () => {
    expect(reviewFailureKey(conflict, "review.action.failed")).toBe("session.log.review.stale");
    expect(translator("de")(reviewFailureKey(conflict, "live.pc.failed"))).toBe(
      "Diese Notiz wurde inzwischen anderswo geändert. Die Session ist neu geladen.",
    );
    expect(translator("en")(reviewFailureKey(conflict, "live.pc.failed"))).toBe(
      "This note was changed elsewhere in the meantime. The session has been reloaded.",
    );
  });

  test("a server error or a lost connection keeps the surface's sentence", () => {
    expect(reviewFailureKey(new ApiError(500, "boom"), "review.action.failed")).toBe(
      "review.action.failed",
    );
    expect(reviewFailureKey(new TypeError("Failed to fetch"), "live.pc.failed")).toBe(
      "live.pc.failed",
    );
  });
});
