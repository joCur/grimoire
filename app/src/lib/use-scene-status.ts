// React-query half of the scene-status control (issue #28).
//
// The server file is the truth: the mutation sends the mtime of the
// FileResponse the UI is showing and seeds the RETURNED file into the cache —
// the cache is never written with a guessed value. While the write runs the
// control shows the target value dimmed (display only, see SceneStatusMenu).
// A 409 means nothing was written: the quiet inline message appears and the
// file is re-read, so the next attempt carries the fresh mtime.

import type { SceneStatus } from "@grimoire/shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { STALE_FILE_MESSAGE, writeSceneStatus } from "@/lib/scene-status";

export interface SceneStatusMutation {
  /** Start a write; ignored while another one is in flight. */
  setStatus: (status: SceneStatus) => void;
  /** The value being written right now — the control shows it dimmed. */
  pendingStatus?: SceneStatus | undefined;
  /** Quiet inline message: mtime conflict, or a failed write. */
  message?: string | undefined;
}

export function useSceneStatusMutation(
  campaign: string,
  path: string,
  mtimeMs: number | undefined,
): SceneStatusMutation {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string>();
  const [pendingStatus, setPendingStatus] = useState<SceneStatus>();

  const mutation = useMutation({
    mutationFn: (status: SceneStatus) => {
      if (mtimeMs === undefined) throw new Error("no mtime yet");
      return writeSceneStatus(campaign, path, mtimeMs, status);
    },
    onMutate: (status: SceneStatus) => {
      setMessage(undefined);
      setPendingStatus(status);
    },
    onSettled: () => {
      setPendingStatus(undefined);
    },
    onSuccess: (result) => {
      const fileKey = ["file", campaign, path];
      // Whatever the server sent back — the patched file, or the re-read one
      // after a conflict — is the new truth for this path.
      if (result.file !== undefined) queryClient.setQueryData(fileKey, result.file);
      void queryClient.invalidateQueries({ queryKey: fileKey });
      if (!result.ok) {
        setMessage(STALE_FILE_MESSAGE);
        return;
      }
      // The status lives in the tree as well (pool rows, live nav, search).
      void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
    },
    onError: () => {
      setMessage("Status nicht gespeichert — Server prüfen");
    },
  });

  return {
    setStatus: (status: SceneStatus) => {
      if (mutation.isPending || mtimeMs === undefined) return;
      mutation.mutate(status);
    },
    pendingStatus,
    message,
  };
}
