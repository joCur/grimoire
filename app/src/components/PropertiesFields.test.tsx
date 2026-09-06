// Render tests for the „Eigenschaften" controls (issue #42, react-dom/server —
// no DOM). What must hold is the degrade contract of the reference and select
// fields: the existing ids are OFFERED (a <datalist>, never a closed list), an
// id without a file stays typeable and visible, and a status value nobody knows
// is an option of its own instead of being corrected away.

import type { CampaignTree } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { propertiesFieldsFor, type FieldValue, type PropertiesField } from "@/lib/properties-form";

import { PropertiesFieldControl } from "./PropertiesFields";

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [],
  npcs: [
    { path: "npcs/fenn.md", id: "fenn", name: "Fenn", status: "alive" },
    { path: "npcs/jorna.md", id: "jorna", name: "Hafenmeisterin Jorna", status: "alive" },
  ],
  locations: [{ path: "locations/leuchtturm.md", id: "leuchtturm", name: "Der Leuchtturm" }],
  sessions: [],
};

function fieldOf(kind: "scene" | "npc", key: string): PropertiesField {
  const field = (propertiesFieldsFor(kind) ?? []).find((f) => f.key === key);
  if (field === undefined) throw new Error(`no ${kind} field ${key}`);
  return field;
}

const sceneField = (key: string) => fieldOf("scene", key);

function render(
  field: PropertiesField,
  value: FieldValue,
  pending = "",
  extra: { initialValue?: FieldValue; issue?: string } = {},
): string {
  return renderToStaticMarkup(
    <PropertiesFieldControl
      field={field}
      value={value}
      initialValue={extra.initialValue}
      tree={tree}
      pending={pending}
      issue={extra.issue}
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
  test("a single reference suggests the existing ids and names the chosen one", () => {
    const html = render(sceneField("location"), { kind: "text", text: "leuchtturm" });
    expect(html).toContain('list="fm-location-options"');
    expect(html).toContain('<datalist id="fm-location-options">');
    expect(html).toContain('value="leuchtturm"');
    expect(html).toContain("Der Leuchtturm");
  });

  test("an unknown id says the save will create it (#70)", () => {
    const html = render(sceneField("location"), { kind: "text", text: "nordbucht" });
    expect(html).toContain('value="nordbucht"');
    expect(html).toContain("Neu — wird beim Speichern angelegt.");
  });

  test("a value that is no slug is free text and gets no entry", () => {
    // The format's one ambiguous field: `location` takes an id OR a string.
    const html = render(sceneField("location"), { kind: "text", text: "Der alte Hafen" });
    expect(html).toContain("Freier Text — kein Eintrag.");
    expect(html).not.toContain("angelegt");
  });

  test("an unknown CHAPTER is not promised — chapters are never auto-created", () => {
    // ADR #14: a scene under an unknown chapter falls out of the tree, so the
    // server answers 400 for every kind that names one. The hint promised the
    // entry anyway and the save then failed with the server's message.
    const html = render(sceneField("chapter"), { kind: "text", text: "99-nirgendwo" });
    expect(html).toContain("Unbekannt — Kapitel muss existieren.");
    expect(html).not.toContain("angelegt");
  });

  test("npcs are chips: each id removable, the add-input suggests the known ones", () => {
    const html = render(sceneField("npcs"), { kind: "list", items: ["fenn", "kapitaen-torv"] });
    expect(html).toContain("fenn");
    expect(html).toContain("Hafenmeisterin Jorna"); // in the suggestion list
    expect(html).toContain('aria-label="fenn entfernen"');
    expect(html).toContain('aria-label="kapitaen-torv entfernen"');
    expect(html).toContain('<datalist id="fm-npcs-options">');
  });
});

describe("chips and selects", () => {
  test("tags are plain chips with a remove button each", () => {
    const html = render(sceneField("tags"), { kind: "list", items: ["social", "escape"] });
    expect(html).toContain('aria-label="social entfernen"');
    expect(html).toContain('aria-label="escape entfernen"');
    // Free text, so no suggestion list at all.
    expect(html).not.toContain("<datalist");
  });

  test("the pending text of a chip input is shown, not swallowed", () => {
    expect(render(sceneField("tags"), { kind: "list", items: [] }, "combat")).toContain(
      'value="combat"',
    );
  });

  test("a hand-edited list keeps its duplicates, each removable on its own", () => {
    // `tags: [social, social]` is a file the DM wrote by hand: it has to show
    // up as two chips, and clicking one X may not take both (index keys).
    const html = render(sceneField("tags"), { kind: "list", items: ["social", "social"] });
    expect(count(html, "<li")).toBe(2);
    expect(count(html, 'aria-label="social entfernen"')).toBe(2);
  });

  test("a status the file carries but nobody knows is an option of its own", () => {
    const html = render(sceneField("status"), { kind: "text", text: "onhold" });
    expect(html).toContain('value="onhold"');
    expect(html).toContain("bereit"); // the known options are still offered
    // Clearing must be reachable: the empty option deletes the key on save.
    expect(html).toContain("— nicht gesetzt —");
  });

  test("that unknown status stays in the list after the DM picked a known one", () => {
    // The extra option comes from what the FILE held, not from the current
    // selection — otherwise the odd value is gone the moment it is left.
    const html = render(
      sceneField("status"),
      { kind: "text", text: "draft" },
      "",
      { initialValue: { kind: "text", text: "onhold" } },
    );
    expect(html).toContain('value="onhold"');
    expect(html).toContain('value="draft" selected');
  });
});

describe("quickstats", () => {
  test("every row is two labelled inputs plus its own remove button", () => {
    const html = render(fieldOf("npc", "quickstats"), {
      kind: "pairs",
      entries: [{ key: "insight", value: "+2" }],
    });
    expect(html).toContain('aria-label="Quickstats, Zeile 1: Name"');
    expect(html).toContain('aria-label="Quickstats, Zeile 1: Wert"');
    expect(html).toContain('aria-label="insight entfernen"');
    expect(html).toContain("Zeile hinzufügen");
  });

  test("what blocks the save is said under the field, not swallowed", () => {
    const html = render(
      fieldOf("npc", "quickstats"),
      { kind: "pairs", entries: [{ key: "", value: "+2" }] },
      "",
      { issue: "Zeile ohne Namen — Name ergänzen oder Zeile entfernen." },
    );
    expect(html).toContain("Zeile ohne Namen — Name ergänzen oder Zeile entfernen.");
    expect(html).toContain("text-destructive");
    // The field's own hint keeps standing next to it.
    expect(html).toContain("nur was sozial gebraucht wird");
  });
});
