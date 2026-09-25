// React-query half of the chapter-status control.
//
// The cache/409 mechanics are the shared envelope in lib/use-rev-write.ts, the
// "is there a rev to write against at all?" gate is `withRev`; what belongs to
// this control is the INVALIDATION, and it is wider than a scene's. `active`
// moves two chapters, so every chapter of the campaign goes stale and not just
// the one the server answered with — the chapter that LOST the status is on
// the same page, and seeding only the winner would leave its control lying.
// The tree carries every chapter's status (the overview, the session view),
// and the session view reads which chapter is active, so both follow.

import type { ChapterStatus } from "@grimoire/shared/types";

import { useRevWriteMutation } from "@/lib/use-rev-write";
import { withRev } from "@/lib/write-with-rev";

import { chapterKey, chaptersOf } from "./chapter-query";
import { writeChapterStatus } from "./chapter-status";

export interface ChapterStatusMutation {
  /** Start a write; ignored while another one is in flight, or without a rev. */
  setStatus: (status: ChapterStatus) => void;
  /** The value being written right now — the control shows it dimmed. */
  pendingStatus?: ChapterStatus | undefined;
  /** Quiet inline message: rev conflict, or a failed write. */
  message?: string | undefined;
}

export function useChapterStatusMutation(
  campaign: string,
  id: string,
  /** Rev of the chapter as it was read; undefined until it has been. */
  rev: number | undefined,
): ChapterStatusMutation {
  const { write, pendingVariables, message } = useRevWriteMutation({
    write: withRev(rev, (status: ChapterStatus, rev) =>
      writeChapterStatus(campaign, id, rev, status),
    ),
    rowKey: chapterKey(campaign, id),
    invalidateOnSuccess: [
      // Both chapters moved — every chapter of the campaign, not one of them.
      chaptersOf(campaign),
      ["tree", campaign],
      ["session", campaign],
      ["search", campaign],
    ],
    errorMessage: "write.status.failed",
  });

  return {
    setStatus: write,
    pendingStatus: pendingVariables,
    message,
  };
}
