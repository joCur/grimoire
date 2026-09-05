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
// Degradation like everywhere: while the query runs nothing is claimed, a
// referenced id WITHOUT a file becomes a quiet dashed placeholder with the
// slug (there is no location-stub endpoint to offer — the file is created in
// the editor), any other failure is a one-liner. Never an error.

import { useQuery } from "@tanstack/react-query";

import { ApiError, fetchFile } from "@/api";
import { EntityCardShell } from "@/components/EntityCardShell";
import { fmString } from "@/lib/frontmatter";
import { firstParagraphOfSection } from "@/lib/md-section";

/** Campaign-relative path of a location file — the reference key is the id. */
export function locationPath(id: string): string {
  return `locations/${id}.md`;
}

export function LocationCard({
  campaign,
  id,
  onOpen,
}: {
  campaign: string;
  id: string;
  /** Opens the live drawer instead of navigating (see EntityCardShell). */
  onOpen?: (path: string) => void;
}) {
  const path = locationPath(id);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["file", campaign, path],
    queryFn: () => fetchFile(campaign, path),
    retry: false,
  });

  if (isPending) return null;

  if (isError) {
    const missing = error instanceof ApiError && error.status === 404;
    if (!missing) {
      return (
        <p className="text-[12px] leading-[1.5] text-muted-foreground">
          <span className="font-mono">{id}</span> — Ort nicht ladbar, Server prüfen.
        </p>
      );
    }
    return <MissingLocationCard id={id} />;
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

/**
 * The visible degradation of a scene `location` without a file — the slug and
 * the reason, nothing else. Exported for the render test (pure).
 */
export function MissingLocationCard({ id }: { id: string }) {
  return (
    <div className="rounded-lg border border-dashed border-input bg-transparent p-3.5">
      <p className="font-mono text-[12.5px] text-soft">{id}</p>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">Ortsdatei fehlt</p>
    </div>
  );
}
