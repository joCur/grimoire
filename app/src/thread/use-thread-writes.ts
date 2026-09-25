// A chapter's threads on the app side: the query the review and the chapter
// overview both read, and the writes of the overview.
//
// A thread is its own resource with its own guard (ADR #31): a write answers
// the one thread it wrote, which the cached list takes in place, and nothing
// here touches the chapter's cache.
//
// THE CONFLICT: a refused write wrote nothing, the surface says so and offers
// „Neu laden", and every further write stays off until the DM has taken it.
// Writing again against a list that moved is how a tick lands on a row nobody
// looked at.

import type { Thread } from "@grimoire/shared/thread";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { isWriteConflict } from "@/lib/write-with-rev";

import { createThread, deleteThread, patchThread } from "./thread-api";
import { threadsKey, threadsQuery, withThread, withoutThread } from "./thread-query";

/** The chapter's threads; idle while there is no chapter to read them from. */
export function useThreads(campaign: string, chapter: string | undefined, enabled = true) {
  return useQuery({
    ...threadsQuery(campaign, chapter ?? ""),
    enabled: enabled && campaign !== "" && chapter !== undefined,
    retry: false,
  });
}

/** One write of the overview. Every guarded one names the `rev` it was aimed at. */
export type ThreadWrite =
  | { kind: "add"; text: string }
  | { kind: "tick"; id: string; done: boolean; rev: number }
  | { kind: "edit"; id: string; text: string; rev: number }
  | { kind: "remove"; id: string; rev: number };

export interface ThreadWrites {
  /** Run one write; resolves true when it was stored. */
  write: (change: ThreadWrite) => Promise<boolean>;
  /** A write is on the wire — the controls hold still until it lands. */
  isPending: boolean;
  /** A thread moved underneath: nothing was written, reload first. */
  stale: boolean;
  /** A write failed for another reason — the sentence to show. */
  failed?: string | undefined;
  /** Take the stored threads and leave the conflict. */
  reload: () => Promise<void>;
}

/** The list after one write: the thread it answered in place, or without the deleted one. */
async function send(campaign: string, chapter: string, change: ThreadWrite) {
  switch (change.kind) {
    case "add": {
      const thread = await createThread(campaign, { chapter, text: change.text });
      return (list: Thread[] | undefined) => withThread(list, thread);
    }
    case "tick": {
      const thread = await patchThread(campaign, change.id, change.rev, { done: change.done });
      return (list: Thread[] | undefined) => withThread(list, thread);
    }
    case "edit": {
      const thread = await patchThread(campaign, change.id, change.rev, { text: change.text });
      return (list: Thread[] | undefined) => withThread(list, thread);
    }
    case "remove":
      await deleteThread(campaign, change.id, change.rev);
      return (list: Thread[] | undefined) => withoutThread(list, change.id);
  }
}

export function useThreadWrites(campaign: string, chapter: string): ThreadWrites {
  const t = useT();
  const queryClient = useQueryClient();
  const key = threadsKey(campaign, chapter);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState<string>();

  const mutation = useMutation({
    mutationFn: (change: ThreadWrite) => send(campaign, chapter, change),
    onMutate: () => setFailed(undefined),
    onSuccess: (update) => {
      queryClient.setQueryData<Thread[]>(key, update);
    },
    onError: (error) => {
      if (isWriteConflict(error)) {
        setStale(true);
        return;
      }
      setFailed(serverErrorMessage(error, t, "chapterOverview.threads.failed"));
    },
  });

  return {
    write: async (change) => {
      if (mutation.isPending || stale) return false;
      try {
        await mutation.mutateAsync(change);
        return true;
      } catch {
        return false;
      }
    },
    isPending: mutation.isPending,
    stale,
    failed,
    reload: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      setStale(false);
      setFailed(undefined);
    },
  };
}
