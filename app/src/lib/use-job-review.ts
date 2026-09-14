// Writing the review state back to the job (issue #97).
//
// The review used to keep everything in component state; a navigation, a
// reload or a second tab threw it away. Now the JOB is the state and this
// hook is the one place that writes to it:
//
//   text        debounced (~600 ms) while the DM types, and FLUSHED before
//               anything can lose it — on blur, on unmount (which covers a
//               route change, because the review unmounts with the route)
//               and on a page hide. No `useBlocker`: a blocker asks the DM
//               a question they cannot answer usefully, and flushing needs
//               no question.
//   decisions   immediately — one click, one request.
//
// Every patch carries the job's review `rev`. The answer IS the new job, so
// it seeds the query cache and the next patch is automatically current; a
// 409 means another tab decided first, and then the job is re-read and the
// status line says so instead of the DM's click silently winning.
//
// Requests are SERIALIZED (one chain, one pending patch). Two patches in
// flight at once would race on the rev and turn an ordinary double click
// into a conflict.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerateJob } from "@grimoire/shared/types";

import { ApiError, patchJobReview } from "@/api";
import { mergeReviewPatch, type ReviewPatch } from "@/lib/generate";
import { generateJobKey } from "@/lib/use-generate-job";

/** Debounce before a typed review edit is pushed into the job. */
export const REVIEW_DEBOUNCE_MS = 600;

/** What the quiet status line says. */
export type ReviewSaveStatus = "idle" | "saving" | "saved" | "conflict" | "error";

export interface JobReviewSync {
  status: ReviewSaveStatus;
  /** A text edit — debounced; the caller keeps the textarea's own value. */
  edit: (path: string, markdown: string) => void;
  /** A decision — sent right away. */
  decide: (patch: ReviewPatch) => void;
  /** Send whatever is still pending now (blur, unmount, page hide). */
  flush: () => void;
  /**
   * Another writer won — say so in the same quiet line a patch conflict uses
   * and re-read the job. The ACCEPT has the same rev guard as the patch
   * (issue #97 review, finding 3), and its 409 deserves the same answer.
   */
  signalConflict: () => void;
}

function mergePatch(into: ReviewPatch, patch: ReviewPatch): ReviewPatch {
  return {
    ...into,
    ...patch,
    edits: { ...into.edits, ...patch.edits },
    entries: { ...into.entries, ...patch.entries },
    fields: { ...into.fields, ...patch.fields },
    blocks: { ...into.blocks, ...patch.blocks },
  };
}

/** Drop the empty halves so a patch never sends `{ edits: {} }`. */
function prune(patch: ReviewPatch): ReviewPatch {
  const out: ReviewPatch = {};
  if (Object.keys(patch.edits ?? {}).length > 0) out.edits = patch.edits;
  if (Object.keys(patch.entries ?? {}).length > 0) out.entries = patch.entries;
  if (Object.keys(patch.fields ?? {}).length > 0) out.fields = patch.fields;
  if (Object.keys(patch.blocks ?? {}).length > 0) out.blocks = patch.blocks;
  if (patch.dropped !== undefined) out.dropped = patch.dropped;
  return out;
}

export function useJobReview(
  campaign: string,
  job: GenerateJob | null | undefined,
  delayMs: number = REVIEW_DEBOUNCE_MS,
): JobReviewSync {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReviewSaveStatus>("idle");
  const pending = useRef<ReviewPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** One request at a time — see the header note on the rev. */
  const chain = useRef<Promise<void>>(Promise.resolve());
  // Read at SEND time: a debounced edit must land on the job that is current
  // then, not on the one that was current when the key was pressed.
  const target = useRef({ campaign, jobId: job?.id });
  useEffect(() => {
    target.current = { campaign, jobId: job?.id };
  }, [campaign, job?.id]);

  const send = useCallback(() => {
    const patch = prune(pending.current);
    pending.current = {};
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    const { campaign: forCampaign, jobId } = target.current;
    if (jobId === undefined || Object.keys(patch).length === 0) return;
    const key = generateJobKey(forCampaign);
    setStatus("saving");
    // Optimistic: the review reads its state from the cache, so a decision
    // has to show the moment it is clicked.
    const before = queryClient.getQueryData<GenerateJob | null>(key);
    if (before !== undefined && before !== null) {
      queryClient.setQueryData(key, mergeReviewPatch(before, patch));
    }
    chain.current = chain.current.then(async () => {
      const rev = queryClient.getQueryData<GenerateJob | null>(key)?.rev ?? 0;
      try {
        const updated = await patchJobReview(forCampaign, jobId, rev, patch);
        queryClient.setQueryData(key, updated);
        setStatus("saved");
      } catch (error) {
        // A 409 is the house conflict protocol: nothing was written, the
        // other tab's state is the truth, so it is re-read rather than
        // guessed at. Everything else is an honest error line — the text is
        // still on screen, only its copy on the server is behind.
        if (error instanceof ApiError && error.status === 409) {
          setStatus("conflict");
          await queryClient.invalidateQueries({ queryKey: key });
          return;
        }
        setStatus("error");
      }
    });
  }, [queryClient]);

  const edit = useCallback(
    (path: string, markdown: string) => {
      pending.current = mergePatch(pending.current, { edits: { [path]: markdown } });
      setStatus("saving");
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(send, delayMs);
    },
    [send, delayMs],
  );

  const decide = useCallback(
    (patch: ReviewPatch) => {
      pending.current = mergePatch(pending.current, patch);
      send();
    },
    [send],
  );

  // Leaving is exactly the case the ticket is about: flush on unmount (a
  // route change unmounts the review) and when the page is hidden (a closed
  // tab never unmounts anything).
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === "hidden") send();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      send();
    };
  }, [send]);

  const signalConflict = useCallback(() => {
    setStatus("conflict");
    void queryClient.invalidateQueries({ queryKey: generateJobKey(target.current.campaign) });
  }, [queryClient]);

  return { status, edit, decide, flush: send, signalConflict };
}
