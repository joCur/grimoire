// Render tests for the properties controls (react-dom/server —
// no DOM). What must hold is the degrade contract of the reference and select
// fields: the existing ids are OFFERED (a <datalist>, never a closed list), an
// id without an entry stays typeable and visible, and a status value nobody knows
// is an option of its own instead of being corrected away.

import type { CampaignTree } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { propertiesFieldsFor, type FieldValue, type PropertiesField } from "@/lib/properties-form";

import { PropertiesFieldControl } from "./PropertiesFields";
import { translator } from "@/i18n/format";

// The language the assertions below are written in: the helpers
// take the translator as an argument, so a test says so explicitly instead of
// leaning on a default.
const t = translator("de");

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [],
  npcs: [
    { path: "npcs/fenn", id: "fenn", name: "Fenn", status: "alive" },
    { path: "npcs/jorna", id: "jorna", name: "Hafenmeisterin Jorna", status: "alive" },
  ],
  locations: [{ id: "leuchtturm", name: "Der Leuchtturm" }],
  sessions: [],
};

function fieldOf(kind: "scene" | "npc", key: string): PropertiesField {
  const field = (propertiesFieldsFor(kind, t) ?? []).find((f) => f.key === key);
  if (field === undefined) throw new Error(`no ${kind} field ${key}`);
  return field;
}

const sceneField = (key: string) => fieldOf("scene", key);

function render(
  field: PropertiesField,
  value: FieldValue,
  pending = "",
  extra: { issue?: string } = {},
): string {
  return renderToStaticMarkup(
    <PropertiesFieldControl
      field={field}
      value={value}
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
    expect(html).toContain('list="prop-location-options"');
    expect(html).toContain('<datalist id="prop-location-options">');
    expect(html).toContain('value="leuchtturm"');
    expect(html).toContain("Der Leuchtturm");
  });

  test("an unknown id says the entry has to exist", () => {
    const html = render(sceneField("location"), { kind: "text", text: "nordbucht" });
    expect(html).toContain('value="nordbucht"');
    expect(html).toContain("Unbekannt — Ort muss existieren.");
  });

  test("free text in the Ort field is read as its id", () => {
    // `location` IS the group the scene sits under and it stores an id — but
    // the DM types a name, so the line answers for the id that text means,
    // instead of handing the slug over as homework.
    const html = render(sceneField("location"), { kind: "text", text: "Der alte Hafen" });
    expect(html).toContain("Unbekannt — Ort muss existieren.");
    expect(html).not.toContain("Keine Orts-Kennung");
  });

  test("text that SLUGS to a known location resolves to that location's name", () => {
    // Typing the name lands on the entry that is already there, so the field
    // does not offer to create one.
    const html = render(sceneField("location"), { kind: "text", text: "Leuchtturm" });
    expect(html).toContain("Der Leuchtturm");
    expect(html).not.toContain("angelegt");
  });

  test("text no slug can be derived from says nothing — the issue does", () => {
    const html = render(sceneField("location"), { kind: "text", text: "???" });
    expect(html).not.toContain("angelegt");
    expect(html).not.toContain("Keine Orts-Kennung");
  });

  test("an unknown CHAPTER is not promised — chapters are never auto-created", () => {
    // ADR #19: a scene under an unknown chapter falls out of the tree, so the
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
    expect(html).toContain('<datalist id="prop-npcs-options">');
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
    // `tags: [social, social]` is what the entry carries: it has to show
    // up as two chips, and clicking one X may not take both (index keys).
    const html = render(sceneField("tags"), { kind: "list", items: ["social", "social"] });
    expect(count(html, "<li")).toBe(2);
    expect(count(html, 'aria-label="social entfernen"')).toBe(2);
  });

  test("the status select offers the closed list and nothing else", () => {
    // The column is a CHECK constraint (ADR #25), so the four values are the
    // whole list — plus the empty option, which deletes the key on save.
    const html = render(sceneField("status"), { kind: "text", text: "draft" });
    expect(html).toContain('value="draft" selected');
    expect(html).toContain("Bereit");
    expect(html).toContain("— nicht gesetzt —");
    expect(count(html, "<option")).toBe(5);
  });
});

describe("quickstats", () => {
  test("every row is two labelled inputs plus its own remove button", () => {
    const html = render(fieldOf("npc", "quickstats"), {
      kind: "pairs",
      entries: [{ key: "insight", value: "+2" }],
    });
    expect(html).toContain('aria-label="Kurzwerte, Zeile 1: Name"');
    expect(html).toContain('aria-label="Kurzwerte, Zeile 1: Wert"');
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
