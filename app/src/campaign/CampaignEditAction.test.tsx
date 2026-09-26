// The campaign's edit action is the shared header trigger: the one edit
// action of the chapter overview header, with the edit glyph.

import { describe, expect, test } from "bun:test";
import { PenLine } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeaderAction } from "@/components/HeaderAction";
import { translator } from "@/i18n/format";

import { CampaignEditAction } from "./CampaignEditAction";

const t = translator("de");

describe("CampaignEditAction", () => {
  test("is the shared trigger named by the common edit label", () => {
    expect(renderToStaticMarkup(<CampaignEditAction campaign="example" />)).toBe(
      renderToStaticMarkup(<HeaderAction icon={PenLine} label={t("common.edit")} onClick={() => {}} />),
    );
  });

  test("renders nothing without a campaign", () => {
    expect(renderToStaticMarkup(<CampaignEditAction campaign="" />)).toBe("");
  });
});
