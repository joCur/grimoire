// Build handshake predicate (issue #24 AK4). The rule matters more than it
// looks: a wrong "true" nags the GM forever, a wrong "false" hides the very
// crash the banner exists for.

import { beforeEach, describe, expect, test } from "bun:test";

import {
  APP_BUILD,
  getStaleBuild,
  isStaleBuild,
  reportServerBuild,
  resetStaleBuild,
} from "./build-id";

describe("isStaleBuild", () => {
  test("differing burned-in ids are stale", () => {
    expect(isStaleBuild("aaa", "bbb")).toBe(true);
    expect(isStaleBuild("0f1e2d3", "9c8b7a6")).toBe(true);
  });

  test("equal ids are not stale", () => {
    expect(isStaleBuild("aaa", "aaa")).toBe(false);
    expect(isStaleBuild("dev", "dev")).toBe(false); // AK3: dev == dev, no banner
  });

  test("either side on dev skips the check", () => {
    // Vite dev bundle against a deployed server, and a locally started server
    // serving a production bundle — both are valid local setups.
    expect(isStaleBuild("dev", "bbb")).toBe(false);
    expect(isStaleBuild("aaa", "dev")).toBe(false);
  });

  test("a missing or empty server id skips the check", () => {
    // An older server without the field, or an env var set to whitespace.
    expect(isStaleBuild("aaa", undefined)).toBe(false);
    expect(isStaleBuild("aaa", "")).toBe(false);
    expect(isStaleBuild("", "bbb")).toBe(false);
  });
});

describe("reportServerBuild", () => {
  beforeEach(() => resetStaleBuild());

  test("the bundle's own build id is dev outside a Vite build", () => {
    // Which is why the flag can only be driven with an explicit appBuild here.
    expect(APP_BUILD).toBe("dev");
  });

  test("does not flip for matching or dev builds", () => {
    reportServerBuild("dev");
    reportServerBuild("bbb", "bbb");
    reportServerBuild(undefined, "aaa");
    expect(getStaleBuild()).toBe(false);
  });

  test("flips on a mismatch and stays flipped", () => {
    reportServerBuild("bbb", "aaa");
    expect(getStaleBuild()).toBe(true);
    // A later poll that happens to match again must not un-show the banner:
    // the tab is still running the old bundle either way.
    reportServerBuild("aaa", "aaa");
    expect(getStaleBuild()).toBe(true);
  });
});
