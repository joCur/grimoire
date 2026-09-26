// The campaign's form as VALUES: what the dialog starts with, what a save
// sends and when there is nothing to save.

import type { Campaign } from "@grimoire/shared/campaign";
import { describe, expect, test } from "bun:test";

import {
  campaignBodyToWrite,
  campaignFormChange,
  campaignFormValues,
  canSubmitCampaignForm,
  prefillCampaignName,
} from "./campaign-form";

const CAMPAIGN: Campaign = {
  id: "example",
  name: "Salt Harbour",
  description: "Coast",
  body: "\nCampaign-wide notes.\n",
  glossaryIntro: "",
  rev: 3,
};
const initial = campaignFormValues(CAMPAIGN);

describe("campaignFormValues", () => {
  test("the dialog starts with name, description and text as stored", () => {
    expect(initial).toEqual({
      name: "Salt Harbour",
      description: "Coast",
      body: "\nCampaign-wide notes.\n",
    });
  });

  test("a campaign without a description starts with an empty field", () => {
    const { description: _description, ...without } = CAMPAIGN;
    expect(campaignFormValues(without).description).toBe("");
  });
});

describe("campaignFormChange", () => {
  test("an untouched form writes nothing — the stored text is not normalized behind the DM's back", () => {
    expect(campaignFormChange(initial, initial)).toEqual({});
  });

  test("only what moved is sent, trimmed", () => {
    expect(campaignFormChange(initial, { ...initial, name: "  New Harbour  " })).toEqual({
      name: "New Harbour",
    });
    expect(campaignFormChange(initial, { ...initial, description: " Coast " })).toEqual({});
  });

  test("a blank description clears it instead of writing an empty line", () => {
    expect(campaignFormChange(initial, { ...initial, description: "   " })).toEqual({
      description: null,
    });
  });

  test("the text is written as markdown, ending in one newline", () => {
    expect(campaignFormChange(initial, { ...initial, body: "New notes." })).toEqual({
      body: "New notes.\n",
    });
    expect(campaignFormChange(initial, { ...initial, body: "  \n" })).toEqual({ body: "" });
  });

  test("a blank name is left out of the write", () => {
    expect(campaignFormChange(initial, { ...initial, name: "  " })).toEqual({});
  });
});

describe("campaignBodyToWrite", () => {
  test("whitespace around the text is no part of it", () => {
    expect(campaignBodyToWrite("\nNotes.\n\n")).toBe("Notes.\n");
    expect(campaignBodyToWrite("")).toBe("");
  });
});

describe("canSubmitCampaignForm", () => {
  test("the name carries the campaign — blank is not a save", () => {
    expect(canSubmitCampaignForm({ ...initial, name: "" })).toBe(false);
    expect(canSubmitCampaignForm({ ...initial, name: "   " })).toBe(false);
    expect(canSubmitCampaignForm({ ...initial, description: "" })).toBe(true);
  });
});

describe("prefillCampaignName", () => {
  test("a name that IS the id is the server's fallback, not an authored value", () => {
    // The dialog must not propose the id as a name — the server answers it
    // for an unnamed campaign, so the field starts empty and the id is the
    // placeholder.
    expect(prefillCampaignName("example", "example")).toBe("");
    expect(prefillCampaignName("example", undefined)).toBe("");
    expect(prefillCampaignName("example", "Salt Harbour")).toBe("Salt Harbour");
    expect(campaignFormValues({ ...CAMPAIGN, name: "example" }).name).toBe("");
  });
});
