// Location card fed from locations/<id> — the counterpart of
// NpcCard for the live aside: the DM needs the PLACE of the running scene as
// readily as its people ("where are we right now?"), and until now the
// scene's `location` was only a line in the scene header.
//
// Shown: the display name and the one line that is useful mid-sentence — the
// `atmosphere` property when the entry has one, else the Roll20 page
// reference (plain text: the format references Roll20 by name, it never links
// it — README). A `[[slug]]` inside the atmosphere reads as the current name,
// like in the text; the rows are the ones the hover preview of a reference
// shows too (components/EntityCompact).
//
// Degradation like everywhere: while the query runs nothing is claimed, any
// failure is a one-liner. Never an error. There is no "location entry
// missing" placeholder any more: a scene's `location` names an entry that
// exists (the reference is a foreign key), and the caller only mounts this
// card for an id the tree knows (routes/live.tsx).

import { useQuery } from "@tanstack/react-query";

import { fetchEntry } from "@/api";
import { EntityCardShell } from "@/components/EntityCardShell";
import { LocationCompact } from "@/components/EntityCompact";
import { useI18n } from "@/i18n";
import { locationExcerpt } from "@/lib/entity-excerpt";
import { propString } from "@/lib/properties";
import { useEntityRefs } from "@/markdown/entity-refs";

/**
 * Fallback path of a location entry — used only when the caller has no tree
 * entry for the id. Where the tree knows the entity, its `path` is passed in
 * instead of guessed here: the entry's real address is the tree's answer,
 * not a convention.
 */
export function locationPath(id: string): string {
  return `locations/${id}`;
}

export function LocationCard({
  campaign,
  id,
  path: knownPath,
  onOpen,
}: {
  campaign: string;
  id: string;
  /** The tree entry's path, when the caller has one (LocationSummary.path). */
  path?: string;
  /** Opens the live drawer instead of navigating (see EntityCardShell). */
  onOpen?: (path: string) => void;
}) {
  const { tNode } = useI18n();
  const { resolve } = useEntityRefs();
  const path = knownPath ?? locationPath(id);
  const { data, isPending, isError } = useQuery({
    queryKey: ["entry", campaign, path],
    queryFn: () => fetchEntry(campaign, path),
    retry: false,
  });

  if (isPending) return null;

  if (isError) {
    return (
      <p className="text-[12px] leading-[1.5] text-muted-foreground">
        {tNode("locationCard.unloadable", {
          id: (
            <span key="id" className="font-mono">
              {id}
            </span>
          ),
        })}
      </p>
    );
  }
  // The address names a location, so the answer is one; anything else has
  // nothing a location card could show.
  if (data === undefined || data.kind !== "location") return null;

  const name = propString(data.name) ?? id;
  return (
    <EntityCardShell campaign={campaign} path={path} onOpen={onOpen} className="p-3.5">
      <LocationCompact name={name} excerpt={locationExcerpt(data, (slug) => resolve(slug)?.name)} />
    </EntityCardShell>
  );
}
