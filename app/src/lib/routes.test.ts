// The non-campaign segments (issue #69, PR #83 review).

import { describe, expect, test } from "bun:test";

import { NON_CAMPAIGN_SEGMENTS, nonCampaignRedirect } from "./routes";

describe("nonCampaignRedirect", () => {
  test("a campaign id is left alone — that is the normal case", () => {
    for (const id of ["beispiel", "01-salzhafen", "settings-of-doom", "development"]) {
      expect(nonCampaignRedirect(id)).toBeUndefined();
    }
  });

  test("`settings` goes to the settings page, `dev` to the start", () => {
    expect(nonCampaignRedirect("settings")).toBe("/settings");
    expect(nonCampaignRedirect("dev")).toBe("/");
  });

  test("every segment has a target — a listed one without is a dead end", () => {
    // The two lists are one contract: the topbar keeps its chrome off these
    // segments, the campaign scope has to send them somewhere. Each target is
    // a route of its own ("/" and "/settings" are declared in App.tsx above
    // `:campaign`), so no redirect can come back through here.
    for (const segment of NON_CAMPAIGN_SEGMENTS) {
      expect(nonCampaignRedirect(segment), segment).toBeDefined();
    }
  });
});
