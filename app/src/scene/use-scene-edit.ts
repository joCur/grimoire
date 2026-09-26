// One editing session over ONE scene (ADR #31), with the rules every
// editing session in the app follows:
//
//   the write       ONE PATCH of the scene per interaction — any subset of
//                  its fields, `body` among them.
//   the version     taken when the edit STARTS and moved only by a successful
//                  write or by the DM adopting the stored scene. The 5s
//                  version poll refetches behind an open editor, and taking
//                  its version would turn someone else's write into a silent
//                  overwrite instead of the 409 that asks.
//   the conflict    a 409 wrote nothing. The session keeps its version and the
//                  refused fields; `conflict` carries the stored scene, and
//                  the answers are `reload` (continue from what is stored) and
//                  `forceSave` (write the same fields on top of it).

import type { Scene, SceneChange, ScenePatch } from "@grimoire/shared/scene";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useT, type MessageKey } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { WRITE_FAILED_MESSAGE } from "@/lib/write-with-rev";

import { sceneConflict, patchScene, type SceneConflict } from "./scene-api";
import { sceneKey } from "./scene-query";

export interface SceneEdit {
  /** The version this session writes against. */
  rev: number;
  /** Send one write; ignored while another one is in flight or when it carries nothing. */
  save: (change: SceneChange) => void;
  isSaving: boolean;
  /** Set while the last write stands refused; `scene` is what is stored now. */
  conflict?: { scene: Scene | undefined } | undefined;
  /** Drop the draft and continue from the stored scene (`onReload` reseeds). */
  reload: () => void;
  /** Resend the refused fields with `force`; undefined where the write cannot force. */
  forceSave?: (() => void) | undefined;
  /** Quiet inline message for a write that failed for any OTHER reason. */
  message?: string | undefined;
}

export interface SceneEditOptions {
  /** Runs after a SUCCESSFUL write — where a dialog closes or edit mode ends. */
  onSaved: () => void;
  /** Runs when the DM adopted the stored scene, so the surface can reseed. */
  onReload?: (scene: Scene) => void;
  /** Invalidated after a SUCCESSFUL write only, in order. */
  invalidateOnSuccess?: readonly QueryKey[];
  /** Catalog key of the fallback message for a failed write. */
  errorMessage?: MessageKey;
  /**
   * The request, when this surface does not write through the scene PATCH
   * — accepting an augment proposal posts the same fields to its own endpoint
   * so it discards the job in the same transaction. Its `force` is ignored,
   * hence `canForce`.
   */
  write?: (request: ScenePatch) => Promise<Scene>;
  /** False for a write path that has no force. */
  canForce?: boolean;
}

/** Does a change name any field? A request that names none is the server's 400. */
export function hasSceneChange(change: SceneChange): boolean {
  return Object.values(change).some((value) => value !== undefined);
}

/**
 * `scene` is the scene on screen when the edit started. Mount the
 * surface per scene (`key`) so a navigation starts a new session.
 */
export function useSceneEdit(
  campaign: string,
  scene: Scene,
  {
    onSaved,
    onReload,
    invalidateOnSuccess = [],
    errorMessage = WRITE_FAILED_MESSAGE,
    write,
    canForce = true,
  }: SceneEditOptions,
): SceneEdit {
  const t = useT();
  const queryClient = useQueryClient();
  const [rev, setRev] = useState(scene.rev);
  const [refused, setRefused] = useState<{ change: SceneChange; conflict: SceneConflict }>();
  const [message, setMessage] = useState<string>();
  // Two calls in the same tick would both pass `isPending`; the ref flips
  // synchronously inside the call.
  const inFlight = useRef(false);
  const key = sceneKey(campaign, scene.id);

  const mutation = useMutation({
    mutationFn: ({ change, force }: { change: SceneChange; force: boolean }) => {
      const request: ScenePatch = { rev, ...change, ...(force ? { force: true } : {}) };
      return (write ?? ((r: ScenePatch) => patchScene(campaign, scene.id, r)))(request);
    },
    onMutate: () => {
      setMessage(undefined);
      setRefused(undefined);
    },
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (written) => {
      // The server's own row, never a guessed one.
      queryClient.setQueryData(key, written);
      setRev(written.rev);
      for (const queryKey of invalidateOnSuccess) {
        void queryClient.invalidateQueries({ queryKey });
      }
      onSaved();
    },
    onError: (error, variables) => {
      const conflict = sceneConflict(error);
      if (conflict !== undefined) {
        // Nothing was written and the draft stays; the conflict line asks.
        setRefused({ change: variables.change, conflict });
        return;
      }
      setMessage(serverErrorMessage(error, t, errorMessage));
    },
  });

  const start = (change: SceneChange, force: boolean) => {
    if (inFlight.current || mutation.isPending) return;
    inFlight.current = true;
    mutation.mutate({ change, force });
  };

  const stored = refused?.conflict.scene;

  return {
    rev,
    save: (change) => {
      if (!hasSceneChange(change)) return;
      start(change, false);
    },
    isSaving: mutation.isPending,
    ...(refused === undefined ? {} : { conflict: { scene: stored } }),
    reload: () => {
      if (stored === undefined) {
        // No scene in the 409 body: let the query fetch the truth.
        void queryClient.invalidateQueries({ queryKey: key });
        setRefused(undefined);
        return;
      }
      queryClient.setQueryData(key, stored);
      setRev(stored.rev);
      setRefused(undefined);
      onReload?.(stored);
    },
    ...(canForce && refused !== undefined
      ? { forceSave: () => start(refused.change, true) }
      : {}),
    message,
  };
}
