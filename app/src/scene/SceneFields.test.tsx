// Render tests for a scene's fields (react-dom/server — no DOM). What must
// hold is the degrade contract of the reference fields: the existing ids are
// OFFERED (a <datalist>, never a closed list), an id without a row stays
// typeable and visible — and the chips and selects of the lists and the two
// closed fields.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { SceneProposal } from "@grimoire/shared/scene";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SceneFields } from "./SceneFields";
import { sceneFormValues, type SceneFormValues, type ScenePendingChips } from "./scene-form";

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [{ id: "01-salzhafen", title: "Kapitel 1", scenes: [] }],
  npcs: [
    { id: "fenn", name: "Fenn", status: "alive" },
    { id: "jorna", name: "Hafenmeisterin Jorna", status: "alive" },
  ],
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
    expect(html).toContain('value="leuchtturm"');
    expect(html).toContain("Der Leuchtturm");
  });

  test("free text in the location field is read as its id", () => {
    // The DM types a name, so the line answers for the id that text means.
    expect(render({ location: "Der alte Hafen" })).toContain("Unbekannt — Ort muss existieren.");
    // …and a name that slugs to a known location lands on it.
    expect(render({ location: "Leuchtturm" })).toContain("Der Leuchtturm");
  });

  test("text no slug can be derived from says nothing — the issue does", () => {
    const html = render({ location: "???" }, {}, { location: "Kein verwendbarer Name" });
    expect(html).not.toContain("Unbekannt — Ort muss existieren.");
    expect(html).toContain("Kein verwendbarer Name");
  });

  test("an unknown chapter is not promised — chapters are never created by being named", () => {
    expect(render({ chapter: "99-nirgendwo" })).toContain("Unbekannt — Kapitel muss existieren.");
  });

  test("npcs are chips: each id removable, the add-input suggests the known ones", () => {
    const html = render({ npcs: ["fenn", "kapitaen-torv"] });
    expect(html).toContain('aria-label="fenn entfernen"');
    expect(html).toContain('aria-label="kapitaen-torv entfernen"');
    expect(html).toContain('<datalist id="prop-npcs-options">');
    expect(html).toContain("Hafenmeisterin Jorna");
  });
});

describe("what a scene cannot be without", () => {
  test("title, type, chapter and status are marked as needed, the rest is not", () => {
    const html = render();
    const needed = [...html.matchAll(/<span class="[^"]*">([^<]+)<span class="[^"]*"> · nötig<\/span>/g)].map(
      (match) => match[1],
    );
    expect(needed).toEqual(["Titel", "Typ", "Kapitel", "Status"]);
  });
});

describe("chips and selects", () => {
  test("tags are plain chips with a remove button each", () => {
    const html = render({ tags: ["social", "escape"] });
    expect(html).toContain('aria-label="social entfernen"');
    expect(html).toContain('aria-label="escape entfernen"');
    expect(html).not.toContain('<datalist id="prop-tags-options">');
  });

  test("the pending text of a chip input is shown, not swallowed", () => {
    expect(render({}, { tags: "combat" })).toContain('value="combat"');
  });

  test("a hand-edited list keeps its duplicates, each removable on its own", () => {
    const html = render({ tags: ["social", "social"] });
    expect(count(html, 'aria-label="social entfernen"')).toBe(2);
  });

  test("type and status offer their closed lists and nothing else", () => {
    // Both are CHECK constraints (ADR #25) and a scene always has both, so
    // there is no empty choice.
    const html = render();
    expect(html).toContain('value="draft" selected');
    expect(html).toContain("Bereit");
    expect(html).toContain("Eventualszene");
    expect(html).not.toContain("— nicht gesetzt —");
    expect(count(html, "<option")).toBe(2 + 4 + 1 + 1 + 2);
  });
});
