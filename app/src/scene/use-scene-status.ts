// React-query half of the scene-status control.
//
// The cache/409 mechanics are the shared envelope in lib/use-rev-write.ts, the
// "is there a rev to write against at all?" gate is `withRev`; what belongs to
// the status control is here: the tree invalidation (chapter overview rows,
// live nav and search read the status from there) and the target value shown
// dimmed while the write runs — which is the write's variables, no second
// state. Beside it, the one status write the live view's "Nächste Szene"
// step takes: marking the scene being left as played.

import type { SceneStatus } from "@grimoire/shared/scene";
import { useQueryClient } from "@tanstack/react-query";

import { useRevWriteMutation } from "@/lib/use-rev-write";
import { withRev } from "@/lib/write-with-rev";

import { sceneKey, sceneQuery } from "./scene-query";
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

/**
 * Mark a scene PLAYED against the version of it the app holds — the scene on
 * screen, read once when nothing is cached yet. A scene that is played already
 * is not written again.
 *
 * Resolves true when the scene is played now; the written row replaces the
 * cached one and the tree is refreshed before it resolves, so the live nav and
 * the chapter overview show the new status. Resolves false on a conflict:
 * nothing was written, the re-read scene is in the cache, and the next call
 * writes against its fresh rev (lib/write-with-rev.ts). Every other failure
 * rejects.
 */
export function useMarkScenePlayed(campaign: string): (id: string) => Promise<boolean> {
  const queryClient = useQueryClient();
  return async (id) => {
    const scene = await queryClient.ensureQueryData(sceneQuery(campaign, id));
    if (scene.status === "played") return true;
    const result = await writeSceneStatus(campaign, id, scene.rev, "played");
    if (result.row !== undefined) queryClient.setQueryData(sceneKey(campaign, id), result.row);
    if (result.ok) await queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
    return result.ok;
  };
}
