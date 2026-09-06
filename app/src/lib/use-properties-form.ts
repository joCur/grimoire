// React-query half of the „Eigenschaften" form (issue #42).
//
// The cache/409 mechanics are the shared envelope in use-rev-write.ts; what
// belongs to this path is the invalidation set. A properties patch can move
// almost everything the campaign tree carries — title/name, status, type,
// location, npcs, tags, the chapter a file hangs under — and the search index
// is built from the same values, so both go stale. The file itself is NOT
// invalidated: PATCH /properties answers with the written file and the
// envelope seeds it, so the reading view behind the dialog shows the new chips,
// header and NPC cards the moment it closes.

import type { FileResponse } from "@grimoire/shared/types";

import { writePropertiesForm } from "@/lib/properties-form";
import { useRevWriteMutation, type RevWriteMutation } from "@/lib/use-rev-write";
import { withRev } from "@/lib/write-with-rev";

export function usePropertiesFormMutation(
  campaign: string,
  path: string,
  /** The version the open dialog writes against — frozen by the caller. */
  rev: number,
  handlers: {
    onSaved: () => void;
    /** The re-read file after a conflict; the dialog moves its base to it. */
    onConflict: (file: FileResponse | undefined) => void;
  },
): RevWriteMutation<Record<string, unknown>> {
  return useRevWriteMutation<Record<string, unknown>>({
    write: withRev(rev, (patch, rev) =>
      writePropertiesForm(campaign, path, rev, patch),
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
