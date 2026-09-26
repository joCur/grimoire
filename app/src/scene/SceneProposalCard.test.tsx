// Render test of the editor of a proposed scene (react-dom/server — no DOM).
//
// What must hold is that a proposed scene is edited as a written one is: the
// fields of its dialog with their labels, its label as a read-only id, and
// the text on the body editor's surfaces.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { SceneProposal } from "@grimoire/shared/scene";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { SceneProposalEditor } from "./SceneProposalCard";

const t = translator("de");

const tree: CampaignTree = {
  campaign: "example",
  chapters: [],
  npcs: [{ id: "fenn", name: "Fenn", status: "alive" }],
  locations: [{ id: "lighthouse", name: "The Lighthouse" }],
  sessions: [],
};

const SCENE: SceneProposal = {
  id: "arrival",
  title: "Arrival",
  type: "planned",
  chapter: "01-salt-harbour",
  location: "lighthouse",
  npcs: [],
  handouts: [],
  tags: [],
  status: "draft",
  body: "## Flow\n\nThe lighthouse is dark.\n",
};

const render = (): string =>
  renderToStaticMarkup(
    <SceneProposalEditor scene={SCENE} tree={tree} onChange={() => {}} onFlush={() => {}} />,
  );

describe("the editor of a proposed scene", () => {
  test("edits its fields in the fields of the dialog", () => {
    const html = render();
    expect(html).toContain(t("generate.review.propertiesHeading"));
    expect(html).toContain(t("properties.scene.title.label"));
    expect(html).toContain(t("properties.scene.status.label"));
    expect(html).toContain('value="Arrival"');
    // The id is context, never a field.
    expect(html).toContain("scenes/arrival");
    expect(html).not.toContain("---");
  });

  test("offers the text on the composer's surfaces, block cards first", () => {
    const html = render();
    expect(html).toContain(t("composer.mode.blocks"));
    expect(html).toContain(t("composer.mode.markdown"));
    expect(html).toContain("The lighthouse is dark.");
  });
});
