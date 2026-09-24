// The aside cards (NPC, location): what they show of an npc or a location.
//
// `npcs:` holds ids. A non-slug value is no id and therefore no npc — the
// server refuses one. Asking for `Alte Fischerin` would answer 404 and blame
// the server for data it had been handed, so the card does not ask at all
// and says what is actually the case.
//
// And a `[[slug]]` inside the excerpt a card shows reads as the current
// name, the way the rendered text shows it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import type { Location, Npc } from "@grimoire/shared/types";

import { locationKey } from "@/lib/use-location-edit";
import { npcKey } from "@/lib/use-npc-edit";
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
  // The tree's answer for the two slugs the rows below mention.
  const index = new Map<string, ResolvedEntityRef>([
    ["fenn", { kind: "npc", slug: "fenn", name: "Fenn" }],
    ["bucht", { kind: "location", slug: "bucht", name: "Die Nordbucht" }],
  ]);

  /** An npc card over a cached npc — the npc's own resource (ADR #31). */
  function renderNpc(fields: Partial<Npc>, card: ReactNode): string {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const npc: Npc = { id: "grella", name: "Grella", status: "unknown", body: "", rev: 1, ...fields };
    client.setQueryData(npcKey("beispiel", "grella"), npc);
    return renderWith(client, card);
  }

  /** A location card over a cached location — the location's own resource (ADR #31). */
  function renderLocation(fields: Partial<Location>, card: ReactNode): string {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const location: Location = { id: "kai", name: "Der Kai", body: "", rev: 1, ...fields };
    client.setQueryData(locationKey("beispiel", "kai"), location);
    return renderWith(client, card);
  }

  function renderWith(client: QueryClient, card: ReactNode): string {
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

  test("NPC card, both densities: the name, not the brackets, and a link to the npc", () => {
    for (const compact of [false, true]) {
      const html = renderNpc(
        { motivation: MOTIVATION },
        <NpcCard campaign="beispiel" id="grella" compact={compact} />,
      );
      expect(html).toContain("Will Fenn aus Die Nordbucht vertreiben");
      expect(html).not.toContain("[[fenn]]");
      // Unresolved stays as written, exactly as the text shows it.
      expect(html).toContain("[[niemand]]");
      expect(html).toContain('href="/campaigns/beispiel/npcs/grella"');
    }
  });

  test("NPC card: a `## Will` section in the body shows nowhere on the card", () => {
    for (const compact of [false, true]) {
      const html = renderNpc(
        { body: "## Will\n\nNur im Text, nie auf der Karte.\n" },
        <NpcCard campaign="beispiel" id="grella" compact={compact} />,
      );
      expect(html).not.toContain("Nur im Text");
    }
  });

  test("location card: the atmosphere reads with names", () => {
    const html = renderLocation(
      { atmosphere: "Hier riecht es nach [[fenn]]s Tabak." },
      <LocationCard campaign="beispiel" id="kai" />,
    );
    expect(html).toContain("Hier riecht es nach Fenns Tabak.");
    expect(html).not.toContain("[[fenn]]");
  });

  test("location card: a `## Atmosphäre` section is not read — the Roll20 page stands in", () => {
    const html = renderLocation(
      { roll20Page: "Kai", body: "## Atmosphäre\n\nNur im Text, nie auf der Karte.\n" },
      <LocationCard campaign="beispiel" id="kai" />,
    );
    expect(html).not.toContain("Nur im Text");
    expect(html).toContain("Roll20-Seite: Kai");
  });
});
