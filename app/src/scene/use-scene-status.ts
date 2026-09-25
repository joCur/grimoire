// React-query half of the scene-status control.
//
// The cache/409 mechanics are the shared envelope in lib/use-rev-write.ts, the
// "is there a rev to write against at all?" gate is `withRev`; what belongs to
// the status control is here: the tree invalidation (chapter overview rows,
// live nav and search read the status from there) and the target value shown
// dimmed while the write runs — which is the write's variables, no second
// state.

import type { SceneStatus } from "@grimoire/shared/types";

import { useRevWriteMutation } from "@/lib/use-rev-write";
import { withRev } from "@/lib/write-with-rev";

import { sceneKey } from "./scene-query";
import { writeSceneStatus } from "./scene-status";

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
  id: string,
  rev: number | undefined,
): SceneStatusMutation {
  const { write, pendingVariables, message } = useRevWriteMutation({
    write: withRev(rev, (status: SceneStatus, rev) => writeSceneStatus(campaign, id, rev, status)),
    rowKey: sceneKey(campaign, id),
    // The status lives in the tree as well (chapter overview rows, live nav, search).
    invalidateOnSuccess: [["tree", campaign]],
    errorMessage: "write.status.failed",
  });

  return {
    setStatus: write,
    pendingStatus: pendingVariables,
    message,
  };
}
