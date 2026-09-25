// Render test for one row of a chapter's threads.
//
// A thread is one ROW under its chapter: the tick is a real checkbox named
// by the thread's text, the two row controls carry the text in their names
// too (a column of bare "edit" buttons says nothing about which row it
// edits), and the „neu" note appears only on a row adopted in this sitting.
// The row the example campaign brings is the one used here.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Thread } from "@grimoire/shared/thread";

import { ThreadRow } from "./ThreadList";

const SEEDED: Thread = {
  id: "wer-bezahlt-die-schmuggler",
  chapter: "01-salzhafen",
  text: "Wer bezahlt die Schmuggler?",
  done: false,
  rev: 1,
};

function render(row: Thread, over: { isNew?: boolean; locked?: boolean } = {}): string {
  return renderToStaticMarkup(
    <ul>
      <ThreadRow
        row={row}
        isNew={over.isNew ?? false}
        locked={over.locked ?? false}
        onTick={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </ul>,
  );
}

describe("ThreadRow", () => {
  test("an open thread: an unticked checkbox named by its text", () => {
    const html = render(SEEDED);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('aria-label="„Wer bezahlt die Schmuggler?“ erledigt"');
    expect(html).not.toContain("checked");
    expect(html).toContain('aria-label="„Wer bezahlt die Schmuggler?“ bearbeiten"');
    expect(html).toContain('aria-label="„Wer bezahlt die Schmuggler?“ löschen"');
  });

  test("a ticked thread is checked and reads muted", () => {
    const html = render({ ...SEEDED, done: true });
    expect(html).toContain('checked=""');
    expect(html).toContain("text-muted-foreground");
  });

  test("the „neu“ note only on a row adopted in this sitting", () => {
    expect(render(SEEDED)).not.toContain("neu aus der Nachbereitung");
    expect(render(SEEDED, { isNew: true })).toContain("neu aus der Nachbereitung");
  });

  test("while a write is on the wire or the list is stale, nothing is clickable", () => {
    const html = render(SEEDED, { locked: true });
    expect(html.match(/disabled=""/g)?.length).toBe(3);
  });
});
