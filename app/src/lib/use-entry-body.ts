// React-query half of the body editor (issue #15) — the mirror of
// use-scene-status.ts, one field further down the file.
//
// The cache/409 mechanics are the shared envelope in use-rev-write.ts, the
// "is there a rev to write against at all?" gate is `withRev`. What is
// specific here: a body write feeds the tree AND the search index, a conflict
// keeps the editor open with the DM's text, and `rev` must be the version
// the editor's text was SEEDED from — not whatever the entry query holds right
// now. The 5s version poll (issue #8) refetches this entry while the editor is
// open, and taking the poll's rev would make an external edit invisible: the
// save would silently overwrite it instead of answering 409. Hence
// `onConflict`, which hands the caller the re-read entry so it can move its
// base version exactly once, knowingly.

import type { EntryResponse } from "@grimoire/shared/types";

import { writeEntryBody } from "@/lib/entry-body";
import { useRevWriteMutation } from "@/lib/use-rev-write";
import { withRev } from "@/lib/write-with-rev";

export interface EntryBodyMutation {
  /** Start a write; ignored while another one is in flight. */
  save: (body: string) => void;
  /** True while the write runs — the button reads „Speichere …". */
  isSaving: boolean;
  /** Quiet inline message: rev conflict, or a failed write. */
  message?: string | undefined;
}

/**
 * `onSaved` runs after a SUCCESSFUL write only — that is where the route
 * leaves edit mode. A conflict or an error keeps the editor open on purpose;
 * `onConflict` then carries the re-read entry (undefined when even the reload
 * failed) so the next attempt starts from the version on disk.
 */
export function useEntryBodyMutation(
  campaign: string,
  path: string,
  rev: number | undefined,
  {
    onSaved,
    onConflict,
  }: {
    onSaved: () => void;
    onConflict: (file: EntryResponse | undefined) => void;
  },
): EntryBodyMutation {
  const { write, isPending, message } = useRevWriteMutation<string>({
    write: withRev(rev, (body, rev) => writeEntryBody(campaign, path, body, rev)),
    fileKey: ["file", campaign, path],
    // The body feeds the tree's counts/titles and the search index, so
    // neither the campaign's lists nor ⌘K may keep the old text.
    invalidateOnSuccess: [
      ["tree", campaign],
      ["search", campaign],
    ],
    onSaved,
    onConflict,
  });

  return {
    save: write,
    isSaving: isPending,
    message,
  };
}
