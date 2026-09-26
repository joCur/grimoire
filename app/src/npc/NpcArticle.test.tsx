// Render tests for the npc's reading view (react-dom/server — no DOM): the
// npc read straight from its own type (decisions/resources) — name, status, the lines the
// table needs and the text, never the scene type overline. The npc is the
// example campaign's own fixture, as its resource answers it.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { Npc } from "@grimoire/shared/npc";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { NpcArticle } from "./NpcArticle";

const t = translator("de");

const FIXTURES = path.resolve(import.meta.dirname, "../../../fixtures/beispiel/npcs");

/** An npc fixture — the npc as its resource answers it. */
function npcFixture(id: string): Npc {
  const stored = JSON.parse(readFileSync(path.join(FIXTURES, `${id}.json`), "utf8")) as Omit<
    Npc,
    "rev"
  >;
  return { ...stored, rev: 1 };
}

const jorna = npcFixture("jorna");

function render(npc: Npc): string {
  return renderToStaticMarkup(<NpcArticle npc={npc} />);
}

describe("NpcArticle", () => {
  test("name, role, status label, voice, appearance and quick stats", () => {
    const html = render(jorna);
    expect(html).toContain("Hafenmeisterin Jorna");
    expect(html).toContain("Auftraggeberin, Hafenmeisterin von Salzhafen");
    expect(html).toContain(t("status.npc.alive"));
    expect(html).toContain("knapp, wetterrau, duzt jeden");
    expect(html).toContain("Ölmantel, graue Flechte");
    expect(html).toContain("insight 2");
    expect(html).toContain("passive-perception 12");
  });

  test("the motivation stands in the header, labelled like the card", () => {
    const html = render(jorna);
    expect(html).toContain(t("npcCard.will.inline"));
    expect(html).toContain("Das Leuchtfeuer muss wieder brennen");
  });

  test("the statblock is a plain reference line, never a link", () => {
    const html = render(jorna);
    expect(html).toContain(t("entity.npc.statblock", { value: "Roll20: Jorna" }));
    expect(html).not.toContain("<a ");
  });

  test("the text goes through the markdown pipeline, without a scene overline", () => {
    const html = render(jorna);
    expect(html).toContain("Ahnt, dass jemand im Dorf die Schmuggler deckt");
    expect(html).not.toContain(t("sceneArticle.type.planned"));
    expect(html).not.toContain(t("sceneArticle.type.contingency"));
  });

  test("an npc with nothing but its id is a normal, thin page", () => {
    // What a brand-new npc looks like before anybody fills it in: the id as
    // the name, the neutral status, no field rows.
    const html = render({ id: "holm", name: "holm", status: "unknown", body: "", rev: 1 });
    expect(html).toContain("holm");
    expect(html).toContain(t("status.npc.unknown"));
    expect(html).not.toContain(t("entity.npc.statblock", { value: "" }));
    expect(html).not.toContain(t("npcCard.will.inline"));
  });

  test("the actions stay ONE spaced group; an editor replaces the text", () => {
    const html = renderToStaticMarkup(
      <NpcArticle
        npc={jorna}
        actions={
          <>
            {/* Stand-in caller markup, not app copy. */}
            <button type="button">{"First"}</button>
            <button type="button">{"Second"}</button>
          </>
        }
        body={<textarea defaultValue={"Draft"} />}
      />,
    );
    expect(html).toMatch(
      /<span class="[^"]*gap-2[^"]*"><button[^>]*>First<\/button><button[^>]*>Second<\/button><\/span>/,
    );
    expect(html).not.toContain("Ahnt, dass jemand im Dorf");
  });
});
