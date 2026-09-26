// The location's aside card: what it shows of a location — and a `[[slug]]`
// inside the excerpt reads as the current name, the way the rendered text
// shows it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import type { Location } from "@grimoire/shared/location";

import { translator } from "@/i18n/format";
import { RefScope, type ResolvedRef } from "@/markdown/refs";

import { LocationCard } from "./LocationCard";
import { locationKey } from "./location-query";

const t = translator("de");

describe("LocationCard — a reference inside the excerpt", () => {
  // The tree's answer for the slug the rows below mention.
  const index = new Map<string, ResolvedRef>([
    ["fenn", { kind: "npc", slug: "fenn", name: "Fenn" }],
  ]);

  /** A location card over a cached location — the location's own resource (decisions/resources). */
  function renderLocation(fields: Partial<Location>): string {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const location: Location = { id: "quay", name: "The Quay", body: "", rev: 1, ...fields };
    client.setQueryData(locationKey("example", "quay"), location);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RefScope campaign="example" index={index}>
            <LocationCard campaign="example" id="quay" />
          </RefScope>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  test("the atmosphere reads with names", () => {
    const html = renderLocation({ atmosphere: "The quay smells of [[fenn]]s pipe tobacco." });
    expect(html).toContain("The quay smells of Fenns pipe tobacco.");
    expect(html).not.toContain("[[fenn]]");
  });

  test("a `## Atmosphere` section is not read — the Roll20 page stands in", () => {
    const html = renderLocation({
      roll20Page: "Quay",
      body: "## Atmosphere\n\nOnly in the text, never on the card.\n",
    });
    expect(html).not.toContain("Only in the text");
    expect(html).toContain(t("locationCard.roll20", { value: "Quay" }));
  });
});
