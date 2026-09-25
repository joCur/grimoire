// The header triggers of the reading view — the edit action for the body, the
// campaign dialog, the properties action — are ONE component. That is what is
// asserted here: each call site is compared against a live render of the
// equivalent <HeaderAction …/> instead of against frozen markup (pinning
// lucide-react/react-dom byte output would break on every dependency bump
// without a single pixel moving).

import type { EntryResponse } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import { PenLine, SlidersHorizontal } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignMetaAction } from "./CampaignMetaAction";
import { EntryBodyEditAction } from "./EntryBodyEditor";
import { PropertiesAction } from "./PropertiesAction";
import { HeaderAction } from "./HeaderAction";

/** The shared trigger with the icon all three call sites use. */
function headerAction(label: string): string {
  return renderToStaticMarkup(<HeaderAction icon={PenLine} label={label} onClick={() => {}} />);
}

describe("HeaderAction", () => {
  test("is the quiet header trigger: a plain button, decorative icon, label", () => {
    // The one explicit assertion on the shape — the class list is the thing
    // the three copies used to drift apart in.
    expect(headerAction("Bearbeiten")).toStartWith(
      '<button type="button" class="inline-flex flex-none items-center gap-1.5 rounded-md px-1.5 py-1' +
        ' text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">' +
        "<svg ",
    );
    expect(headerAction("Bearbeiten")).toEndWith("</svg>Bearbeiten</button>");
    // The glyph carries no meaning of its own; the label does.
    expect(headerAction("Bearbeiten")).toContain('aria-hidden="true"');
  });

  test("the label is the only thing that varies", () => {
    expect(headerAction("Eigenschaften")).toBe(
      headerAction("Bearbeiten").replace("Bearbeiten<", "Eigenschaften<"),
    );
  });
});

describe("the call sites", () => {
  test("Bearbeiten of the body editor is the shared trigger", () => {
    expect(renderToStaticMarkup(<EntryBodyEditAction onEdit={() => {}} />)).toBe(
      headerAction("Bearbeiten"),
    );
  });

  test("Bearbeiten of the campaign dialog is the shared trigger", () => {
    expect(renderToStaticMarkup(<CampaignMetaAction campaign="beispiel" />)).toBe(
      headerAction("Bearbeiten"),
    );
  });

  test("the campaign dialog takes the properties name next to the body editor", () => {
    expect(renderToStaticMarkup(<CampaignMetaAction campaign="beispiel" as="properties" />)).toBe(
      renderToStaticMarkup(
        <HeaderAction icon={SlidersHorizontal} label="Eigenschaften" onClick={() => {}} />,
      ),
    );
  });

  test("Eigenschaften is the shared trigger with its own glyph", () => {
    const chapter: EntryResponse = {
      path: "01-salzhafen",
      kind: "chapter",
      properties: { id: "01-salzhafen", title: "Salzhafen" },
      body: "",
      rev: 1,
    };
    expect(
      renderToStaticMarkup(
        <PropertiesAction campaign="beispiel" entry={chapter} />,
      ),
    ).toBe(
      renderToStaticMarkup(
        <HeaderAction icon={SlidersHorizontal} label="Eigenschaften" onClick={() => {}} />,
      ),
    );
  });

  test("no properties action on the campaign — it has no typed fields", () => {
    // The campaign is the only entry kind without a properties form; its
    // metadata has its own dialog. Sessions, ideas and the glossary are lists
    // and never reach this view at all (ADR #26).
    const entry: EntryResponse = {
      path: "campaign",
      kind: "campaign",
      properties: {},
      body: "",
      rev: 1,
    };
    expect(
      renderToStaticMarkup(<PropertiesAction campaign="beispiel" entry={entry} />),
    ).toBe("");
  });
});
