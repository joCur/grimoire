// Writing the review state back to the job.
//
// The review used to keep everything in component state; a navigation, a
// reload or a second tab threw it away. Now the JOB is the state and this
// module is the one place that writes to it:
//
//   edits       of a proposed scene or npc, debounced (~600 ms)
//               while the DM types, and FLUSHED before
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
//
// The queue itself is plain TypeScript (`createReviewQueue`) and the hook is
// the react-query wiring around it. That split is not decoration: the two
// properties this thing has to have — a flush that RESOLVES when the patch
// has landed, and a failed patch that goes back into the queue instead of
// evaporating — are exactly the ones a rendering test cannot see.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerateJob, NpcChange, SceneChange } from "@grimoire/shared/types";

import { ApiError, patchJobReview } from "@/api";
import { mergeEdits, mergeReviewPatch, type ReviewPatch } from "@/lib/generate";
import { generateJobKey } from "@/lib/use-generate-job";

/** Debounce before a review edit is pushed into the job. */
export const REVIEW_DEBOUNCE_MS = 600;

/** What the quiet status line says. */
export type ReviewSaveStatus = "idle" | "saving" | "saved" | "conflict" | "error";

export interface JobReviewSync {
  status: ReviewSaveStatus;
  /**
   * A change of one proposed scene, by its id — debounced; the caller keeps
   * its own buffer so the field does not lag behind the keystroke.
   */
  editScene: (id: string, change: SceneChange) => void;
  /** A change of one proposed npc, by its id — debounced the same way. */
  editNpc: (id: string, change: NpcChange) => void;
  /** A decision — sent right away. */
  decide: (patch: ReviewPatch) => void;
  /**
   * Send whatever is still pending now (blur, unmount, page hide) and
   * RESOLVE when it has landed. The accept action awaits this: the server
   * reads `sceneEdits` and `npcEdits` when the accept arrives, so a debounced edit still in
   * flight would be read one request too late and then deleted together with
   * the job.
   */
  flush: () => Promise<void>;
  /**
   * Another writer won — say so in the same quiet line a patch conflict uses
   * and re-read the job. The ACCEPT has the same rev guard as the patch, and
   * its 409 deserves the same answer.
   */
  signalConflict: () => void;
}

function mergePatch(into: ReviewPatch, patch: ReviewPatch): ReviewPatch {
  return {
    ...into,
    ...patch,
    sceneEdits: mergeEdits(into.sceneEdits ?? {}, patch.sceneEdits),
    npcEdits: mergeEdits(into.npcEdits ?? {}, patch.npcEdits),
    npcs: { ...into.npcs, ...patch.npcs },
    locations: { ...into.locations, ...patch.locations },
    fields: { ...into.fields, ...patch.fields },
    blocks: { ...into.blocks, ...patch.blocks },
  };
}

/** Drop the empty parts so a patch never sends `{ sceneEdits: {} }`. */
function prune(patch: ReviewPatch): ReviewPatch {
  const out: ReviewPatch = {};
  if (Object.keys(patch.sceneEdits ?? {}).length > 0) out.sceneEdits = patch.sceneEdits;
  if (Object.keys(patch.npcEdits ?? {}).length > 0) out.npcEdits = patch.npcEdits;
  if (Object.keys(patch.npcs ?? {}).length > 0) out.npcs = patch.npcs;
  if (Object.keys(patch.locations ?? {}).length > 0) out.locations = patch.locations;
  if (Object.keys(patch.fields ?? {}).length > 0) out.fields = patch.fields;
  if (Object.keys(patch.blocks ?? {}).length > 0) out.blocks = patch.blocks;
  if (patch.droppedScenes !== undefined) out.droppedScenes = patch.droppedScenes;
  return out;
}

/** What the queue needs from the world around it. */
export interface ReviewQueueIo {
  /**
   * Show the patch before it is confirmed — the review reads its state from
   * the cache, so a decision has to appear the moment it is clicked. Returns
   * the undo for a send that then fails, or undefined when there was
   * nothing to change.
   */
  optimistic: (patch: ReviewPatch) => (() => void) | undefined;
  /** Send it. Rejects with the error; an ApiError 409 is the conflict. */
  send: (patch: ReviewPatch) => Promise<void>;
  /** Re-read the job after a conflict. */
  reread: () => void;
  status: (status: ReviewSaveStatus) => void;
}

export interface ReviewQueue {
  editScene: (id: string, change: SceneChange) => void;
  editNpc: (id: string, change: NpcChange) => void;
  decide: (patch: ReviewPatch) => void;
  flush: () => Promise<void>;
}

