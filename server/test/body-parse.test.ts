// The log line hash, unit level: the identity the review's `reviewed` flag
// is keyed by. The log append and the review action must compute it alike,
// so the algorithm is pinned here instead of being derived twice.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { logLineShortHash } from "../src/store/body-parse";

describe("logLineShortHash", () => {
  test("the hash is the one the review wrote — over the line as stored", () => {
    const line = "- 19:52 (arrival) Spuren gefunden";
    const expected = createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);
    expect(logLineShortHash(line)).toBe(expected);
  });
});
