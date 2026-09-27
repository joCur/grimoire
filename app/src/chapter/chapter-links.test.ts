import { describe, expect, test } from "bun:test";

import { chapterHref, chapterLabel } from "./chapter-links";

describe("where a chapter lives", () => {
  test("its reading view is its own route, by id", () => {
    expect(chapterHref("example", "01-salt-harbour")).toBe("/campaigns/example/chapters/01-salt-harbour");
    expect(chapterHref("example", "a b")).toBe("/campaigns/example/chapters/a%20b");
  });

  test("it names itself by its resource segment and id", () => {
    expect(chapterLabel("01-salt-harbour")).toBe("chapters/01-salt-harbour");
  });
});
