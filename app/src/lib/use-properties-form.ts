// React-query half of the „Eigenschaften" form (issue #42).
//
// The cache/409 mechanics are the shared envelope in use-rev-write.ts; what
// belongs to this path is the invalidation set. A properties patch can move
// almost everything the campaign tree carries — title/name, status, type,
// location, npcs, tags, the chapter an entry hangs under — and the search index
// is built from the same values, so both go stale. The entry itself is NOT
// invalidated: PATCH /properties answers with the written entry and the
// envelope seeds it, so the reading view behind the dialog shows the new chips,
// header and NPC cards the moment it closes.

import type { EntryResponse } from "@grimoire/shared/types";

import { writePropertiesForm } from "@/lib/properties-form";
import { useRevWriteMutation, type RevWriteMutation } from "@/lib/use-rev-write";
import { withRev } from "@/lib/write-with-rev";

/**
 * What one save carries: the diff, plus the display name for the Ort the
 * scene's `location` may CREATE (issue #100 follow-up — the Ort field takes
 * free text, `propertiesPatch` stores the slug and this carries the name).
 */
export interface PropertiesWrite {
  patch: Record<string, unknown>;
  locationName?: string;
}

export function usePropertiesFormMutation(
  campaign: string,
  path: string,
  /** The version the open dialog writes against — frozen by the caller. */
  rev: number,
  handlers: {
    onSaved: () => void;
    /** The re-read entry after a conflict; the dialog moves its base to it. */
    onConflict: (file: EntryResponse | undefined) => void;
  },
  /**
   * The kind on screen. Only one value changes anything: a CHAPTER patch can
   * set `status: active`, which the server answers by ALSO putting the
   * previously active chapter back to `planned` — a second entry this dialog
   * never read. Its cached copy would keep the old status, so the whole entry
   * cache goes for that kind and not just the seeded entry.
   */
  kind?: string,
): RevWriteMutation<PropertiesWrite> {
  return useRevWriteMutation<PropertiesWrite>({
    write: withRev(rev, (write, rev) =>
      writePropertiesForm(campaign, path, rev, write.patch, write.locationName),
    ),
    entryKey: ["entry", campaign, path],
    invalidateOnSuccess: [
      ...(kind === "chapter" ? [["entry", campaign]] : []),
      ["tree", campaign],
      ["search", campaign],
    ],
    errorMessage: "write.properties.failed",
    onSaved: handlers.onSaved,
    onConflict: handlers.onConflict,
  });
}
