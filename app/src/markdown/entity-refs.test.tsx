// Resolution of `[[slug]]` references at render time (issue #68): the
// slug→entity index (kind priority!) and the two shapes of a reference —
// a link in the reading views, a button in the live mode.

import type { CampaignTree } from "@grimoire/shared/types";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { Markdown } from "./Markdown";
import { EntityRefScope, entityRefIndex } from "./entity-refs";

const TREE: CampaignTree = {
  campaign: "beispiel",
  chapters: [
    {
      id: "01-salzhafen",
      title: "Kapitel 1",
      groups: [
        {
          slug: "hafen",
          scenes: [
            {
              path: "01-salzhafen/hafen/lighthouse-arrival.md",
              id: "lighthouse-arrival",
              title: "Ankunft am Leuchtturm",
              type: "planned",
              status: "ready",
              npcs: [],
              tags: [],
            },
            // Same slug as the npc below — the collision case.
            {
              path: "01-salzhafen/hafen/jorna.md",
              id: "jorna",
              title: "Szene namens jorna",
              type: "planned",
              status: "draft",
              npcs: [],
              tags: [],
            },
          ],
        },
      ],
    },
  ],
  npcs: [
    { path: "npcs/jorna.md", id: "jorna", name: "Hafenmeisterin Jorna", status: "alive" },
    // No display name at all — the id is the honest fallback.
    { path: "npcs/namenlos.md", id: "namenlos", name: "", status: "alive" },
  ],
  locations: [
    { path: "locations/leuchtturm.md", id: "leuchtturm", name: "Der Leuchtturm" },
    // Collides with the scene id above; the location must win over a scene.
    { path: "locations/lighthouse-arrival.md", id: "lighthouse-arrival", name: "Ort-Dublette" },
  ],
  sessions: [],
};

describe("entityRefIndex", () => {
  const index = entityRefIndex(TREE);

  test("resolves all three kinds with the tree's own paths", () => {
    expect(index.get("leuchtturm")).toEqual({
      kind: "location",
      slug: "leuchtturm",
      name: "Der Leuchtturm",
      path: "locations/leuchtturm.md",
    });
  });

  test("kind priority: npc beats location beats scene", () => {
    expect(index.get("jorna")?.kind).toBe("npc");
    expect(index.get("lighthouse-arrival")?.kind).toBe("location");
  });

  test("a scene resolves when no npc or location claims the slug", () => {
    expect(entityRefIndex(TREE).get("jorna")?.name).toBe("Hafenmeisterin Jorna");
    const sceneOnly = entityRefIndex({ ...TREE, npcs: [], locations: [] });
    expect(sceneOnly.get("lighthouse-arrival")).toEqual({
      kind: "scene",
      slug: "lighthouse-arrival",
      name: "Ankunft am Leuchtturm",
      path: "01-salzhafen/hafen/lighthouse-arrival.md",
    });
  });

  test("an empty display name falls back to the slug", () => {
    expect(index.get("namenlos")?.name).toBe("namenlos");
  });

  test("no tree yet: nothing resolves (and nothing throws)", () => {
    expect(entityRefIndex(undefined).size).toBe(0);
  });
});

describe("rendered references", () => {
  const render = (markdown: string, onOpen?: (path: string) => void) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <EntityRefScope campaign="beispiel" index={entityRefIndex(TREE)} onOpen={onOpen}>
          <Markdown>{markdown}</Markdown>
        </EntityRefScope>
      </MemoryRouter>,
    );

  test("resolved: the current name as a link into the entity view", () => {
    const html = render("Am Kai wartet [[jorna]]s Boot.");
    expect(html).toContain('href="/beispiel/file/npcs/jorna.md"');
    expect(html).toContain("Hafenmeisterin Jorna");
    // The suffix stays outside the reference.
    expect(html).toContain("s Boot.");
    expect(html).not.toContain("[[jorna]]");
  });

  test("live mode: a button, so nothing navigates away", () => {
    const html = render("[[jorna]] wartet.", () => {});
    expect(html).toContain("<button");
    expect(html).not.toContain("href=");
  });

  test("unresolved: the source text stands, without a link or a warning", () => {
    const html = render("Wer ist [[niemand]]?");
    expect(html).toContain("[[niemand]]");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("destructive");
  });

  test("the accessible name says WHAT the reference points at", () => {
    expect(render("[[leuchtturm]]")).toContain('aria-label="Ort: Der Leuchtturm"');
    expect(render("[[jorna]]")).toContain('aria-label="NPC: Hafenmeisterin Jorna"');
  });

  test("in an `## If:` summary the name is TEXT — the row stays a toggle", () => {
    const html = render("## If: [[jorna]] gewarnt wurde\n\nDann holt [[jorna]] sie.");
    const summary = /<summary[\s\S]*?<\/summary>/.exec(html)?.[0] ?? "";
    expect(summary).toContain("Hafenmeisterin Jorna gewarnt wurde");
    expect(summary).not.toContain("<a ");
    expect(summary).not.toContain("<button");
    // The section BODY still gets the interactive reference.
    expect(html).toContain('href="/beispiel/file/npcs/jorna.md"');
  });

  test("a reference in inline code is neither resolved nor linked", () => {
    const html = render("Die Syntax heißt `[[jorna]]`.");
    expect(html).toContain("<code>[[jorna]]</code>");
    expect(html).not.toContain("Hafenmeisterin");
  });

  test("a reference inside a read-aloud resolves too", () => {
    // The clipboard payload is expanded with the same resolver (Markdown.tsx
    // `CalloutSection`) — it lives in a prop, not in the markup, so what this
    // pins is that the callout still IS one and its text resolved.
    const html = render("> [!readaloud] [[jorna]] sieht euch nicht an.");
    expect(html).toContain('data-callout="readaloud"');
    expect(html).toContain("Hafenmeisterin Jorna</a> sieht euch nicht an.");
    expect(html).not.toContain("[[jorna]]");
  });
});
