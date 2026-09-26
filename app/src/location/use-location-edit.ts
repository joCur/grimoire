// One editing session over ONE location (ADR #31), with the rules every
// editing session in the app follows:
//
//   the write       ONE PATCH of the location per interaction — any subset of
//                  its fields, `body` among them.
//   the version     taken when the edit STARTS and moved only by a successful
//                  write or by the DM adopting the stored location. The 5s
//                  version poll refetches behind an open editor, and taking
//                  its version would turn someone else's write into a silent
//                  overwrite instead of the 409 that asks.
//   the conflict    a 409 wrote nothing. The session keeps its version and the
//                  refused fields; `conflict` carries the stored location, and
//                  the answers are `reload` (continue from what is stored) and
//                  `forceSave` (write the same fields on top of it).

import type { Location, LocationChange, LocationPatch } from "@grimoire/shared/location";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useT, type MessageKey } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { WRITE_FAILED_MESSAGE } from "@/lib/write-with-rev";

import { locationConflict, patchLocation, type LocationConflict } from "./location-api";
import { locationKey } from "./location-query";

export interface LocationEdit {
  /** The version this session writes against. */
  rev: number;
  /** Send one write; ignored while another one is in flight or when it carries nothing. */
  save: (change: LocationChange) => void;
  isSaving: boolean;
  /** Set while the last write stands refused; `location` is what is stored now. */
  conflict?: { location: Location | undefined } | undefined;
  /** Drop the draft and continue from the stored location (`onReload` reseeds). */
  reload: () => void;
  /** Resend the refused fields with `force`; undefined where the write cannot force. */
  forceSave?: (() => void) | undefined;
  /** Quiet inline message for a write that failed for any OTHER reason. */
  message?: string | undefined;
}

export interface LocationEditOptions {
  /** Runs after a SUCCESSFUL write — where a dialog closes or edit mode ends. */
  onSaved: () => void;
  /** Runs when the DM adopted the stored location, so the surface can reseed. */
  onReload?: (location: Location) => void;
  /** Invalidated after a SUCCESSFUL write only, in order. */
  invalidateOnSuccess?: readonly QueryKey[];
  /** Catalog key of the fallback message for a failed write. */
  errorMessage?: MessageKey;
  /**
   * The request, when this surface does not write through the location PATCH
   * — accepting an augment proposal posts the same fields to its own endpoint
   * so it discards the job in the same transaction. Its `force` is ignored,
   * hence `canForce`.
   */
  write?: (request: LocationPatch) => Promise<Location>;
  /** False for a write path that has no force. */
  canForce?: boolean;
}

/** Does a change name any field? A request that names none is the server's 400. */
export function hasLocationChange(change: LocationChange): boolean {
  return Object.values(change).some((value) => value !== undefined);
}

/**
 * `location` is the location on screen when the edit started. Mount the
 * surface per location (`key`) so a navigation starts a new session.
 */
export function useLocationEdit(
  campaign: string,
  location: Location,
  {
    onSaved,
    onReload,
    invalidateOnSuccess = [],
    errorMessage = WRITE_FAILED_MESSAGE,
    write,
    canForce = true,
  }: LocationEditOptions,
): LocationEdit {
  const t = useT();
  const queryClient = useQueryClient();
  const [rev, setRev] = useState(location.rev);
  const [refused, setRefused] = useState<{ change: LocationChange; conflict: LocationConflict }>();
  const [message, setMessage] = useState<string>();
  // Two calls in the same tick would both pass `isPending`; the ref flips
  // synchronously inside the call.
  const inFlight = useRef(false);
  const key = locationKey(campaign, location.id);

  const mutation = useMutation({
    mutationFn: ({ change, force }: { change: LocationChange; force: boolean }) => {
      const request: LocationPatch = { rev, ...change, ...(force ? { force: true } : {}) };
      return (write ?? ((r: LocationPatch) => patchLocation(campaign, location.id, r)))(request);
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
      const conflict = locationConflict(error);
      if (conflict !== undefined) {
        // Nothing was written and the draft stays; the conflict line asks.
        setRefused({ change: variables.change, conflict });
        return;
      }
      setMessage(serverErrorMessage(error, t, errorMessage));
    },
  });

  const start = (change: LocationChange, force: boolean) => {
    if (inFlight.current || mutation.isPending) return;
    inFlight.current = true;
    mutation.mutate({ change, force });
  };

  const stored = refused?.conflict.location;

  return {
    rev,
    save: (change) => {
      if (!hasLocationChange(change)) return;
      start(change, false);
    },
    isSaving: mutation.isPending,
    ...(refused === undefined ? {} : { conflict: { location: stored } }),
    reload: () => {
      if (stored === undefined) {
        // No location in the 409 body: let the query fetch the truth.
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
