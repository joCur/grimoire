// The campaign's edit action is the shared header trigger: the one edit
// action of the chapter overview header, with the edit glyph.

import { describe, expect, test } from "bun:test";
import { PenLine } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeaderAction } from "@/components/HeaderAction";

import { CampaignEditAction } from "./CampaignEditAction";

describe("CampaignEditAction", () => {
  test("is the shared trigger named „Bearbeiten“", () => {
    expect(renderToStaticMarkup(<CampaignEditAction campaign="beispiel" />)).toBe(
      renderToStaticMarkup(<HeaderAction icon={PenLine} label="Bearbeiten" onClick={() => {}} />),
    );
  });

  test("renders nothing without a campaign", () => {
    expect(renderToStaticMarkup(<CampaignEditAction campaign="" />)).toBe("");
  });
});
