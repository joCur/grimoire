// Render test for one row of a chapter's open threads, and the reading of a
// refused thread write.
//
// A thread is a ROW of the chapter's list: the tick is a real checkbox named
// by the thread's text, the two row controls carry the text in their names
// too (a column of bare "edit" buttons says nothing about which row it
// edits), and the „neu" note appears only on a row adopted in this sitting.
// The row the example campaign brings is the one used here.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ThreadEntry } from "@grimoire/shared";

import { ApiError, threadsConflict } from "@/api";

import { ThreadRow } from "./ChapterThreads";

const SEEDED: ThreadEntry = { id: "t-1", text: "Wer bezahlt die Schmuggler?", done: false };

function render(row: ThreadEntry, over: { isNew?: boolean; locked?: boolean } = {}): string {
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

describe("threadsConflict", () => {
  const list = { entries: [SEEDED], rev: 4 };

  test("a 409 hands back the list it was refused against", () => {
    const error = new ApiError(409, "conflict", { code: "rev_conflict", rev: 4, threads: list });
    expect(threadsConflict(error)).toEqual(list);
  });

  test("anything else is no thread conflict, and a 409 without a list degrades", () => {
    expect(threadsConflict(new ApiError(404, "gone", {}))).toBeUndefined();
    expect(threadsConflict(new Error("offline"))).toBeUndefined();
    expect(threadsConflict(new ApiError(409, "conflict", { rev: 4 }))).toBeUndefined();
    expect(threadsConflict(new ApiError(409, "conflict", { threads: { rev: "x" } }))).toBeUndefined();
  });
});
