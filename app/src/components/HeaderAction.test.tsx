// Issue #38: the header triggers („Bearbeiten" for the body, for the campaign
// metadata, „Eigenschaften") were byte-identical copies. What must hold
// is that they STAY one component — so each call site is compared against a
// live render of the equivalent <HeaderAction …/> instead of against frozen
// markup (pinning lucide-react/react-dom byte output would break on every
// dependency bump without a single pixel moving).

import type { FileResponse } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import { PenLine, SlidersHorizontal } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignMetaAction } from "./CampaignMetaAction";
import { FileBodyEditAction } from "./FileBodyEditor";
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
    expect(headerAction("Umbenennen")).toBe(
      headerAction("Bearbeiten").replace("Bearbeiten<", "Umbenennen<"),
    );
  });
});

describe("the call sites", () => {
  test("Bearbeiten of the body editor is the shared trigger", () => {
    expect(renderToStaticMarkup(<FileBodyEditAction onEdit={() => {}} />)).toBe(
      headerAction("Bearbeiten"),
    );
  });

  test("Bearbeiten of the campaign metadata is the shared trigger", () => {
    expect(renderToStaticMarkup(<CampaignMetaAction campaign="beispiel" />)).toBe(
      headerAction("Bearbeiten"),
    );
  });

  test("Eigenschaften (issue #42) is the shared trigger with its own glyph", () => {
    const npc: FileResponse = {
      path: "npcs/jorna",
      kind: "npc",
      properties: { id: "jorna", name: "Jorna" },
      body: "",
      rev: 1,
      raw: "",
    };
    expect(
      renderToStaticMarkup(
        <PropertiesAction campaign="beispiel" file={npc} tree={undefined} />,
      ),
    ).toBe(
      renderToStaticMarkup(
        <HeaderAction icon={SlidersHorizontal} label="Eigenschaften" onClick={() => {}} />,
      ),
    );
  });

  test("no Eigenschaften where there is no typed properties (session, inbox, campaign)", () => {
    for (const kind of ["session", "inbox", "campaign", "glossary"] as const) {
      const file: FileResponse = {
        path: "x",
        kind,
        properties: {},
        body: "",
        rev: 1,
        raw: "",
      };
      expect(
        renderToStaticMarkup(
          <PropertiesAction campaign="beispiel" file={file} tree={undefined} />,
        ),
      ).toBe("");
    }
  });
});