/**
 * The serialized patch queue. One patch in flight at a time; whatever
 * arrives meanwhile merges into the next one.
 */
export function createReviewQueue(io: ReviewQueueIo, delayMs: number): ReviewQueue {
  let pending: ReviewPatch = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  const cancelTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const send = (): Promise<void> => {
    const patch = prune(pending);
    pending = {};
    cancelTimer();
    // Nothing of our own to send — but an earlier patch may still be in
    // flight, and a caller that awaits this wants THAT to be done too.
    if (Object.keys(patch).length === 0) return chain;
    io.status("saving");
    const undo = io.optimistic(patch);
    chain = chain.then(async () => {
      try {
        await io.send(patch);
        // Sticky until the queue is EMPTY: a success while a failed patch is
        // waiting for its retry must not report a saved review half of which
        // is not on the server.
        io.status(Object.keys(prune(pending)).length === 0 ? "saved" : "saving");
      } catch (error) {
        // A 409 is the house conflict protocol: nothing was written, the
        // other tab's state is the truth, so it is re-read rather than
        // guessed at. Anything the DM typed stays in the queue either way.
        if (error instanceof ApiError && error.status === 409) {
          io.status("conflict");
          io.reread();
          return;
        }
        // Any other failure: the optimistic copy is rolled back — the cache
        // must not claim what the server refused — and the patch goes BACK
        // into the queue. The next keystroke, the next decision, the flush
        // before an accept or the debounce armed here retries it.
        // Dropping it — and then letting the next success report a saved
        // review — is how an edit is lost without anyone being told.
        undo?.();
        pending = mergePatch(patch, pending);
        io.status("error");
        if (timer === undefined) timer = setTimeout(() => void send(), delayMs);
      }
    });
    return chain;
  };

  /** A typed change: merged into the next patch, sent after the debounce. */
  const debounce = (patch: ReviewPatch): void => {
    pending = mergePatch(pending, patch);
    io.status("saving");
    cancelTimer();
    timer = setTimeout(() => void send(), delayMs);
  };

  return {
    editScene: (id, change) => debounce({ sceneEdits: { [id]: change } }),
    editNpc: (id, change) => debounce({ npcEdits: { [id]: change } }),
    decide: (patch) => {
      pending = mergePatch(pending, patch);
      void send();
    },
    flush: send,
  };
}

export function useJobReview(
  campaign: string,
  job: GenerateJob | null | undefined,
  delayMs: number = REVIEW_DEBOUNCE_MS,
): JobReviewSync {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReviewSaveStatus>("idle");
  // Read at SEND time: a debounced edit must land on the job that is current
  // then, not on the one that was current when the key was pressed.
  const target = useRef({ campaign, jobId: job?.id });
  useEffect(() => {
    target.current = { campaign, jobId: job?.id };
  }, [campaign, job?.id]);

  const queue = useMemo(
    () =>
      createReviewQueue(
        {
          optimistic: (patch) => {
            const key = generateJobKey(target.current.campaign);
            const before = queryClient.getQueryData<GenerateJob | null>(key);
            if (before === undefined || before === null) return undefined;
            const after = mergeReviewPatch(before, patch);
            queryClient.setQueryData(key, after);
            return () => {
              // Only if nothing landed on top in the meantime — a later
              // patch's answer is fresher than our snapshot, and the failed
              // patch is retried anyway.
              if (queryClient.getQueryData<GenerateJob | null>(key) === after) {
                queryClient.setQueryData(key, before);
              }
            };
          },
          send: async (patch) => {
            const { campaign: forCampaign, jobId } = target.current;
            if (jobId === undefined) return;
            const key = generateJobKey(forCampaign);
            const rev = queryClient.getQueryData<GenerateJob | null>(key)?.rev ?? 0;
            queryClient.setQueryData(key, await patchJobReview(forCampaign, jobId, rev, patch));
          },
          reread: () => {
            void queryClient.invalidateQueries({
              queryKey: generateJobKey(target.current.campaign),
            });
          },
          status: setStatus,
        },
        delayMs,
      ),
    [queryClient, delayMs],
  );

  // Leaving is exactly the case this module is for: flush on unmount (a
  // route change unmounts the review) and when the page is hidden (a closed
  // tab never unmounts anything).
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === "hidden") void queue.flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void queue.flush();
    };
  }, [queue]);

  const signalConflict = useCallback(() => {
    setStatus("conflict");
    void queryClient.invalidateQueries({ queryKey: generateJobKey(target.current.campaign) });
  }, [queryClient]);

  return {
    status,
    editScene: queue.editScene,
    editNpc: queue.editNpc,
    decide: queue.decide,
    flush: queue.flush,
    signalConflict,
  };
}
