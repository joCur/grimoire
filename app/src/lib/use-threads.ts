// A chapter's open threads on the app side: the list query both the review
// and the chapter overview read, and the writes of the overview.
//
// The threads are a LIST beside the chapter entry (ADR #26, #29): rows with an
// id and the list's own guard token, never a checklist in the chapter text.
// So nothing here touches the chapter entry's cache — a write answers the
// whole list, which is seeded as it comes.
//
// THE CONFLICT follows the list surfaces (components/EntryListPage.tsx): a
// refused write wrote nothing, the surface says so and offers „Neu laden",
// and every further write stays off until the DM has taken it. Writing again
// against a list that moved is how a tick lands on a row nobody looked at.

import type { ThreadsResponse } from "@grimoire/shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { appendThread, deleteThread, fetchThreads, patchThread, threadsConflict } from "@/api";
import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { isWriteConflict } from "@/lib/write-with-rev";

/** Query key of one chapter's thread list — shared by review and overview. */
export function threadsKey(campaign: string, chapter: string): [string, string, string] {
  return ["threads", campaign, chapter];
}

/** The chapter's threads; idle while there is no chapter to read them from. */
export function useThreads(campaign: string, chapter: string | undefined, enabled = true) {
  return useQuery({
    queryKey: threadsKey(campaign, chapter ?? ""),
    queryFn: () => fetchThreads(campaign, chapter as string),
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
  /** The list moved underneath: nothing was written, reload first. */
  stale: boolean;
  /** A write failed for another reason — the sentence to show. */
  failed?: string | undefined;
  /** Take the stored list and leave the conflict. */
  reload: () => Promise<void>;
}

function send(campaign: string, chapter: string, change: ThreadWrite): Promise<ThreadsResponse> {
  switch (change.kind) {
    case "add":
      return appendThread(campaign, chapter, change.text);
    case "tick":
      return patchThread(campaign, chapter, change.id, { rev: change.rev, done: change.done });
    case "edit":
      return patchThread(campaign, chapter, change.id, { rev: change.rev, text: change.text });
    case "remove":
      return deleteThread(campaign, chapter, change.id, change.rev);
  }
}

export function useThreadWrites(campaign: string, chapter: string): ThreadWrites {
  const t = useT();
  const queryClient = useQueryClient();
  const key = threadsKey(campaign, chapter);
  const [stale, setStale] = useState<ThreadsResponse | "unknown">();
  const [failed, setFailed] = useState<string>();

  const mutation = useMutation({
    mutationFn: (change: ThreadWrite) => send(campaign, chapter, change),
    onMutate: () => setFailed(undefined),
    onSuccess: (list) => {
      queryClient.setQueryData(key, list);
    },
    onError: (error) => {
      if (isWriteConflict(error)) {
        setStale(threadsConflict(error) ?? "unknown");
        return;
      }
      setFailed(serverErrorMessage(error, t, "chapterOverview.threads.failed"));
    },
  });

  return {
    write: async (change) => {
      if (mutation.isPending || stale !== undefined) return false;
      try {
        await mutation.mutateAsync(change);
        return true;
      } catch {
        return false;
      }
    },
    isPending: mutation.isPending,
    stale: stale !== undefined,
    failed,
    reload: async () => {
      // The 409 carried the list as it stands; without it, read it again.
      if (stale !== undefined && stale !== "unknown") queryClient.setQueryData(key, stale);
      else await queryClient.invalidateQueries({ queryKey: key });
      setStale(undefined);
      setFailed(undefined);
    },
  };
}
