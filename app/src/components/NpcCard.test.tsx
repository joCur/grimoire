// Render test for the visible degradation of a missing npc file (issue #26).
// MissingNpcCard is the pure half of NpcCard — the query and the stub
// mutation stay in the card, so this needs no DOM and no query client.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MissingNpcCard } from "./NpcCard";

function render(props: Partial<Parameters<typeof MissingNpcCard>[0]> = {}): string {
  return renderToStaticMarkup(
    <MissingNpcCard id="alte-fischerin" pending={false} onCreate={() => {}} {...props} />,
  );
}

describe("MissingNpcCard", () => {
  test("shows the mono slug, the reason and the one action", () => {
    const html = render();
    expect(html).toContain("alte-fischerin");
    expect(html).toContain("font-mono");
    expect(html).toContain("NPC-Eintrag fehlt");
    expect(html).toContain("Stub anlegen");
  });

  test("the action is disabled while the stub is being written", () => {
    // The attribute, not the `disabled:` utility classes on the button.
    expect(render({ pending: true })).toContain('disabled=""');
    expect(render({ pending: false })).not.toContain('disabled=""');
  });

  test("a failed write shows a quiet error line", () => {
    const html = render({ error: "Stub nicht angelegt — Server prüfen." });
    expect(html).toContain("Stub nicht angelegt");
    expect(html).toContain('aria-live="polite"');
  });

  test("compact (live aside) and full (scene aside) both render the action", () => {
    expect(render({ compact: true })).toContain("Stub anlegen");
    expect(render({ compact: false })).toContain("Stub anlegen");
  });
});
