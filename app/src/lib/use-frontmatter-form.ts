// React-query half of the „Eigenschaften" form (issue #42).
//
// The cache/409 mechanics are the shared envelope in use-mtime-write.ts; what
// belongs to this path is the invalidation set. A frontmatter patch can move
// almost everything the campaign tree carries — title/name, status, type,
// location, npcs, tags, the chapter a file hangs under — and the search index
// is built from the same values, so both go stale. The file itself is NOT
// invalidated: PATCH /frontmatter answers with the written file and the
// envelope seeds it, so the reading view behind the dialog shows the new chips,
// header and NPC cards the moment it closes.

import type { FileResponse } from "@grimoire/shared/types";

import { writeFrontmatterForm } from "@/lib/frontmatter-form";
import { useMtimeWriteMutation, type MtimeWriteMutation } from "@/lib/use-mtime-write";
import { withMtime } from "@/lib/write-with-mtime";

export function useFrontmatterFormMutation(
  campaign: string,
  path: string,
  /** The version the open dialog writes against — frozen by the caller. */
  mtimeMs: number,
  handlers: {
    onSaved: () => void;
    /** The re-read file after a conflict; the dialog moves its base to it. */
    onConflict: (file: FileResponse | undefined) => void;
  },
): MtimeWriteMutation<Record<string, unknown>> {
  return useMtimeWriteMutation<Record<string, unknown>>({
    write: withMtime(mtimeMs, (patch, mtime) =>
      writeFrontmatterForm(campaign, path, mtime, patch),
    ),
    fileKey: ["file", campaign, path],
    invalidateOnSuccess: [
      ["tree", campaign],
      ["search", campaign],
    ],
    errorMessage: "Eigenschaften nicht gespeichert — Server prüfen",
    onSaved: handlers.onSaved,
    onConflict: handlers.onConflict,
  });
}
