// Render tests for the location's reading view (react-dom/server — no DOM):
// the location read straight from its own type (decisions/resources) — name, atmosphere,
// the Roll20 reference line and the text, never the scene type overline.

import type { Location } from "@grimoire/shared/location";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LocationArticle } from "./LocationArticle";

function location(fields: Partial<Location>): Location {
  return { id: "leuchtturm", name: "Der Leuchtturm von Salzhafen", body: "", rev: 1, ...fields };
}

describe("LocationArticle", () => {
  test("the name, the Roll20 page as a reference line and the text", () => {
    const html = renderToStaticMarkup(
      <LocationArticle
        location={location({ roll20Page: "Leuchtturm", body: "## Wer ist hier\n\nNiemand.\n" })}
      />,
    );
    expect(html).toContain("Der Leuchtturm von Salzhafen");
    expect(html).toContain("Roll20-Seite: Leuchtturm");
    expect(html).toContain("Niemand.");
    expect(html).not.toContain("Geplante Szene");
  });

  test("the atmosphere stands in the header", () => {
    const html = renderToStaticMarkup(
      <LocationArticle location={location({ atmosphere: "Nebel, Möwen, nasses Holz." })} />,
    );
    expect(html).toContain("Nebel, Möwen, nasses Holz.");
  });

  test("the actions stay ONE spaced group; an editor replaces the text", () => {
    const html = renderToStaticMarkup(
      <LocationArticle
        location={location({ body: "Der gespeicherte Text.\n" })}
        actions={
          <>
            {/* Stand-in caller markup, not app copy. */}
            <button type="button">{"Bearbeiten"}</button>
            <button type="button">{"Eigenschaften"}</button>
          </>
        }
        body={<textarea defaultValue={"Entwurf"} />}
      />,
    );
    expect(html).toMatch(
      /<span class="[^"]*gap-2[^"]*"><button[^>]*>Bearbeiten<\/button><button[^>]*>Eigenschaften<\/button><\/span>/,
    );
    expect(html).not.toContain("Der gespeicherte Text.");
  });
});
