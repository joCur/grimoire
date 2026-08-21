// Issue #38: the three header triggers („Bearbeiten" for the body, für die
// Kampagnen-Metadaten, „Umbenennen") were byte-identical copies. Extracting
// them may not move a single pixel, so the expected markup below is the
// renderToStaticMarkup output of the copies BEFORE the extraction, verbatim.

import { describe, expect, test } from "bun:test";
import { PenLine } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignMetaAction } from "./CampaignMetaAction";
import { FileBodyEditAction } from "./FileBodyEditor";
import { HeaderAction } from "./HeaderAction";
import { RenameAction } from "./RenameAction";

/** The pre-refactoring markup of the quiet header trigger, per label. */
function expectedMarkup(label: string): string {
  return (
    '<button type="button" class="inline-flex flex-none items-center gap-1.5 rounded-md px-1.5 py-1' +
    ' text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="12.5" height="12.5" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
    ' stroke-linejoin="round" class="lucide lucide-pen-line flex-none" aria-hidden="true">' +
    '<path d="M13 21h8"></path><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0' +
    " 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"></path></svg>" +
    `${label}</button>`
  );
}

describe("HeaderAction", () => {
  test("renders the quiet trigger exactly as the three copies did", () => {
    expect(
      renderToStaticMarkup(<HeaderAction icon={PenLine} label="Bearbeiten" onClick={() => {}} />),
    ).toBe(expectedMarkup("Bearbeiten"));
  });

  test("the label is the only thing that varies", () => {
    expect(
      renderToStaticMarkup(<HeaderAction icon={PenLine} label="Umbenennen" onClick={() => {}} />),
    ).toBe(expectedMarkup("Umbenennen"));
  });
});

describe("the three call sites", () => {
  test("Bearbeiten of the body editor is unchanged", () => {
    expect(renderToStaticMarkup(<FileBodyEditAction onEdit={() => {}} />)).toBe(
      expectedMarkup("Bearbeiten"),
    );
  });

  test("Umbenennen is unchanged (closed dialog: only the trigger)", () => {
    expect(
      renderToStaticMarkup(
        <RenameAction
          campaign="beispiel"
          currentPath="npcs/jorna.md"
          target={{ kind: "npc", oldId: "jorna" }}
        />,
      ),
    ).toBe(expectedMarkup("Umbenennen"));
  });

  test("Bearbeiten of the campaign metadata is unchanged", () => {
    expect(renderToStaticMarkup(<CampaignMetaAction campaign="beispiel" />)).toBe(
      expectedMarkup("Bearbeiten"),
    );
  });
});
