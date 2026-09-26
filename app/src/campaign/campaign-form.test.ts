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
  id: "beispiel",
  name: "Salzhafen",
  description: "Küste",
  body: "\nKampagnenweite Notizen.\n",
  glossaryIntro: "",
  rev: 3,
};
const initial = campaignFormValues(CAMPAIGN);

describe("campaignFormValues", () => {
  test("the dialog starts with name, description and text as stored", () => {
    expect(initial).toEqual({
      name: "Salzhafen",
      description: "Küste",
      body: "\nKampagnenweite Notizen.\n",
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
    expect(campaignFormChange(initial, { ...initial, name: "  Neuhafen  " })).toEqual({
      name: "Neuhafen",
    });
    expect(campaignFormChange(initial, { ...initial, description: " Küste " })).toEqual({});
  });

  test("a blank description clears it instead of writing an empty line", () => {
    expect(campaignFormChange(initial, { ...initial, description: "   " })).toEqual({
      description: null,
    });
  });

  test("the text is written as markdown, ending in one newline", () => {
    expect(campaignFormChange(initial, { ...initial, body: "Neue Notizen." })).toEqual({
      body: "Neue Notizen.\n",
    });
    expect(campaignFormChange(initial, { ...initial, body: "  \n" })).toEqual({ body: "" });
  });

  test("a blank name is left out of the write", () => {
    expect(campaignFormChange(initial, { ...initial, name: "  " })).toEqual({});
  });
});

describe("campaignBodyToWrite", () => {
  test("whitespace around the text is no part of it", () => {
    expect(campaignBodyToWrite("\nNotizen.\n\n")).toBe("Notizen.\n");
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
    expect(prefillCampaignName("beispiel", "beispiel")).toBe("");
    expect(prefillCampaignName("beispiel", undefined)).toBe("");
    expect(prefillCampaignName("beispiel", "Salzhafen")).toBe("Salzhafen");
    expect(campaignFormValues({ ...CAMPAIGN, name: "beispiel" }).name).toBe("");
  });
});
