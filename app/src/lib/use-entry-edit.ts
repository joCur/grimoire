// The react-query envelope around one editing session (lib/entry-edit.ts holds
// the rules). Every editing surface of the app runs through here: the body
// editor, the properties dialog, the campaign dialog, the chapter text dialog
// and the generator's accept step.
//
// What this layer owns:
//
//   the write       ONE PATCH per interaction — properties, text, or both
//                  together, so a dialog that edits both cannot land half of
//                  its change.
//   the cache       the entry the server hands back is seeded into the entry
//                  query, never a guessed value; the other queries a path
//                  feeds are invalidated after a SUCCESSFUL write only.
//   the conflict    a 409 wrote nothing. The session keeps its version and its
//                  draft, and `conflict` carries the server's current entry —
//                  the two answers are `reload` (drop the draft, continue from
//                  what is stored) and `forceSave` (write the same fields on
//                  top of it). Nothing happens on its own.
//
// The version the session writes against never follows the entry query. That
// is the whole point: the 5s version poll refetches while an editor stands,
// and inheriting its version would replace the 409 with a silent overwrite.

import type { Entry } from "@grimoire/shared/types";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useReducer, useRef, useState } from "react";

import { patchEntry, revConflict, type PatchEntryRequest } from "@/api";
import { useT } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import {
  entryEditReducer,
  entryEditRequest,
  entryEditState,
  hasEntryWrite,
  type EntryWrite,
} from "@/lib/entry-edit";
import { WRITE_FAILED_MESSAGE } from "@/lib/write-with-rev";

export interface EntryEdit {
  /** The version this session writes against — display and tests. */
  rev: number;
  /** Send one write; ignored while another one is in flight. */
  save: (write: EntryWrite) => void;
  /** True while a write runs — the button reads its saving label. */
  isSaving: boolean;
  /**
   * Set while the last write was refused. `entry` is what the server holds
   * now (undefined when the 409 carried none), which is what the conflict
   * line's actions work on.
   */
  conflict?: { entry: Entry | undefined } | undefined;
  /**
   * Drop the draft and continue from the stored entry: the session takes its
   * version and the surface reseeds itself through `onReload`. Without an
   * entry in the 409 body it falls back to invalidating the entry query, so
   * the poll brings the truth.
   */
  reload: () => void;
  /**
   * Resend the refused fields with `force`, i.e. on top of what is stored.
   * Undefined when the write path cannot force (the generator's accept step),
   * so the conflict line simply does not offer it.
   */
  forceSave?: (() => void) | undefined;
  /** Quiet inline message for a write that failed for any OTHER reason. */
  message?: string | undefined;
}

export interface EntryEditOptions {
  /** Runs after a SUCCESSFUL write — where a dialog closes or edit mode ends. */
  onSaved: () => void;
  /**
   * Runs when the DM adopted the stored entry, so the surface can reseed its
   * draft and its "nothing changed" baseline from it.
   */
  onReload?: (entry: Entry) => void;
  /**
   * Invalidated after a SUCCESSFUL write only, in order. Each path has its own
   * set — a text write feeds the tree and the search index, a chapter's
   * properties can move a second entry — and a conflict invalidates none of
   * them, because nothing changed.
   */
  invalidateOnSuccess?: readonly QueryKey[];
  /**
   * Catalog KEY of the inline message for a write that failed for a reason
   * other than a conflict. It is the FALLBACK: a rejection carrying a server
   * error code shows that code's sentence, which is the specific one.
   */
  errorMessage?: MessageKey;
  /**
   * The request, when this surface does not write through PATCH /entries —
   * the generator's accept step posts the same fields to its own endpoint so
   * it can discard the job in the same transaction. Its `force` is ignored,
   * hence `canForce`.
   */
  writeEntry?: (request: PatchEntryRequest) => Promise<Entry>;
  /**
   * False for a write path that has no force — the conflict line then offers
   * reloading only.
   */
  canForce?: boolean;
}

/**
 * `rev` is the version of the entry that was on screen when the edit started.
 * Mount the surface per entry (`key`, or an open-by-entry state) so a
 * navigation starts a new session instead of carrying this one's version to
 * another entry.
 */
export function useEntryEdit(
  campaign: string,
  path: string,
  rev: number,
  {
    onSaved,
    onReload,
    invalidateOnSuccess = [],
    errorMessage = WRITE_FAILED_MESSAGE,
    writeEntry,
    canForce = true,
  }: EntryEditOptions,
): EntryEdit {
  const t = useT();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(entryEditReducer, rev, entryEditState);
  const [message, setMessage] = useState<string>();
  // `mutation.isPending` is the render-time snapshot, so two calls in the same
  // tick would both pass it and the second would answer with a conflict it
  // caused itself. The ref flips synchronously inside the call.
  const inFlight = useRef(false);
  const entryKey: QueryKey = ["entry", campaign, path];

  const mutation = useMutation({
    mutationFn: ({ write, force }: { write: EntryWrite; force: boolean }) => {
      const request = entryEditRequest(state, write, force);
      return (writeEntry ?? ((r: PatchEntryRequest) => patchEntry(campaign, path, r)))(request);
    },
    onMutate: () => {
      setMessage(undefined);
      dispatch({ type: "cleared" });
    },
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (entry) => {
      // The server's own row, not a guessed one — the reading view behind the
      // surface shows the written state the moment it closes.
      queryClient.setQueryData(entryKey, entry);
      dispatch({ type: "saved", entry });
      for (const queryKey of invalidateOnSuccess) {
        void queryClient.invalidateQueries({ queryKey });
      }
      onSaved();
    },
    onError: (error, variables) => {
      const conflict = revConflict(error);
      if (conflict !== undefined) {
        // Nothing was written and the draft stays; the conflict line asks.
        dispatch({ type: "refused", write: variables.write, conflict });
        return;
      }
      // The SERVER'S sentence when it sent one, the caller's wording only as
      // the fallback — a rejection that names what is wrong and what to type
      // instead must not read as a generic failure.
      setMessage(serverErrorMessage(error, t, errorMessage));
    },
  });

  const start = (write: EntryWrite, force: boolean) => {
    if (inFlight.current || mutation.isPending) return;
    inFlight.current = true;
    mutation.mutate({ write, force });
  };

  const stored = state.conflict?.entry;
  const refused = state.refused;

  return {
    rev: state.rev,
    save: (write: EntryWrite) => {
      if (!hasEntryWrite(write)) return;
      start(write, false);
    },
    isSaving: mutation.isPending,
    ...(state.conflict === undefined ? {} : { conflict: { entry: stored } }),
    reload: () => {
      if (stored === undefined) {
        // No entry in the 409 body: let the query fetch the truth instead of
        // inventing one, and take the conflict line down either way.
        void queryClient.invalidateQueries({ queryKey: entryKey });
        dispatch({ type: "cleared" });
        return;
      }
      queryClient.setQueryData(entryKey, stored);
      dispatch({ type: "adopted", entry: stored });
      onReload?.(stored);
    },
    ...(canForce && refused !== undefined
      ? { forceSave: () => start(refused, true) }
      : {}),
    message,
  };
}
