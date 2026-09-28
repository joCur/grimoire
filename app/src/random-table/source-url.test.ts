import { describe, expect, test } from "bun:test";

import { sourceFileUrl } from "./source-url";

describe("sourceFileUrl", () => {
  test("a GitHub file page is read from its raw address", () => {
    expect(
      sourceFileUrl(
        "https://github.com/TheGiddyLimit/homebrew/blob/master/table/Raging%20Swan%3B%20Tables.json",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/TheGiddyLimit/homebrew/master/table/Raging%20Swan%3B%20Tables.json",
    );
  });

  test("any other address is taken as it is, trimmed", () => {
    expect(sourceFileUrl("  https://example.org/tables.json ")).toBe(
      "https://example.org/tables.json",
    );
  });
});
