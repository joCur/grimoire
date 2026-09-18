// React-query half of the chapter-status control.
//
// The cache/409 mechanics are the shared envelope in use-rev-write.ts; what
// belongs to this path is the INVALIDATION, and it is wider than a scene's.
// `active` moves two chapters, so the whole entry cache goes and not just the
// one the server answered with — the chapter that LOST the flag is on the same
// page, and seeding only the winner would leave its control lying. The tree
// carries every chapter's status (the overview, the session view), and the
// session view reads which chapter is active, so both follow.

import type { ChapterStatus } from "@grimoire/shared/types";

import { chapterMetaPath } from "@/lib/chapter-meta";
import { chapterStatusWritable, writeChapterStatus } from "@/lib/chapter-status";
import { useRevWriteMutation, type RevWriteMutation } from "@/lib/use-rev-write";

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
  chapter: string,
  /** Rev of the chapter entry — only the patch branch needs it. */
  rev: number | undefined,
  /**
   * The status this chapter is SHOWN with. It gates the swap: a chapter that
   * already holds the flag is never set active again — see
   * `chapterStatusWritable`.
   */
  current?: ChapterStatus | undefined,
): ChapterStatusMutation {
  const mutation: RevWriteMutation<ChapterStatus> = useRevWriteMutation<ChapterStatus>({
    write: (status) => writeChapterStatus(campaign, chapter, status, rev),
    entryKey: ["entry", campaign, chapterMetaPath(chapter)],
    invalidateOnSuccess: [
      // Both chapters moved — the whole entry cache, not one of them.
      ["entry", campaign],
      ["tree", campaign],
      ["session", campaign],
      ["search", campaign],
    ],
    errorMessage: "write.status.failed",
  });

  return {
    setStatus: (status: ChapterStatus) => {
      if (!chapterStatusWritable(status, rev, current)) return;
      mutation.write(status);
    },
    pendingStatus: mutation.pendingVariables,
    message: mutation.message,
  };
}
