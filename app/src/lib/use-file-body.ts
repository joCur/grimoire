// React-query half of the body editor (issue #15) — the mirror of
// use-scene-status.ts, one field further down the file.
//
// The server file is the truth: the write sends the mtime of the FileResponse
// the editor was seeded from and seeds the RETURNED file into the cache; the
// cache is never written with the text we guessed. A 409 means nothing was
// written — the editor STAYS open with the DM's text, the quiet inline message
// appears and the file is re-read, so the next „Speichern" carries the fresh
// mtime and succeeds.
//
// `mtimeMs` must be the version the editor's text was SEEDED from, not
// whatever the file query holds right now: the 5s version poll (issue #8)
// refetches this file while the editor is open, and taking the poll's mtime
// would make an external edit invisible — the save would silently overwrite
// it instead of answering 409. Hence `onConflict`, which hands the caller the
// re-read file so it can move its base version exactly once, knowingly.

import type { FileResponse } from "@grimoire/shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  SAVE_FAILED_MESSAGE,
  STALE_FILE_MESSAGE,
  writeFileBody,
} from "@/lib/file-body";

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
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string>();

  const mutation = useMutation({
    mutationFn: (body: string) => {
      if (mtimeMs === undefined) throw new Error("no mtime yet");
      return writeFileBody(campaign, path, body, mtimeMs);
    },
    onMutate: () => {
      setMessage(undefined);
    },
    onSuccess: (result) => {
      const fileKey = ["file", campaign, path];
      // Whatever the server sent back — the written file, or the re-read one
      // after a conflict — is the new truth for this path.
      if (result.file !== undefined) queryClient.setQueryData(fileKey, result.file);
      void queryClient.invalidateQueries({ queryKey: fileKey });
      if (!result.ok) {
        setMessage(STALE_FILE_MESSAGE);
        onConflict(result.file);
        return;
      }
      // The body feeds the tree's counts/titles and the search index, so
      // neither the campaign's lists nor ⌘K may keep the old text.
      void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
      void queryClient.invalidateQueries({ queryKey: ["search", campaign] });
      onSaved();
    },
    onError: () => {
      setMessage(SAVE_FAILED_MESSAGE);
    },
  });

  return {
    save: (body: string) => {
      if (mutation.isPending || mtimeMs === undefined) return;
      mutation.mutate(body);
    },
    isSaving: mutation.isPending,
    message,
  };
}
