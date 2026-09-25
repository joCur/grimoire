// The location's aside card: what it shows of a location — and a `[[slug]]`
// inside the excerpt reads as the current name, the way the rendered text
// shows it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import type { Location } from "@grimoire/shared/types";

import { EntityRefScope, type ResolvedEntityRef } from "@/markdown/entity-refs";

import { LocationCard } from "./LocationCard";
import { locationKey } from "./location-query";

describe("LocationCard — a reference inside the excerpt", () => {
  // The tree's answer for the slug the rows below mention.
  const index = new Map<string, ResolvedEntityRef>([
    ["fenn", { kind: "npc", slug: "fenn", name: "Fenn" }],
  ]);

  /** A location card over a cached location — the location's own resource (ADR #31). */
  function renderLocation(fields: Partial<Location>): string {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const location: Location = { id: "kai", name: "Der Kai", body: "", rev: 1, ...fields };
    client.setQueryData(locationKey("beispiel", "kai"), location);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <EntityRefScope campaign="beispiel" index={index}>
            <LocationCard campaign="beispiel" id="kai" />
          </EntityRefScope>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  test("the atmosphere reads with names", () => {
    const html = renderLocation({ atmosphere: "Hier riecht es nach [[fenn]]s Tabak." });
    expect(html).toContain("Hier riecht es nach Fenns Tabak.");
    expect(html).not.toContain("[[fenn]]");
  });

  test("a `## Atmosphäre` section is not read — the Roll20 page stands in", () => {
    const html = renderLocation({
      roll20Page: "Kai",
      body: "## Atmosphäre\n\nNur im Text, nie auf der Karte.\n",
    });
    expect(html).not.toContain("Nur im Text");
    expect(html).toContain("Roll20-Seite: Kai");
  });
});
