// Render tests for the location's reading view (react-dom/server — no DOM):
// the location read straight from its own type (decisions/resources) — name, atmosphere,
// the Roll20 reference line and the text, never the scene type overline.

import type { Location } from "@grimoire/shared/location";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { translator } from "@/i18n/format";

import { LocationArticle } from "./LocationArticle";

const t = translator("de");

function location(fields: Partial<Location>): Location {
  return { id: "lighthouse", name: "The Lighthouse of Salt Harbour", body: "", rev: 1, ...fields };
}

describe("LocationArticle", () => {
  test("the name, the Roll20 page as a reference line and the text", () => {
    const html = renderToStaticMarkup(
      <LocationArticle
        location={location({ roll20Page: "Lighthouse", body: "## Who is here\n\nNobody.\n" })}
      />,
    );
    expect(html).toContain("The Lighthouse of Salt Harbour");
    expect(html).toContain(t("entity.location.roll20", { value: "Lighthouse" }));
    expect(html).toContain("Nobody.");
    expect(html).not.toContain(t("sceneArticle.type.planned"));
  });

  test("the atmosphere stands in the header", () => {
    const html = renderToStaticMarkup(
      <LocationArticle location={location({ atmosphere: "Fog, gulls, wet wood." })} />,
    );
    expect(html).toContain("Fog, gulls, wet wood.");
  });

  test("the actions stay ONE spaced group; an editor replaces the text", () => {
    const html = renderToStaticMarkup(
      <LocationArticle
        location={location({ body: "The saved text.\n" })}
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
    expect(html).not.toContain("The saved text.");
  });
});
