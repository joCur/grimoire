// Render test of the editor of a proposed scene (react-dom/server — no DOM).
//
// What must hold is that a proposed scene is edited as a written one is: the
// fields of its dialog with their labels, its label as a read-only id, and
// the text on the body editor's surfaces.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { SceneProposal } from "@grimoire/shared/scene";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SceneProposalEditor } from "./SceneProposalCard";

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [],
  npcs: [{ id: "fenn", name: "Fenn", status: "alive" }],
  locations: [{ id: "leuchtturm", name: "Der Leuchtturm" }],
  sessions: [],
};

const SCENE: SceneProposal = {
  id: "ankunft",
  title: "Ankunft",
  type: "planned",
  chapter: "01-salzhafen",
  location: "leuchtturm",
  npcs: [],
  handouts: [],
  tags: [],
  status: "draft",
  body: "## Ablauf\n\nDer Leuchtturm ist dunkel.\n",
};

const render = (): string =>
  renderToStaticMarkup(
    <SceneProposalEditor scene={SCENE} tree={tree} onChange={() => {}} onFlush={() => {}} />,
  );

describe("the editor of a proposed scene", () => {
  test("edits its fields in the fields of the dialog", () => {
    const html = render();
    expect(html).toContain("Eigenschaften");
    expect(html).toContain("Titel");
    expect(html).toContain("Status");
    expect(html).toContain('value="Ankunft"');
    // The id is context, never a field.
    expect(html).toContain("scenes/ankunft");
    expect(html).not.toContain("---");
  });

  test("offers the text on the composer's surfaces, block cards first", () => {
    const html = render();
    expect(html).toContain("Blöcke");
    expect(html).toContain("Markdown");
    expect(html).toContain("Der Leuchtturm ist dunkel.");
  });
});
