// The campaign name and description as VALUES: what a save sends for them and
// when there is nothing to save. The write itself is the shared editing
// session (lib/use-entry-edit.ts), so nothing here talks to the server.

import { describe, expect, test } from "bun:test";

import { campaignMetaPatch, canSubmitCampaignMeta, prefillCampaignName } from "./campaign-meta";

describe("campaignMetaPatch", () => {
  test("trims both values", () => {
    expect(campaignMetaPatch({ name: "  Salzhafen  ", description: " Küste " })).toEqual({
      name: "Salzhafen",
      description: "Küste",
    });
  });

  test("a blank description DELETES the key instead of writing an empty line", () => {
    expect(campaignMetaPatch({ name: "Salzhafen", description: "   " })).toEqual({
      name: "Salzhafen",
      description: null,
    });
  });
});

describe("canSubmitCampaignMeta", () => {
  test("the name carries the campaign — blank is not a save", () => {
    expect(canSubmitCampaignMeta({ name: "", description: "x" })).toBe(false);
    expect(canSubmitCampaignMeta({ name: "   ", description: "x" })).toBe(false);
    expect(canSubmitCampaignMeta({ name: "Salzhafen", description: "" })).toBe(true);
  });
});

describe("prefillCampaignName", () => {
  test("a name that IS the id is the server's fallback, not an authored value", () => {
    // The dialog must not propose the id as a name — both endpoints
    // synthesize it, so the field starts empty and the id is the placeholder.
    expect(prefillCampaignName("beispiel", "beispiel")).toBe("");
    expect(prefillCampaignName("beispiel", undefined)).toBe("");
    expect(prefillCampaignName("beispiel", "Salzhafen")).toBe("Salzhafen");
  });
});
