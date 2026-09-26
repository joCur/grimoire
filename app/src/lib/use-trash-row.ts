// Putting ONE row in the trash from its edit mode (decisions/trash), the same
// way for every entity that has a trash: ask first, then `DELETE` against
// the version the edit mode writes against, leave the page the row no longer
// exists on, and offer to undo it.
//
//   ask       the dialog opens; nothing is written yet.
//   confirm   the delete. A refusal writes nothing and keeps the dialog open
//             with a sentence: what still names the row (`trash_blocked`,
//             read by i18n/server-errors.ts), a row changed elsewhere (409
//             with the current row — the edit mode's version is stale), or
//             one that is gone already.
//   leave     after the delete: the unsaved-changes guard does not ask again
//             (the dialog already said the changes go with it), the page
//             moves to where the row was listed, and everything read from
//             the campaign is refreshed — the row left the tree, the lists,
//             the search, and a chapter took its scenes and threads along.
//   undo      the notice restores the row with the `rev` the delete answered
//             with, and refreshes again; the DM stays where they are, where
//             the row shows up again.
//
// Entity-free: the caller brings its slice's delete and restore calls, the
// key of the row's own query and the address to leave to.

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { ApiError, isNotFound } from "@/api";
import { showNotice, showUndoNotice } from "@/components/Notices";
import { useLeaveUnasked } from "@/components/UnsavedChangesGuard";
import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { invalidateCampaignQueries } from "@/lib/use-campaign-version";

interface Row {
  id: string;
  rev: number;
}

export interface TrashRow {
  /** The dialog stands. */
  asking: boolean;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
  isPending: boolean;
  /** Why the last attempt wrote nothing, as a sentence. */
  error?: string | undefined;
}

export function useTrashRow<T extends Row>({
  campaign,
  row,
  name,
  trash,
  restore,
  rowKey,
  leaveTo,
}: {
  campaign: string;
  /** The row's id and the version the edit mode writes against. */
  row: Row;
  /** The name the DM knows the row by, for the sentences. */
  name: string;
  trash: (row: Row) => Promise<T>;
  restore: (row: T) => Promise<T>;
  /** The query of the row itself — it is gone once the delete answered. */
  rowKey: QueryKey;
  /** Where the page goes after the delete. */
  leaveTo: string;
}): TrashRow {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const leaveUnasked = useLeaveUnasked();
  const [asking, setAsking] = useState(false);

  const mutation = useMutation({
    mutationFn: () => trash(row),
    onSuccess: (trashed) => {
      leaveUnasked();
      void navigate(leaveTo);
      queryClient.removeQueries({ queryKey: rowKey, exact: true });
      invalidateCampaignQueries(queryClient, campaign);
      showUndoNotice({
        message: t("editMode.delete.done", { name }),
        undoLabel: t("notice.undo"),
        onUndo: () => {
          restore(trashed).then(
            () => invalidateCampaignQueries(queryClient, campaign),
            () => showNotice(t("editMode.restore.failed", { name })),
          );
        },
      });
    },
    onError: (error) => {
      // A row changed or deleted elsewhere: what is on screen is read again.
      if (isStale(error) || isNotFound(error)) {
        void queryClient.invalidateQueries({ queryKey: rowKey, exact: true });
      }
    },
  });

  const error = mutation.isError
    ? isStale(mutation.error)
      ? t("editMode.delete.stale", { name })
      : isNotFound(mutation.error)
        ? t("editMode.delete.gone", { name })
        : serverErrorMessage(mutation.error, t, "editMode.delete.failed")
    : undefined;

  return {
    asking,
    ask: () => {
      mutation.reset();
      setAsking(true);
    },
    cancel: () => setAsking(false),
    confirm: () => {
      if (!mutation.isPending) mutation.mutate();
    },
    isPending: mutation.isPending,
    error,
  };
}

/** A 409 of a row changed elsewhere — not one that names what is in the way. */
function isStale(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.details.code === "rev_conflict";
}
