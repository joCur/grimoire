// Render tests for the entity reading view (react-dom/server — no DOM):
// the NPC/location/titled headers and the one rule that started issue #26 —
// the scene type overline never appears above a non-scene.

import type { EntityKind, FileResponse } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EntityArticle } from "./EntityArticle";

function file(
  kind: EntityKind,
  properties: Record<string, unknown>,
  body = "",
): FileResponse {
  return { path: `npcs/x.md`, kind, properties, body, rev: 1, raw: "" };
}

function render(f: FileResponse): string {
  return renderToStaticMarkup(<EntityArticle file={f} />);
}

const jorna = file(
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
    expect(html).toContain("lebendig");
    expect(html).toContain("knapp, wetterrau, duzt jeden");
    expect(html).toContain("Ölmantel, graue Flechte");
    expect(html).toContain("insight +2");
    expect(html).toContain("passive-perception 12");
  });

  test("an entry with nothing but its id is a normal, thin page (#70)", () => {
    // A reference creates the entry it names, so this is what a brand-new
    // npc looks like before anybody fills it in: the id as the name, the
    // neutral status, no field rows, no "fehlt" placeholder anywhere.
    const html = render(file("npc", { id: "holm", name: "holm", status: "unknown" }));
    expect(html).toContain("holm");
    expect(html).toContain("unbekannt");
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
    expect(html).not.toContain("Kontingenz");
  });

  test("an unknown status value is shown verbatim (degrade)", () => {
    expect(render(file("npc", { id: "x", name: "X", status: "verschollen" }))).toContain(
      "verschollen",
    );
  });

  test("a bare npc file degrades to name + body", () => {
    const html = render(file("npc", { id: "fenn", name: "Fenn" }, "Nur Text.\n"));
    expect(html).toContain("Fenn");
    expect(html).toContain("Nur Text.");
    expect(html).not.toContain("Statblock");
  });

  test("a nameless npc file falls back to the path", () => {
    const html = render(file("npc", {}, ""));
    expect(html).toContain("npcs/x.md");
  });
});

describe("EntityArticle — location and titled entities", () => {
  test("location shows the roll20 page as a reference line", () => {
    const html = render(
      file(
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
      file("chapter", { id: "01-salzhafen", title: "Salzhafen" }, "## Ziel\n\nLicht an.\n"),
    );
    expect(html).toContain("Salzhafen");
    expect(html).toContain("Licht an.");
    expect(html).not.toContain("Geplante Szene");
  });

  test("the action slot stays ONE spaced group in every header variant", () => {
    // Since issue #15 the slot carries „Bearbeiten" AND „Umbenennen"; the
    // headers put it in a `justify-between` row, so without the group wrapper
    // the first button would be stranded in the middle of the header.
    const actions = (
      <>
        <button type="button">Bearbeiten</button>
        <button type="button">Umbenennen</button>
      </>
    );
    const grouped =
      /<span class="[^"]*gap-2[^"]*"><button[^>]*>Bearbeiten<\/button><button[^>]*>Umbenennen<\/button><\/span>/;
    const variants = [
      jorna, // npc header
      file("location", { id: "leuchtturm", name: "Leuchtturm" }),
      file("chapter", { id: "01-salzhafen", title: "Salzhafen" }),
    ];
    for (const f of variants) {
      expect(renderToStaticMarkup(<EntityArticle file={f} actions={actions} />)).toMatch(grouped);
    }
    // No actions, no wrapper markup.
    expect(render(jorna)).not.toMatch(/<span class="[^"]*gap-2[^"]*"><\/span>/);
  });

  test("campaign and unknown kinds render the same quiet titled header", () => {
    expect(render(file("campaign", { id: "beispiel", name: "Beispiel" }))).toContain("Beispiel");
    const unknown = render(file("unknown", {}, "Freitext.\n"));
    expect(unknown).toContain("Freitext.");
    expect(unknown).not.toContain("Geplante Szene");
  });
});
