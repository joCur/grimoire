// Render tests for a scene's fields (react-dom/server — no DOM). What must
// hold is the degrade contract of the reference fields: the existing ids are
// OFFERED (a <datalist>, never a closed list), an id without a row stays
// typeable and visible — and the chips and selects of the lists and the two
// closed fields.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { SceneProposal } from "@grimoire/shared/scene";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { SceneFields } from "./SceneFields";
import { sceneFormValues, type SceneFormValues, type ScenePendingChips } from "./scene-form";

const t = translator("de");

/** The accessible name of a chip's remove button. */
const removeLabel = (item: string): string => `aria-label="${t("properties.field.remove.aria", { item })}"`;

const tree: CampaignTree = {
  campaign: "example",
  chapters: [{ id: "01-salt-harbour", title: "Chapter 1", scenes: [] }],
  npcs: [
    { id: "fenn", name: "Fenn", status: "alive" },
    { id: "jorna", name: "Harbourmaster Jorna", status: "alive" },
  ],
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
  body: "",
};

function render(
  changes: Partial<SceneFormValues> = {},
  pending: ScenePendingChips = {},
  issues: Partial<Record<keyof SceneFormValues, string>> = {},
): string {
  return renderToStaticMarkup(
    <SceneFields
      values={{ ...sceneFormValues(SCENE), ...changes }}
      pending={pending}
      issues={issues}
      tree={tree}
      onChange={() => {}}
      onPendingChange={() => {}}
    />,
  );
}

/** How often a substring occurs — duplicates are the point in one test. */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("reference fields", () => {
  test("the location suggests the existing ids and names the chosen one", () => {
    const html = render();
    expect(html).toContain('list="prop-location-options"');
    expect(html).toContain('<datalist id="prop-location-options">');
    expect(html).toContain('value="lighthouse"');
    expect(html).toContain("The Lighthouse");
  });

  test("free text in the location field is read as its id", () => {
    // The DM types a name, so the line answers for the id that text means.
    expect(render({ location: "The Old Harbour" })).toContain(t("properties.ref.unknownLocation"));
    // …and a name that slugs to a known location lands on it.
    expect(render({ location: "Lighthouse" })).toContain("The Lighthouse");
  });

  test("text no slug can be derived from says nothing — the issue does", () => {
    const issue = t("properties.issue.locationUnusable", { value: "???" });
    const html = render({ location: "???" }, {}, { location: issue });
    expect(html).not.toContain(t("properties.ref.unknownLocation"));
    expect(html).toContain(issue);
  });

  test("an unknown chapter is not promised — chapters are never created by being named", () => {
    expect(render({ chapter: "99-nowhere" })).toContain(t("properties.ref.unknownChapter"));
  });

  test("npcs are chips: each id removable, the add-input suggests the known ones", () => {
    const html = render({ npcs: ["fenn", "captain-torv"] });
    expect(html).toContain(removeLabel("fenn"));
    expect(html).toContain(removeLabel("captain-torv"));
    expect(html).toContain('<datalist id="prop-npcs-options">');
    expect(html).toContain("Harbourmaster Jorna");
  });
});

describe("what a scene cannot be without", () => {
  test("title, type, chapter and status are marked as needed, the rest is not", () => {
    const html = render();
    const marker = new RegExp(
      `<span class="[^"]*">([^<]+)<span class="[^"]*">${t("properties.field.required")}</span>`,
      "g",
    );
    const needed = [...html.matchAll(marker)].map((match) => match[1]);
    expect(needed).toEqual([
      t("properties.scene.title.label"),
      t("properties.scene.type.label"),
      t("properties.scene.chapter.label"),
      t("properties.scene.status.label"),
    ]);
  });
});

describe("chips and selects", () => {
  test("tags are plain chips with a remove button each", () => {
    const html = render({ tags: ["social", "escape"] });
    expect(html).toContain(removeLabel("social"));
    expect(html).toContain(removeLabel("escape"));
    expect(html).not.toContain('<datalist id="prop-tags-options">');
  });

  test("the pending text of a chip input is shown, not swallowed", () => {
    expect(render({}, { tags: "combat" })).toContain('value="combat"');
  });

  test("a hand-edited list keeps its duplicates, each removable on its own", () => {
    const html = render({ tags: ["social", "social"] });
    expect(count(html, removeLabel("social"))).toBe(2);
  });

  test("type and status offer their closed lists and nothing else", () => {
    // Both are CHECK constraints (decisions/constraints) and a scene always has both, so
    // there is no empty choice.
    const html = render();
    expect(html).toContain('value="draft" selected');
    expect(html).toContain(t("status.scene.ready"));
    expect(html).toContain(t("properties.scene.type.contingency"));
    expect(html).not.toContain(t("properties.field.unset"));
    expect(count(html, "<option")).toBe(2 + 4 + 1 + 1 + 2);
  });
});
