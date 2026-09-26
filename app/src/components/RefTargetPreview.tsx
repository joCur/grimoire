// What the hover preview of a `[[slug]]` reference says about its target — a
// glimpse, not the row: a head line with kind and status, then the rows of its
// short form. This module only picks WHICH preview a target gets; each comes
// from the slice of the one it names.
//
// Kind and name are known before anything loads — the tree that resolved the
// reference has them — so the card opens labelled, never empty. The rest
// comes with the row under the SAME query key the aside cards and the drawer
// use, so a row one of them already read is not asked for again
// (`staleTime: Infinity`: only the version poll's invalidation makes it
// stale). While it loads, static placeholder bars stand in; if it fails, the
// card simply keeps kind and name — mid-sentence an error line is noise.
//
// Passive by contract: nothing in here is a link or a control, and names
// inside a short form are plain text.

import { LocationPreview } from "@/location/LocationPreview";
import type { ResolvedRef } from "@/markdown/refs";
import { NpcPreview } from "@/npc/NpcPreview";
import { ScenePreview } from "@/scene/ScenePreview";

export function RefTargetPreview({
  campaign,
  target,
  nameOf,
}: {
  campaign: string;
  target: ResolvedRef;
  /** Display name of a slug — references inside a short form read as names. */
  nameOf: (slug: string) => string | undefined;
}) {
  const props = { campaign, id: target.slug, name: target.name, nameOf };
  switch (target.kind) {
    case "npc":
      return <NpcPreview {...props} />;
    case "location":
      return <LocationPreview {...props} />;
    case "scene":
      return <ScenePreview {...props} />;
  }
}
