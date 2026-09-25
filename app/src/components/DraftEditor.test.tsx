// Render test of the draft editor (react-dom/server — no DOM).
//
// What must hold is that a proposed scene is edited as a written one is: the
// field list of its kind with the labels of the properties dialog, its
// address as a read-only id, and the body on the body editor's surfaces —
// nothing that asks the DM to read or write a properties block.

import type { CampaignTree } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DraftEditor } from "./DraftEditor";

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [],
  npcs: [{ id: "fenn", name: "Fenn", status: "alive" }],
  locations: [{ id: "leuchtturm", name: "Der Leuchtturm" }],
  sessions: [],
};

const render = (props: Partial<Parameters<typeof DraftEditor>[0]> = {}): string =>
  renderToStaticMarkup(
    <DraftEditor
      path="01-salzhafen/ankunft"
      kind="scene"
      properties={{ title: "Ankunft", status: "draft", location: "leuchtturm" }}
      body={"## Ablauf\n\nDer Leuchtturm ist dunkel.\n"}
      tree={tree}
      onPropertiesChange={() => {}}
      onBodyChange={() => {}}
      onFlush={() => {}}
      {...props}
    />,
  );

describe("the draft editor", () => {
  test("edits a scene draft's properties in the fields of the dialog", () => {
    const html = render();
    expect(html).toContain("Eigenschaften");
    // The field labels of the scene form, not a YAML text.
    expect(html).toContain("Titel");
    expect(html).toContain("Status");
    expect(html).toContain('value="Ankunft"');
    // The address is context, never a field.
    expect(html).toContain("01-salzhafen/ankunft");
    expect(html).not.toContain("---");
  });

  test("offers the body on the composer's surfaces, block cards first", () => {
    const html = render();
    expect(html).toContain("Blöcke");
    expect(html).toContain("Markdown");
    expect(html).toContain("Der Leuchtturm ist dunkel.");
  });

  test("a kind without a field list still edits its body", () => {
    const html = render({ path: "sessions/2026-01-01", kind: "session" });
    expect(html).not.toContain("Eigenschaften");
    expect(html).toContain("Der Leuchtturm ist dunkel.");
  });
});
