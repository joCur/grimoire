// One editing session over ONE chapter (ADR #31), with the rules every
// editing session in the app follows:
//
//   the write       ONE PATCH of the chapter per interaction — any subset of
//                  its fields, `body` among them.
//   the version     taken when the edit STARTS and moved only by a successful
//                  write or by the DM adopting the stored chapter. The 5s
//                  version poll refetches behind an open editor, and taking
//                  its version would turn someone else's write into a silent
//                  overwrite instead of the 409 that asks.
//   the conflict    a 409 wrote nothing. The session keeps its version and the
//                  refused fields; `conflict` carries the stored chapter, and
//                  the answers are `reload` (continue from what is stored) and
//                  `forceSave` (write the same fields on top of it).

import type { Chapter, ChapterChange, ChapterPatch } from "@grimoire/shared/chapter";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useT, type MessageKey } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { WRITE_FAILED_MESSAGE } from "@/lib/write-with-rev";

import { chapterConflict, patchChapter, type ChapterConflict } from "./chapter-api";
import { chapterKey } from "./chapter-query";

export interface ChapterEdit {
  /** The version this session writes against. */
  rev: number;
  /** Send one write; ignored while another one is in flight or when it carries nothing. */
  save: (change: ChapterChange) => void;
  isSaving: boolean;
  /** Set while the last write stands refused; `chapter` is what is stored now. */
  conflict?: { chapter: Chapter | undefined } | undefined;
  /** Drop the draft and continue from the stored chapter (`onReload` reseeds). */
  reload: () => void;
  /** Resend the refused fields with `force`; present while a write stands refused. */
  forceSave?: (() => void) | undefined;
  /** Quiet inline message for a write that failed for any OTHER reason. */
  message?: string | undefined;
}

export interface ChapterEditOptions {
  /** Runs after a SUCCESSFUL write — where a dialog closes or edit mode ends. */
  onSaved: () => void;
  /** Runs when the DM adopted the stored chapter, so the surface can reseed. */
  onReload?: (chapter: Chapter) => void;
  /** Invalidated after a SUCCESSFUL write only, in order. */
  invalidateOnSuccess?: readonly QueryKey[];
  /** Catalog key of the fallback message for a failed write. */
  errorMessage?: MessageKey;
}

/** Does a change name any field? A request that names none is the server's 400. */
export function hasChapterChange(change: ChapterChange): boolean {
  return Object.values(change).some((value) => value !== undefined);
}

/**
 * `chapter` is the chapter on screen when the edit started. Mount the surface
 * per chapter (`key`) so a navigation starts a new session.
 */
export function useChapterEdit(
  campaign: string,
  chapter: Chapter,
  {
    onSaved,
    onReload,
    invalidateOnSuccess = [],
    errorMessage = WRITE_FAILED_MESSAGE,
  }: ChapterEditOptions,
): ChapterEdit {
  const t = useT();
  const queryClient = useQueryClient();
  const [rev, setRev] = useState(chapter.rev);
  const [refused, setRefused] = useState<{ change: ChapterChange; conflict: ChapterConflict }>();
  const [message, setMessage] = useState<string>();
  // Two calls in the same tick would both pass `isPending`; the ref flips
  // synchronously inside the call.
  const inFlight = useRef(false);
  const key = chapterKey(campaign, chapter.id);

  const mutation = useMutation({
    mutationFn: ({ change, force }: { change: ChapterChange; force: boolean }) => {
      const request: ChapterPatch = { rev, ...change, ...(force ? { force: true } : {}) };
      return patchChapter(campaign, chapter.id, request);
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
      const conflict = chapterConflict(error);
      if (conflict !== undefined) {
        // Nothing was written and the draft stays; the conflict line asks.
        setRefused({ change: variables.change, conflict });
        return;
      }
      setMessage(serverErrorMessage(error, t, errorMessage));
    },
  });

  const start = (change: ChapterChange, force: boolean) => {
    if (inFlight.current || mutation.isPending) return;
    inFlight.current = true;
    mutation.mutate({ change, force });
  };

  const stored = refused?.conflict.chapter;

  return {
    rev,
    save: (change) => {
      if (!hasChapterChange(change)) return;
      start(change, false);
    },
    isSaving: mutation.isPending,
    ...(refused === undefined ? {} : { conflict: { chapter: stored } }),
    reload: () => {
      if (stored === undefined) {
        // No chapter in the 409 body: let the query fetch the truth.
        void queryClient.invalidateQueries({ queryKey: key });
        setRefused(undefined);
        return;
      }
      queryClient.setQueryData(key, stored);
      setRev(stored.rev);
      setRefused(undefined);
      onReload?.(stored);
    },
    ...(refused === undefined ? {} : { forceSave: () => start(refused.change, true) }),
    message,
  };
}
