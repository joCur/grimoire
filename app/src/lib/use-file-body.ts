// React-query half of the body editor (issue #15) — the mirror of
// use-scene-status.ts, one field further down the file.
//
// The cache/409 mechanics are the shared envelope in use-mtime-write.ts. What
// is specific here: a body write feeds the tree AND the search index, a
// conflict keeps the editor open with the DM's text, and `mtimeMs` must be the
// version the editor's text was SEEDED from — not whatever the file query
// holds right now. The 5s version poll (issue #8) refetches this file while
// the editor is open, and taking the poll's mtime would make an external edit
// invisible: the save would silently overwrite it instead of answering 409.
// Hence `onConflict`, which hands the caller the re-read file so it can move
// its base version exactly once, knowingly.

import type { FileResponse } from "@grimoire/shared/types";

import { SAVE_FAILED_MESSAGE, writeFileBody } from "@/lib/file-body";
import { useMtimeWriteMutation } from "@/lib/use-mtime-write";

export interface FileBodyMutation {
  /** Start a write; ignored while another one is in flight. */
  save: (body: string) => void;
  /** True while the write runs — the button reads „Speichere …". */
  isSaving: boolean;
  /** Quiet inline message: mtime conflict, or a failed write. */
  message?: string | undefined;
}

/**
 * `onSaved` runs after a SUCCESSFUL write only — that is where the route
 * leaves edit mode. A conflict or an error keeps the editor open on purpose;
 * `onConflict` then carries the re-read file (undefined when even the reload
 * failed) so the next attempt starts from the version on disk.
 */
export function useFileBodyMutation(
  campaign: string,
  path: string,
  mtimeMs: number | undefined,
  {
    onSaved,
    onConflict,
  }: {
    onSaved: () => void;
    onConflict: (file: FileResponse | undefined) => void;
  },
): FileBodyMutation {
  const { write, isPending, message } = useMtimeWriteMutation<string>({
    write: (body) => {
      if (mtimeMs === undefined) throw new Error("no mtime yet");
      return writeFileBody(campaign, path, body, mtimeMs);
    },
    fileKey: ["file", campaign, path],
    // The body feeds the tree's counts/titles and the search index, so
    // neither the campaign's lists nor ⌘K may keep the old text.
    invalidateOnSuccess: [
      ["tree", campaign],
      ["search", campaign],
    ],
    errorMessage: SAVE_FAILED_MESSAGE,
    onSaved,
    onConflict,
  });

  return {
    save: (body: string) => {
      if (mtimeMs === undefined) return;
      write(body);
    },
    isSaving: isPending,
    message,
  };
}
