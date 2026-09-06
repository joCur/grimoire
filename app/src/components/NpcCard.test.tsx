// The one thing the NPC card decides WITHOUT the server (issue #70 audit).
//
// `npcs:` holds ids. A non-slug entry is no id and therefore no entry — the
// server refuses new ones, and what can still stand in the list is what a
// migrated file era campaign brought along. Asking for `npcs/Alte
// Fischerin.md` answers 404, which the card reported as "NPC nicht ladbar,
// Server prüfen": it blamed the server for data it had been handed. The card
// does not ask at all now and says what is actually the case.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

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
    expect(html).toContain("keine NPC-id, deshalb kein Eintrag.");
    expect(html).not.toContain("Server prüfen");
  });

  test("an id claims nothing while the query runs", () => {
    // Loading is silence — never a card, never a failure line.
    expect(render("fenn")).toBe("");
  });
});
