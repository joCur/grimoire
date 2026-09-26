// The npc's aside card: what it shows of an npc.
//
// `npcs:` holds ids. A non-slug value is no id and therefore no npc — the
// server refuses one. Asking for `Old fisherwoman` would answer 404 and blame
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

import type { Npc } from "@grimoire/shared/npc";

import { translator } from "@/i18n/format";
import { RefScope, type ResolvedRef } from "@/markdown/refs";

import { NpcCard } from "./NpcCard";
import { npcKey } from "./npc-query";

// Rendered outside a provider, the card speaks the default language.
const t = translator("de");

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
    const id = "Old fisherwoman";
    const html = render(id);
    // The id sits in its own mono span, so the sentence is compared as text.
    const text = html.replace(/<[^>]+>/g, "");
    expect(html).toContain(id);
    expect(text).toContain(t("npcCard.noId", { id }));
    expect(text).not.toContain(t("npcCard.unloadable", { id }));
  });

  test("an id claims nothing while the query runs", () => {
    // Loading is silence — never a card, never a failure line.
    expect(render("fenn")).toBe("");
  });
});

describe("NpcCard — a reference inside the excerpt", () => {
  // The tree's answer for the two slugs the rows below mention.
  const index = new Map<string, ResolvedRef>([
    ["fenn", { kind: "npc", slug: "fenn", name: "Fenn" }],
    ["cove", { kind: "location", slug: "cove", name: "The North Cove" }],
  ]);

  /** An npc card over a cached npc — the npc's own resource (decisions/resources). */
  function renderNpc(fields: Partial<Npc>, card: ReactNode): string {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const npc: Npc = { id: "grella", name: "Grella", status: "unknown", body: "", rev: 1, ...fields };
    client.setQueryData(npcKey("beispiel", "grella"), npc);
    return renderWith(client, card);
  }

  function renderWith(client: QueryClient, card: ReactNode): string {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RefScope campaign="beispiel" index={index}>
            {card}
          </RefScope>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const MOTIVATION = "Wants to drive [[fenn]] out of [[cove]] before [[nobody]] asks.";

  test("NPC card, both densities: the name, not the brackets, and a link to the npc", () => {
    for (const compact of [false, true]) {
      const html = renderNpc(
        { motivation: MOTIVATION },
        <NpcCard campaign="beispiel" id="grella" compact={compact} />,
      );
      expect(html).toContain("Wants to drive Fenn out of The North Cove before");
      expect(html).not.toContain("[[fenn]]");
      // Unresolved stays as written, exactly as the text shows it.
      expect(html).toContain("[[nobody]]");
      expect(html).toContain('href="/campaigns/beispiel/npcs/grella"');
    }
  });

  test("NPC card: a `## Will` section in the body shows nowhere on the card", () => {
    for (const compact of [false, true]) {
      const html = renderNpc(
        { body: "## Will\n\nOnly in the text, never on the card.\n" },
        <NpcCard campaign="beispiel" id="grella" compact={compact} />,
      );
      expect(html).not.toContain("Only in the text");
    }
  });
});
