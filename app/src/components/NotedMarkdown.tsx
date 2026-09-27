// A body through the normal markdown pipeline, with the notes a page has about
// its lines (components/place-notes.tsx) standing right after the block each
// line sits in. The block and its notes form one group the notes describe.
// Without notes it is exactly the plain rendering.

import { splitAtLines } from "@grimoire/shared/blocks";
import { useMemo } from "react";

import { describedBy, PlaceNoteList, usePlaceNotes } from "@/components/place-notes";
import { Markdown } from "@/markdown/Markdown";

export function NotedMarkdown({ body }: { body: string }) {
  const { lines } = usePlaceNotes();
  const asked = useMemo(() => [...new Set(lines.map((entry) => entry.line))], [lines]);
  const pieces = useMemo(() => splitAtLines(body, asked), [body, asked]);
  if (asked.length === 0) return <Markdown>{body}</Markdown>;
  return (
    <>
      {pieces.map((piece, index) => {
        if (piece.lines.length === 0) return <Markdown key={index}>{piece.markdown}</Markdown>;
        const notes = lines
          .filter((entry) => piece.lines.includes(entry.line))
          .map((entry) => entry.note);
        return (
          <div key={index} role="group" aria-describedby={describedBy(notes)} data-testid="noted-block">
            {piece.markdown !== "" && <Markdown>{piece.markdown}</Markdown>}
            <PlaceNoteList notes={notes} className="mb-3" />
          </div>
        );
      })}
    </>
  );
}
