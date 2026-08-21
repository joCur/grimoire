// React-query half of the scene-status control (issue #28).
//
// The cache/409 mechanics are the shared envelope in use-mtime-write.ts; what
// belongs to the status regler is here: the target value shown dimmed while
// the write runs (display only, see SceneStatusMenu), the tree invalidation
// (pool rows, live nav, search read the status from there) and the guard that
// there is an mtime to write against at all.

import type { SceneStatus } from "@grimoire/shared/types";
import { useState } from "react";

import { writeSceneStatus } from "@/lib/scene-status";
import { useMtimeWriteMutation } from "@/lib/use-mtime-write";

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
  const [pendingStatus, setPendingStatus] = useState<SceneStatus>();

  const { write, message } = useMtimeWriteMutation<SceneStatus>({
    write: (status) => {
      if (mtimeMs === undefined) throw new Error("no mtime yet");
      return writeSceneStatus(campaign, path, mtimeMs, status);
    },
    fileKey: ["file", campaign, path],
    // The status lives in the tree as well (pool rows, live nav, search).
    invalidateOnSuccess: [["tree", campaign]],
    errorMessage: "Status nicht gespeichert — Server prüfen",
    onStart: setPendingStatus,
    onSettled: () => setPendingStatus(undefined),
  });

  return {
    setStatus: (status: SceneStatus) => {
      if (mtimeMs === undefined) return;
      write(status);
    },
    pendingStatus,
    message,
  };
}
