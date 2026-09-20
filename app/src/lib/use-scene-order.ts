// The write half of the chapter's scene order (ADR #27): one up/down step,
// felt immediately and reconciled with the server afterwards.
//
// OPTIMISTIC, because the DM is looking at the row they just moved: the tree
// in the cache is rearranged before the request goes out and put back exactly
// as it was when the request fails. The server stays the truth — the answer's
// fresh guard token is seeded and the tree is refetched either way.
//
// THE CONFLICT HAS NO SECOND ACTION. Forcing an order that was arranged
// against a list somebody else has already changed writes positions for
// scenes the DM never saw in those places. So this follows the status
// control, not the properties dialog: it reports the stale state and fetches
// the current one (critical path 7). The message is quiet and inline.

import type { CampaignTree, ChapterNode } from "@grimoire/shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { putSceneOrder } from "@/api";
import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { moveSceneOrder, withSceneOrder, withSceneOrderRev } from "@/lib/scene-order";
import { isStaleEntryError } from "@/lib/write-with-rev";

export interface SceneOrderWrite {
  /** Move one scene one step inside its own block and write the new order. */
  move: (id: string, delta: -1 | 1) => void;
  /** True while a move is on the wire — the controls stay still until then. */
  isPending: boolean;
  /** Quiet inline message: the order moved underneath, or the write failed. */
  message?: string | undefined;
}

export function useSceneOrderWrite(campaign: string, chapter: ChapterNode): SceneOrderWrite {
  const t = useT();
  const queryClient = useQueryClient();
  const treeKey = ["tree", campaign];
  const [message, setMessage] = useState<string>();

  const mutation = useMutation({
    mutationFn: (order: string[]) =>
      putSceneOrder(campaign, chapter.id, order, chapter.sceneOrderRev ?? 0),
    onMutate: async (order) => {
      setMessage(undefined);
      // A refetch landing mid-flight would paint the old order over the new
      // one and then hand it back as the rollback value.
      await queryClient.cancelQueries({ queryKey: treeKey });
      const previous = queryClient.getQueryData<CampaignTree>(treeKey);
      if (previous !== undefined) {
        queryClient.setQueryData(treeKey, withSceneOrder(previous, chapter.id, order));
      }
      return { previous };
    },
    onError: (error, _order, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(treeKey, context.previous);
      }
      setMessage(
        isStaleEntryError(error)
          ? t("chapterOverview.order.conflict")
          : serverErrorMessage(error, t, "chapterOverview.order.failed"),
      );
    },
    onSuccess: (response) => {
      // The next move has to carry the token this one produced; without it a
      // second click before the refetch lands would answer 409 to itself.
      const current = queryClient.getQueryData<CampaignTree>(treeKey);
      if (current !== undefined) {
        queryClient.setQueryData(treeKey, withSceneOrderRev(current, chapter.id, response.rev));
      }
    },
    // After a conflict this IS the reload the message announces.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: treeKey });
    },
  });

  return {
    move: (id, delta) => {
      if (mutation.isPending) return;
      mutation.mutate(moveSceneOrder(chapter.scenes, id, delta));
    },
    isPending: mutation.isPending,
    message,
  };
}
