// Location card fed from locations/<id>.md (issue #40) — the counterpart of
// NpcCard for the live aside: the DM needs the PLACE of the running scene as
// readily as its people ("wo stehen wir gerade?"), and until now the scene's
// `location` was only a line in the scene header.
//
// Shown: the display name and the one line that is useful mid-sentence — the
// first paragraph of `## Atmosphäre` when the file has one, else the Roll20
// page reference (plain text: the format references Roll20 by name, it never
// links it — README).
//
// Degradation like everywhere: while the query runs nothing is claimed, any
// failure is a one-liner. Never an error. There is no "Ortseintrag fehlt"
// placeholder any more (issue #70): a scene `location` that is a SLUG gets
// its entry created by the write that names it, and free text never reaches
// this card at all — the caller only mounts it for an id the tree knows
// (routes/live.tsx).

import { useQuery } from "@tanstack/react-query";

import { fetchFile } from "@/api";
import { EntityCardShell } from "@/components/EntityCardShell";
import { fmString } from "@/lib/frontmatter";
import { firstParagraphOfSection } from "@/lib/md-section";

/**
 * Fallback path of a location entry — used only when the caller has no tree
 * entry for the id. Where the tree knows the entity, its `path` is passed in
 * instead of guessed here: the entry's real address is the tree's answer,
 * not a convention.
 */
export function locationPath(id: string): string {
  return `locations/${id}.md`;
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
  const path = knownPath ?? locationPath(id);
  const { data, isPending, isError } = useQuery({
    queryKey: ["file", campaign, path],
    queryFn: () => fetchFile(campaign, path),
    retry: false,
  });

  if (isPending) return null;

  if (isError) {
    return (
      <p className="text-[12px] leading-[1.5] text-muted-foreground">
        <span className="font-mono">{id}</span> — Ort nicht ladbar, Server prüfen.
      </p>
    );
  }
  if (data === undefined) return null;

  const fm = data.frontmatter;
  const name = fmString(fm.name) ?? id;
  const mood = firstParagraphOfSection(data.body, "Atmosphäre");
  const page = fmString(fm["roll20-page"]);

  return (
    <EntityCardShell campaign={campaign} path={path} onOpen={onOpen} className="p-3.5">
      <p className="mb-px font-serif text-[15px] font-semibold text-foreground">{name}</p>
      {mood !== undefined && (
        <p className="mt-1.5 text-[12.5px] leading-[1.5] text-body-secondary">{mood}</p>
      )}
      {mood === undefined && page !== undefined && (
        <p className="mt-1.5 text-[12px] text-muted-foreground">Roll20-Seite: {page}</p>
      )}
    </EntityCardShell>
  );
}
