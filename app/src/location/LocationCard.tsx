// Location card fed from the location's own resource (ADR #31) — for the live
// aside, beside the cards of the scene's people: the DM needs the PLACE of the
// running scene as readily as them ("where are we right now?").
//
// Shown: the display name and the one line that is useful mid-sentence — the
// `atmosphere` field when the location has one, else the Roll20 page
// reference (plain text: the format references Roll20 by name, it never links
// it — README). A `[[slug]]` inside the atmosphere reads as the current name,
// like in the text; the rows are the ones the hover preview of a reference
// shows too (./LocationCompact.tsx).
//
// Degradation like everywhere: while the query runs nothing is claimed, any
// failure is a one-liner. Never an error. A scene's `location` names a
// location that exists (the reference is a foreign key), and the caller only
// mounts this card for an id the tree knows (routes/live.tsx).

import { useQuery } from "@tanstack/react-query";

import { CardShell } from "@/components/CardShell";
import { useI18n } from "@/i18n";
import type { OpenTarget } from "@/lib/open-target";
import { useRefs } from "@/markdown/refs";

import { LocationCompact } from "./LocationCompact";
import { locationHref } from "./location-links";
import { locationExcerpt } from "./location-excerpt";
import { locationQuery } from "./location-query";

export function LocationCard({
  campaign,
  id,
  onOpen,
}: {
  campaign: string;
  id: string;
  /** Opens the live drawer instead of navigating (see CardShell). */
  onOpen?: (target: OpenTarget) => void;
}) {
  const { tNode } = useI18n();
  const { resolve } = useRefs();
  const { data, isPending, isError } = useQuery({ ...locationQuery(campaign, id), retry: false });

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
  if (data === undefined) return null;

  return (
    <CardShell
      href={locationHref(campaign, id)}
      onOpen={onOpen === undefined ? undefined : () => onOpen({ kind: "location", id })}
      className="p-3.5"
    >
      <LocationCompact
        name={data.name}
        excerpt={locationExcerpt(data, (slug) => resolve(slug)?.name)}
      />
    </CardShell>
  );
}
