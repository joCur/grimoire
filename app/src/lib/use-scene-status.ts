// React-query half of the scene-status control (issue #28).
//
// The cache/409 mechanics are the shared envelope in use-mtime-write.ts, the
// "is there an mtime to write against at all?" gate is `withMtime`; what
// belongs to the status regler is here: the tree invalidation (pool rows, live
// nav and search read the status from there) and the target value shown dimmed
// while the write runs — which is the write's variables, no second state.

import type { SceneStatus } from "@grimoire/shared/types";

import { writeSceneStatus } from "@/lib/scene-status";
import { useMtimeWriteMutation } from "@/lib/use-mtime-write";
import { withMtime } from "@/lib/write-with-mtime";

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
  const { write, pendingVariables, message } = useMtimeWriteMutation<SceneStatus>({
    write: withMtime(mtimeMs, (status, mtime) => writeSceneStatus(campaign, path, mtime, status)),
    fileKey: ["file", campaign, path],
    // The status lives in the tree as well (pool rows, live nav, search).
    invalidateOnSuccess: [["tree", campaign]],
    errorMessage: "Status nicht gespeichert — Server prüfen",
  });

  return {
    setStatus: write,
    pendingStatus: pendingVariables,
    message,
  };
}
