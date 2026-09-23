// The aside cards (NPC, location): what they show of an entry.
//
// `npcs:` holds ids. A non-slug entry is no id and therefore no entry — the
// server refuses one. Asking for `npcs/Alte Fischerin` answers 404, which
// the card used to report as "not loadable, check the server": it blamed the
// server for data it had been handed. The card does not ask at all now and
// says what is actually the case.
//
// And a `[[slug]]` inside the excerpt a card shows reads as the current
// name, the way the rendered text shows it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { EntityRefScope, type ResolvedEntityRef } from "@/markdown/entity-refs";

import { LocationCard } from "./LocationCard";
import { NpcCard } from "./NpcCard";

function render(id: string): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NpcCard campaign="beispiel" id={id} />
    </QueryClientProvider>,
  );
}

describe("NpcCard — a reference that is no id", () => {
  test("free text says so, and does not blame the server", () => {
    const html = render("Alte Fischerin");
    expect(html).toContain("Alte Fischerin");
    expect(html).toContain("keine NPC-Kennung, deshalb kein Eintrag.");
    expect(html).not.toContain("Server prüfen");
  });

  test("an id claims nothing while the query runs", () => {
    // Loading is silence — never a card, never a failure line.
    expect(render("fenn")).toBe("");
  });
});

describe("aside cards — a reference inside the excerpt", () => {
  // The tree's answer for the two slugs the entries below mention.
  const index = new Map<string, ResolvedEntityRef>([
    ["fenn", { kind: "npc", slug: "fenn", name: "Fenn", path: "npcs/fenn" }],
    ["bucht", { kind: "location", slug: "bucht", name: "Die Nordbucht", path: "locations/bucht" }],
  ]);

  function renderCached(
    path: string,
    properties: Record<string, unknown>,
    body: string,
    card: ReactNode,
  ): string {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["entry", "beispiel", path], {
      path,
      kind: path.startsWith("npcs/") ? "npc" : "location",
      properties,
      body,
      rev: 1,
    });
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <EntityRefScope campaign="beispiel" index={index}>
            {card}
          </EntityRefScope>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const MOTIVATION = "Will [[fenn]] aus [[bucht]] vertreiben, bevor [[niemand]] fragt.";

  test("NPC card, both densities: the name, not the brackets", () => {
    for (const compact of [false, true]) {
      const html = renderCached(
        "npcs/grella",
        { motivation: MOTIVATION },
        "",
        <NpcCard campaign="beispiel" id="grella" compact={compact} />,
      );
      expect(html).toContain("Will Fenn aus Die Nordbucht vertreiben");
      expect(html).not.toContain("[[fenn]]");
      // Unresolved stays as written, exactly as the text shows it.
      expect(html).toContain("[[niemand]]");
    }
  });

  test("NPC card: a `## Will` section in the body shows nowhere on the card", () => {
    for (const compact of [false, true]) {
      const html = renderCached(
        "npcs/grella",
        {},
        "## Will\n\nNur im Text, nie auf der Karte.\n",
        <NpcCard campaign="beispiel" id="grella" compact={compact} />,
      );
      expect(html).not.toContain("Nur im Text");
    }
  });

  test("location card: the atmosphere reads with names", () => {
    const html = renderCached(
      "locations/kai",
      { atmosphere: "Hier riecht es nach [[fenn]]s Tabak." },
      "",
      <LocationCard campaign="beispiel" id="kai" />,
    );
    expect(html).toContain("Hier riecht es nach Fenns Tabak.");
    expect(html).not.toContain("[[fenn]]");
  });

  test("location card: a `## Atmosphäre` section is not read — the Roll20 page stands in", () => {
    const html = renderCached(
      "locations/kai",
      { "roll20-page": "Kai" },
      "## Atmosphäre\n\nNur im Text, nie auf der Karte.\n",
      <LocationCard campaign="beispiel" id="kai" />,
    );
    expect(html).not.toContain("Nur im Text");
    expect(html).toContain("Roll20-Seite: Kai");
  });
});
