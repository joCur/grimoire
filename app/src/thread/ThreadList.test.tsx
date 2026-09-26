// Render test for one row of a chapter's threads.
//
// A thread is one ROW under its chapter: the tick is a real checkbox named
// by the thread's text, the two row controls carry the text in their names
// too (a column of bare "edit" buttons says nothing about which row it
// edits), and the "new" note appears only on a row adopted in this sitting.
// The row used here is modeled on the thread of the example campaign.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Thread } from "@grimoire/shared/thread";

import { translator } from "@/i18n/format";

import { ThreadRow } from "./ThreadList";

const t = translator("de");

const SEEDED: Thread = {
  id: "who-pays-the-smugglers",
  chapter: "01-salt-harbour",
  text: "Who pays the smugglers?",
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
    expect(html).toContain(`aria-label="${t("chapterOverview.threads.done.aria", { text: SEEDED.text })}"`);
    expect(html).not.toContain("checked");
    expect(html).toContain(`aria-label="${t("chapterOverview.threads.edit.aria", { text: SEEDED.text })}"`);
    expect(html).toContain(`aria-label="${t("chapterOverview.threads.remove.aria", { text: SEEDED.text })}"`);
  });

  test("a ticked thread is checked and reads muted", () => {
    const html = render({ ...SEEDED, done: true });
    expect(html).toContain('checked=""');
    expect(html).toContain("text-muted-foreground");
  });

  test("the \"new\" note only on a row adopted in this sitting", () => {
    const note = t("chapterOverview.threads.new");
    expect(render(SEEDED)).not.toContain(note);
    expect(render(SEEDED, { isNew: true })).toContain(note);
  });

  test("while a write is on the wire or the list is stale, nothing is clickable", () => {
    const html = render(SEEDED, { locked: true });
    expect(html.match(/disabled=""/g)?.length).toBe(3);
  });
});
