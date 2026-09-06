// React-query half of the scene-status control (issue #28).
//
// The cache/409 mechanics are the shared envelope in use-rev-write.ts, the
// "is there a rev to write against at all?" gate is `withRev`; what
// belongs to the status regler is here: the tree invalidation (pool rows, live
// nav and search read the status from there) and the target value shown dimmed
// while the write runs — which is the write's variables, no second state.

import type { SceneStatus } from "@grimoire/shared/types";

import { writeSceneStatus } from "@/lib/scene-status";
import { useRevWriteMutation } from "@/lib/use-rev-write";
import { withRev } from "@/lib/write-with-rev";

export interface SceneStatusMutation {
  /** Start a write; ignored while another one is in flight. */
  setStatus: (status: SceneStatus) => void;
  /** The value being written right now — the control shows it dimmed. */
  pendingStatus?: SceneStatus | undefined;
  /** Quiet inline message: rev conflict, or a failed write. */
  message?: string | undefined;
}

export function useSceneStatusMutation(
  campaign: string,
  path: string,
  rev: number | undefined,
): SceneStatusMutation {
  const { write, pendingVariables, message } = useRevWriteMutation<SceneStatus>({
    write: withRev(rev, (status, rev) => writeSceneStatus(campaign, path, rev, status)),
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
