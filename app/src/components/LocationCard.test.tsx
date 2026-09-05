// Render tests for the pure halves of the live aside's cards (issue #40):
// the location degradation, and the two shapes of the shared card shell —
// a link in the reading views, a button in the live mode (where a click must
// open the drawer instead of leaving the running session).

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { EntityCardShell } from "./EntityCardShell";
import { MissingLocationCard } from "./LocationCard";

describe("MissingLocationCard", () => {
  test("shows the mono slug and the reason, and offers no action", () => {
    const html = renderToStaticMarkup(<MissingLocationCard id="leuchtturm" />);
    expect(html).toContain("leuchtturm");
    expect(html).toContain("font-mono");
    expect(html).toContain("Ortsdatei fehlt");
    expect(html).not.toContain("<button");
  });
});

describe("EntityCardShell", () => {
  const render = (onOpen?: (path: string) => void) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <EntityCardShell campaign="beispiel" path="npcs/jorna.md" onOpen={onOpen}>
          <span>Jorna</span>
        </EntityCardShell>
      </MemoryRouter>,
    );

  test("without onOpen it is a link into the reading view", () => {
    const html = render();
    expect(html).toContain('href="/beispiel/file/npcs/jorna.md"');
    expect(html).not.toContain("<button");
  });

  test("with onOpen it is a button — nothing navigates in the live mode", () => {
    const html = render(() => {});
    expect(html).toContain("<button");
    expect(html).not.toContain("href=");
  });
});
