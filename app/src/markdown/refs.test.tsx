// Resolution of `[[slug]]` references at render time: the
// slug→entity index (kind priority!) and the two shapes of a reference —
// a link in the reading views, a button in the live mode.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { I18nProvider } from "@/i18n";
import { translator, type Translate } from "@/i18n/format";
import type { OpenTarget } from "@/lib/open-target";

import { Markdown } from "./Markdown";
import { RefScope, refIndex } from "./refs";

/** The accessible name of a reference in one language. */
function refAria(t: Translate, kind: "npc" | "location", name: string): string {
  return `aria-label="${t("markdown.ref.aria", { kind: t(`kind.${kind}`), name })}"`;
}

const de = translator("de");
const en = translator("en");

const TREE: CampaignTree = {
  campaign: "example",
  chapters: [
    {
      id: "01-salt-harbour",
      title: "Chapter 1",
      scenes: [
        {
          id: "lighthouse-arrival",
          title: "Arrival at the lighthouse",
          type: "planned",
          status: "ready",
          npcs: [],
          tags: [],
        },
        // Same slug as the npc below — the collision case.
        {
          id: "jorna",
          title: "Scene called jorna",
          type: "planned",
          status: "draft",
          npcs: [],
          tags: [],
        },
      ],
    },
  ],
  npcs: [
    { id: "jorna", name: "Harbourmaster Jorna", status: "alive" },
    // No display name at all — the id is the honest fallback.
    { id: "nameless", name: "", status: "alive" },
  ],
  locations: [
    { id: "lighthouse", name: "The Lighthouse" },
    // Collides with the scene id above; the location must win over a scene.
    { id: "lighthouse-arrival", name: "Duplicate location" },
  ],
  sessions: [],
};

describe("refIndex", () => {
  const index = refIndex(TREE);

  test("a location resolves by its id — its own resource, no address (decisions/resources)", () => {
    expect(index.get("lighthouse")).toEqual({
      kind: "location",
      slug: "lighthouse",
      name: "The Lighthouse",
    });
  });

  test("an npc resolves by its id — its own resource, no address (decisions/resources)", () => {
    expect(index.get("jorna")).toEqual({
      kind: "npc",
      slug: "jorna",
      name: "Harbourmaster Jorna",
    });
  });

  test("kind priority: npc beats location beats scene", () => {
    expect(index.get("jorna")?.kind).toBe("npc");
    expect(index.get("lighthouse-arrival")?.kind).toBe("location");
  });

  test("a scene resolves by its id when no npc or location claims the slug", () => {
    expect(refIndex(TREE).get("jorna")?.name).toBe("Harbourmaster Jorna");
    const sceneOnly = refIndex({ ...TREE, npcs: [], locations: [] });
    expect(sceneOnly.get("lighthouse-arrival")).toEqual({
      kind: "scene",
      slug: "lighthouse-arrival",
      name: "Arrival at the lighthouse",
    });
  });

  test("an empty display name falls back to the slug", () => {
    expect(index.get("nameless")?.name).toBe("nameless");
  });

  test("no tree yet: nothing resolves (and nothing throws)", () => {
    expect(refIndex(undefined).size).toBe(0);
  });
});

describe("rendered references", () => {
  const render = (markdown: string, onOpen?: (target: OpenTarget) => void) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <RefScope campaign="example" index={refIndex(TREE)} onOpen={onOpen}>
          <Markdown>{markdown}</Markdown>
        </RefScope>
      </MemoryRouter>,
    );

  test("resolved: the current name as a link into the npc's own route", () => {
    const html = render("On the quay waits [[jorna]]s boat.");
    expect(html).toContain('href="/campaigns/example/npcs/jorna"');
    expect(html).toContain("Harbourmaster Jorna");
    // The suffix stays outside the reference.
    expect(html).toContain("s boat.");
    expect(html).not.toContain("[[jorna]]");
  });

  test("a location reference links to the location's own route", () => {
    expect(render("[[lighthouse]]")).toContain('href="/campaigns/example/locations/lighthouse"');
  });

  test("live mode: a button, so nothing navigates away", () => {
    const html = render("[[jorna]] waits.", () => {});
    expect(html).toContain("<button");
    expect(html).not.toContain("href=");
  });

  test("unresolved: the source text stands, without a link or a warning", () => {
    const html = render("Who is [[nobody]]?");
    expect(html).toContain("[[nobody]]");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("destructive");
  });

  test("the accessible name says WHAT the reference points at", () => {
    expect(render("[[lighthouse]]")).toContain(refAria(de, "location", "The Lighthouse"));
    expect(render("[[jorna]]")).toContain(refAria(de, "npc", "Harbourmaster Jorna"));
  });

  test("…in the UI language, from the shared `kind.*` labels", () => {
    // Outside a provider `useT` degrades to German, which is what every other
    // assertion here reads; with an instance set to English the SAME labels
    // the ⌘K rows and the properties dialog use have to come out.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["settings"], { locale: "en" });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <MemoryRouter>
            <RefScope campaign="example" index={refIndex(TREE)}>
              <Markdown>{"[[lighthouse]] and [[jorna]]"}</Markdown>
            </RefScope>
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain(refAria(en, "location", "The Lighthouse"));
    expect(html).toContain(refAria(en, "npc", "Harbourmaster Jorna"));
    expect(html).not.toContain(refAria(de, "location", "The Lighthouse"));
  });

  test("in an `## If:` summary the name is TEXT — the row stays a toggle", () => {
    const html = render("## If: [[jorna]] was warned\n\nThen [[jorna]] fetches them.");
    const summary = /<summary[\s\S]*?<\/summary>/.exec(html)?.[0] ?? "";
    expect(summary).toContain("Harbourmaster Jorna was warned");
    expect(summary).not.toContain("<a ");
    expect(summary).not.toContain("<button");
    // The section BODY still gets the interactive reference.
    expect(html).toContain('href="/campaigns/example/npcs/jorna"');
  });

  test("a reference in inline code is neither resolved nor linked", () => {
    const html = render("The syntax is `[[jorna]]`.");
    expect(html).toContain("<code>[[jorna]]</code>");
    expect(html).not.toContain("Harbourmaster");
  });

  test("a reference inside a read-aloud resolves too", () => {
    // The clipboard payload is expanded with the same resolver (Markdown.tsx
    // `CalloutSection`) — it lives in a prop, not in the markup, so what this
    // pins is that the callout still IS one and its text resolved.
    const html = render("> [!readaloud] [[jorna]] does not look at you.");
    expect(html).toContain('data-callout="readaloud"');
    expect(html).toContain("Harbourmaster Jorna</a> does not look at you.");
    expect(html).not.toContain("[[jorna]]");
  });
});
