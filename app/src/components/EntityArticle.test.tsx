// Render tests for the entity reading view (react-dom/server — no DOM):
// the NPC/location/titled headers and the one rule behind them —
// the scene type overline never appears above a non-scene.

import type { EntityKind, EntryResponse } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EntityArticle } from "./EntityArticle";

function entry(
  kind: EntityKind,
  properties: Record<string, unknown>,
  body = "",
): EntryResponse {
  return { path: `npcs/x`, kind, properties, body, rev: 1 };
}

function render(e: EntryResponse): string {
  return renderToStaticMarkup(<EntityArticle entry={e} />);
}

const jorna = entry(
  "npc",
  {
    id: "jorna",
    name: "Hafenmeisterin Jorna",
    role: "Auftraggeberin, Hafenmeisterin von Salzhafen",
    status: "alive",
    statblock: "Roll20: Jorna",
    quickstats: { insight: "+2", "passive-perception": 12 },
    voice: "knapp, wetterrau, duzt jeden",
    appearance: "Ölmantel, graue Flechte",
  },
  "## Will\n\nDas Leuchtfeuer muss wieder brennen.\n",
);

describe("EntityArticle — npc", () => {
  test("renders name, role, status label, voice, appearance and quickstats", () => {
    const html = render(jorna);
    expect(html).toContain("Hafenmeisterin Jorna");
    expect(html).toContain("Auftraggeberin, Hafenmeisterin von Salzhafen");
    expect(html).toContain("Lebendig");
    expect(html).toContain("knapp, wetterrau, duzt jeden");
    expect(html).toContain("Ölmantel, graue Flechte");
    expect(html).toContain("insight +2");
    expect(html).toContain("passive-perception 12");
  });

  test("an entry with nothing but its id is a normal, thin page", () => {
    // What a brand-new npc looks like before anybody fills it in: the id as
    // the name, the neutral status, no field rows, no "fehlt" placeholder
    // anywhere.
    const html = render(entry("npc", { id: "holm", name: "holm", status: "unknown" }));
    expect(html).toContain("holm");
    expect(html).toContain("Unbekannt");
    expect(html).not.toContain("fehlt");
    expect(html).not.toContain("Statblock");
    expect(html).not.toContain("Stimme");
  });

  test("statblock is a plain reference line, never a link", () => {
    const html = render(jorna);
    expect(html).toContain("Statblock: Roll20: Jorna");
    expect(html).not.toContain("<a ");
  });

  test("body still goes through the markdown pipeline", () => {
    const html = render(jorna);
    expect(html).toContain("Das Leuchtfeuer muss wieder brennen.");
  });

  test("no scene type overline above an npc", () => {
    const html = render(jorna);
    expect(html).not.toContain("Geplante Szene");
    expect(html).not.toContain("Eventualszene");
  });

  test("the status pill carries the catalog label of the stored value", () => {
    expect(render(entry("npc", { id: "x", name: "X", status: "missing" }))).toContain("Vermisst");
  });

  test("a bare npc entry degrades to name + body", () => {
    const html = render(entry("npc", { id: "fenn", name: "Fenn" }, "Nur Text.\n"));
    expect(html).toContain("Fenn");
    expect(html).toContain("Nur Text.");
    expect(html).not.toContain("Statblock");
  });

  test("a nameless npc entry falls back to the path", () => {
    const html = render(entry("npc", {}, ""));
    expect(html).toContain("npcs/x");
  });
});

describe("EntityArticle — location and titled entities", () => {
  test("location shows the roll20 page as a reference line", () => {
    const html = render(
      entry(
        "location",
        { id: "leuchtturm", name: "Der Leuchtturm von Salzhafen", "roll20-page": "Leuchtturm" },
        "## Atmosphäre\n\nVerlassen in Eile.\n",
      ),
    );
    expect(html).toContain("Der Leuchtturm von Salzhafen");
    expect(html).toContain("Roll20-Seite: Leuchtturm");
    expect(html).toContain("Verlassen in Eile.");
    expect(html).not.toContain("Geplante Szene");
  });

  test("chapter renders title plus body", () => {
    const html = render(
      entry("chapter", { id: "01-salzhafen", title: "Salzhafen" }, "## Ziel\n\nLicht an.\n"),
    );
    expect(html).toContain("Salzhafen");
    expect(html).toContain("Licht an.");
    expect(html).not.toContain("Geplante Szene");
  });

  test("the action slot stays ONE spaced group in every header variant", () => {
    // The slot carries more than one trigger; the
    // headers put it in a `justify-between` row, so without the group wrapper
    // the first button would be stranded in the middle of the header.
    const actions = (
      <>
        {/* Stand-in caller markup, not app copy — the literals stay, in an
            expression container so the i18n lint rule is satisfied. */}
        <button type="button">{"Bearbeiten"}</button>
        <button type="button">{"Eigenschaften"}</button>
      </>
    );
    const grouped =
      /<span class="[^"]*gap-2[^"]*"><button[^>]*>Bearbeiten<\/button><button[^>]*>Eigenschaften<\/button><\/span>/;
    const variants = [
      jorna, // npc header
      entry("location", { id: "leuchtturm", name: "Leuchtturm" }),
      entry("chapter", { id: "01-salzhafen", title: "Salzhafen" }),
    ];
    for (const e of variants) {
      expect(renderToStaticMarkup(<EntityArticle entry={e} actions={actions} />)).toMatch(grouped);
    }
    // No actions, no wrapper markup.
    expect(render(jorna)).not.toMatch(/<span class="[^"]*gap-2[^"]*"><\/span>/);
  });

  test("campaign and unknown kinds render the same quiet titled header", () => {
    expect(render(entry("campaign", { id: "beispiel", name: "Beispiel" }))).toContain("Beispiel");
    const unknown = render(entry("unknown", {}, "Freitext.\n"));
    expect(unknown).toContain("Freitext.");
    expect(unknown).not.toContain("Geplante Szene");
  });
});
