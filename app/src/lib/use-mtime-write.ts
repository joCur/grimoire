// The react-query envelope around an mtime-checked write (issue #38) — the
// companion of write-with-mtime.ts, and the one place that knows how a write
// touches the cache.
//
// The server file is the truth: the write sends the mtime of the FileResponse
// the UI is showing and seeds the RETURNED file into the cache — the cache is
// never written with a guessed value, and never invalidated for a file the
// server just handed us. A 409 means nothing was written: the quiet inline
// message appears, the re-read file is seeded, and the next attempt carries
// the fresh mtime.
//
// Everything that legitimately differs per path is a parameter: the write
// itself, the file query key to seed, WHICH queries a successful write
// invalidates (the paths deliberately differ) and the error wording.

import type { FileResponse } from "@grimoire/shared/types";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRef, useState } from "react";

import {
  STALE_FILE_MESSAGE,
  WRITE_FAILED_MESSAGE,
  type MtimeWriteResult,
} from "@/lib/write-with-mtime";

export interface MtimeWriteMutation<TVariables> {
  /** Start a write; ignored while another one is in flight. */
  write: (variables: TVariables) => void;
  /** True while the write runs — the button reads „Speichere …". */
  isPending: boolean;
  /**
   * The variables of the write in flight, undefined otherwise — for a control
   * that shows its target value while the write runs (display only).
   */
  pendingVariables?: TVariables | undefined;
  /** Quiet inline message: mtime conflict, or a failed write. */
  message?: string | undefined;
}

export interface MtimeWriteOptions<TVariables> {
  /**
   * The domain write — a `writeWithMtime` call with its payload built.
   * `undefined` means there is nothing to write against yet (no mtime, see
   * `withMtime`): `write()` then does nothing at all.
   */
  write: ((variables: TVariables) => Promise<MtimeWriteResult>) | undefined;
  /**
   * Query key of the written file. Whatever came back — the written file, or
   * the re-read one after a conflict — is seeded here. NOT invalidated: both
   * write endpoints answer with the same payload as GET /file, so the file in
   * the cache is already the server's truth.
   */
  fileKey: QueryKey;
  /**
   * Invalidated after a SUCCESSFUL write only, in order. Each write path has
   * its own set (a body write feeds tree and search, a status patch only the
   * tree, campaign metadata also the campaign list) — a conflict invalidates
   * none of them, because nothing changed.
   */
  invalidateOnSuccess?: readonly QueryKey[];
  /** Inline message when the write failed for any reason other than a conflict. */
  errorMessage?: string;
  /** Runs after a SUCCESSFUL write — where a dialog closes or a mode ends. */
  onSaved?: () => void;
  /**
   * Runs after a CONFLICT with the re-read file (undefined when even the
   * reload failed), for callers that hold their own base version.
   */
  onConflict?: (file: FileResponse | undefined) => void;
}

export function useMtimeWriteMutation<TVariables>({
  write,
  fileKey,
  invalidateOnSuccess = [],
  errorMessage = WRITE_FAILED_MESSAGE,
  onSaved,
  onConflict,
}: MtimeWriteOptions<TVariables>): MtimeWriteMutation<TVariables> {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string>();
  // `mutation.isPending` is the render-time snapshot, so two calls in the same
  // tick would both pass it and the second would answer with a 409 it caused
  // itself. The ref flips synchronously inside the call.
  const inFlight = useRef(false);

  const mutation = useMutation({
    mutationFn: (variables: TVariables) => {
      // Unreachable: `write` below never starts a mutation without a write.
      if (write === undefined) throw new Error("no version to write against");
      return write(variables);
    },
    onMutate: () => {
      setMessage(undefined);
    },
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (result) => {
      // Whatever the server sent back — the written file, or the re-read one
      // after a conflict — is the new truth for this path.
      if (result.file !== undefined) queryClient.setQueryData(fileKey, result.file);
      if (!result.ok) {
        setMessage(STALE_FILE_MESSAGE);
        onConflict?.(result.file);
        return;
      }
      for (const queryKey of invalidateOnSuccess) {
        void queryClient.invalidateQueries({ queryKey });
      }
      onSaved?.();
    },
    onError: () => {
      setMessage(errorMessage);
    },
  });

  return {
    write: (variables: TVariables) => {
      if (write === undefined || inFlight.current || mutation.isPending) return;
      inFlight.current = true;
      mutation.mutate(variables);
    },
    isPending: mutation.isPending,
    // Display state, derived instead of mirrored: while the write runs, its
    // variables ARE the target the control shows.
    pendingVariables: mutation.isPending ? mutation.variables : undefined,
    message,
  };
}
