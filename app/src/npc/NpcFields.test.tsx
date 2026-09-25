// Render tests for the npc's form fields (react-dom/server — no DOM): the
// fields its dialog shows, in their order, the status as a closed list
// without an empty choice, the quick stats as key/value rows, and the
// `motivation` apart from them — it is written beside the text.

import type { CampaignTree } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { NpcFields, NpcMotivationField } from "./NpcFields";
import { npcFormValues, type NpcFormValues } from "./npc-form";

const tree: CampaignTree = {
  campaign: "beispiel",
  chapters: [{ id: "01-salzhafen", title: "Kapitel 1: Der Leuchtturm", scenes: [] }],
  npcs: [],
  locations: [],
  sessions: [],
};

const FENN = npcFormValues({
  id: "fenn",
  name: "Fenn",
  status: "alive",
  chapter: "01-salzhafen",
  quickstats: { insight: "+2" },
  body: "",
});

function render(values: NpcFormValues = FENN, issues: { quickstats?: string } = {}): string {
  return renderToStaticMarkup(
    <NpcFields values={values} issues={issues} tree={tree} onChange={() => {}} />,
  );
}

/** How often a substring occurs. */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("the npc's dialog fields", () => {
  test("every field of the npc but the ones it cannot edit here, in dialog order", () => {
    const html = render();
    const labels = ["Name", "Rolle", "Kapitel", "Status", "Statblock", "Kurzwerte", "Stimme", "Erscheinung"];
    const positions = labels.map((label) => html.indexOf(`>${label}<`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // The motivation is written beside the text, not in the dialog.
    expect(html).not.toContain(">Will<");
    expect(html).toContain('value="Fenn"');
  });

  test("the status offers the closed list and no empty choice — an npc always has one", () => {
    const select = /<select[^>]*>(.*?)<\/select>/s.exec(render())?.[1] ?? "";
    expect(select).toContain('value="alive" selected');
    expect(select).not.toContain("— nicht gesetzt —");
    expect(select).not.toContain('value=""');
    expect(count(select, "<option")).toBe(4);
    expect(select).toContain("Lebendig");
  });

  test("the chapter suggests the known chapters and names the chosen one", () => {
    const html = render();
    expect(html).toContain('<datalist id="prop-chapter-options">');
    expect(html).toContain("Kapitel 1: Der Leuchtturm");
    const unknown = render({ ...FENN, chapter: "99-nirgendwo" });
    expect(unknown).toContain("Unbekannt — Kapitel muss existieren.");
  });
});

describe("quickstats", () => {
  test("every row is two labelled inputs plus its own remove button", () => {
    const html = render();
    expect(html).toContain('aria-label="Kurzwerte, Zeile 1: Name"');
    expect(html).toContain('aria-label="Kurzwerte, Zeile 1: Wert"');
    expect(html).toContain('aria-label="insight entfernen"');
    expect(html).toContain("Zeile hinzufügen");
  });

  test("what blocks the save is said under the field, not swallowed", () => {
    const html = render(
      { ...FENN, quickstats: [{ key: "", value: "+2" }] },
      { quickstats: "Zeile ohne Namen — Name ergänzen oder Zeile entfernen." },
    );
    expect(html).toContain("Zeile ohne Namen — Name ergänzen oder Zeile entfernen.");
    expect(html).toContain("text-destructive");
    // The field's own hint keeps standing next to it.
    expect(html).toContain("nur was sozial gebraucht wird");
  });
});

describe("the motivation field", () => {
  test("is a labelled text area of its own", () => {
    const html = renderToStaticMarkup(
      <NpcMotivationField value="Ruhe im Hafen." onChange={() => {}} />,
    );
    expect(html).toContain(">Will<");
    expect(html).toContain("<textarea");
    expect(html).toContain("Ruhe im Hafen.");
  });
});
