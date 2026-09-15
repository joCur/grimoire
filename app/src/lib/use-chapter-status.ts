// React-query half of the chapter-status regler (issue #115).
//
// The cache/409 mechanics are the shared envelope in use-rev-write.ts; what
// belongs to this path is the INVALIDATION, and it is wider than a scene's.
// „Aktiv" moves two chapter rows, so the whole file cache goes and not just
// the one the server answered with — the chapter that LOST the flag is on the
// same page, and seeding only the winner would leave its pill lying. The tree
// carries every chapter's status (the pool, the session view), and the session
// view reads which chapter is active, so both follow.

import { writeChapterStatus, chapterStatusWritable } from "@/lib/chapter-status";
import { useRevWriteMutation, type RevWriteMutation } from "@/lib/use-rev-write";

export interface ChapterStatusMutation {
  /** Start a write; ignored while another one is in flight, or without a rev. */
  setStatus: (status: string) => void;
  /** The value being written right now — the control shows it dimmed. */
  pendingStatus?: string | undefined;
  /** Quiet inline message: rev conflict, or a failed write. */
  message?: string | undefined;
}

export function useChapterStatusMutation(
  campaign: string,
  chapter: string,
  /** Rev of `<chapter>/_chapter` — only the patch branch needs it. */
  rev: number | undefined,
): ChapterStatusMutation {
  const mutation: RevWriteMutation<string> = useRevWriteMutation<string>({
    write: (status) => writeChapterStatus(campaign, chapter, status, rev),
    fileKey: ["file", campaign, `${chapter}/_chapter`],
    invalidateOnSuccess: [
      // Both chapter documents moved — the whole file cache, not one entry.
      ["file", campaign],
      ["tree", campaign],
      ["session", campaign],
      ["search", campaign],
    ],
    errorMessage: "write.status.failed",
  });

  return {
    setStatus: (status: string) => {
      if (!chapterStatusWritable(status, rev)) return;
      mutation.write(status);
    },
    pendingStatus: mutation.pendingVariables,
    message: mutation.message,
  };
}
