// Render tests for the npc's form fields (react-dom/server — no DOM): the
// fields its dialog shows, in their order, the status as a closed list
// without an empty choice, the quick stats as key/value rows, and the
// `motivation` apart from them — it is written beside the text.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { NpcFields, NpcMotivationField } from "./NpcFields";
import { npcFormValues, type NpcFormValues } from "./npc-form";

const t = translator("de");

const tree: CampaignTree = {
  campaign: "example",
  chapters: [{ id: "01-salt-harbour", title: "Chapter 1: The Lighthouse", scenes: [] }],
  npcs: [],
  locations: [],
  sessions: [],
};

const FENN = npcFormValues({
  id: "fenn",
  name: "Fenn",
  status: "alive",
  chapter: "01-salt-harbour",
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
    const labels = [
      t("properties.npc.name.label"),
      t("properties.npc.role.label"),
      t("properties.npc.chapter.label"),
      t("properties.npc.status.label"),
      t("properties.npc.statblock.label"),
      t("properties.npc.quickstats.label"),
      t("properties.npc.voice.label"),
      t("properties.npc.appearance.label"),
    ];
    const positions = labels.map((label) => html.indexOf(`>${label}<`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // The motivation is written beside the text, not in the dialog.
    expect(html).not.toContain(`>${t("properties.npc.motivation.label")}<`);
    expect(html).toContain('value="Fenn"');
  });

  test("the status offers the closed list and no empty choice — an npc always has one", () => {
    const select = /<select[^>]*>(.*?)<\/select>/s.exec(render())?.[1] ?? "";
    expect(select).toContain('value="alive" selected');
    expect(select).not.toContain(t("properties.field.unset"));
    expect(select).not.toContain('value=""');
    expect(count(select, "<option")).toBe(4);
    expect(select).toContain(t("status.npc.alive"));
  });

  test("the chapter suggests the known chapters and names the chosen one", () => {
    const html = render();
    expect(html).toContain('<datalist id="prop-chapter-options">');
    expect(html).toContain("Chapter 1: The Lighthouse");
    const unknown = render({ ...FENN, chapter: "99-nowhere" });
    expect(unknown).toContain(t("properties.ref.unknownChapter"));
  });
});

describe("quickstats", () => {
  test("every row is two labelled inputs plus its own remove button", () => {
    const html = render();
    const label = t("properties.npc.quickstats.label");
    expect(html).toContain(`aria-label="${t("properties.field.row.name.aria", { label, row: 1 })}"`);
    expect(html).toContain(`aria-label="${t("properties.field.row.value.aria", { label, row: 1 })}"`);
    expect(html).toContain(`aria-label="${t("properties.field.remove.aria", { item: "insight" })}"`);
    expect(html).toContain(t("properties.field.addRow"));
  });

  test("what blocks the save is said under the field, not swallowed", () => {
    const html = render(
      { ...FENN, quickstats: [{ key: "", value: "+2" }] },
      { quickstats: t("properties.issue.namelessRow") },
    );
    expect(html).toContain(t("properties.issue.namelessRow"));
    expect(html).toContain("text-destructive");
    // The field's own hint keeps standing next to it.
    expect(html).toContain(t("properties.npc.quickstats.hint"));
  });
});

describe("the motivation field", () => {
  test("is a labelled text area of its own", () => {
    const html = renderToStaticMarkup(
      <NpcMotivationField value="Peace in the harbour." onChange={() => {}} />,
    );
    expect(html).toContain(`>${t("properties.npc.motivation.label")}<`);
    expect(html).toContain("<textarea");
    expect(html).toContain("Peace in the harbour.");
  });
});
