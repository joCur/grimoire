// What the hover preview of a `[[slug]]` reference says about its target — a
// glimpse, not the row: a head line with kind and status, then the rows of its
// short form. This module only picks WHICH preview a target gets: an npc's and
// a location's come from their own slices, a scene's is below.
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

import { useQuery } from "@tanstack/react-query";

import { fetchEntry, fetchTree } from "@/api";
import { CompactHead, CompactName, CompactPlaceholder } from "@/components/Compact";
import { useT, type Translate } from "@/i18n";
import { sceneExcerpt, type NameOf, type SceneExcerpt } from "@/lib/entity-excerpt";
import { sceneStatusMeta } from "@/lib/scene-status";
import { LocationPreview } from "@/location/LocationPreview";
import type { ResolvedEntityRef } from "@/markdown/entity-refs";
import { NpcPreview } from "@/npc/NpcPreview";

export function EntityPreview({
  campaign,
  target,
  nameOf,
}: {
  campaign: string;
  target: ResolvedEntityRef;
  /** Display name of a slug — references inside a short form read as names. */
  nameOf: NameOf;
}) {
  switch (target.kind) {
    case "npc":
      return <NpcPreview campaign={campaign} id={target.slug} name={target.name} nameOf={nameOf} />;
    case "location":
      return (
        <LocationPreview campaign={campaign} id={target.slug} name={target.name} nameOf={nameOf} />
      );
    case "scene":
      return <ScenePreview campaign={campaign} path={target.path} name={target.name} nameOf={nameOf} />;
  }
}

/** The scene's kind is its type: planned or contingency, else just "scene". */
function sceneKindLabel(type: string | undefined, t: Translate): string {
  if (type === "contingency") return t("sceneArticle.type.contingency");
  if (type === "planned") return t("sceneArticle.type.planned");
  return t("kind.scene");
}

function ScenePreview({
  campaign,
  path,
  name,
  nameOf,
}: {
  campaign: string;
  path: string;
  name: string;
  nameOf: NameOf;
}) {
  const t = useT();
  const entry = useQuery({
    queryKey: ["entry", campaign, path],
    queryFn: () => fetchEntry(campaign, path),
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
  });
  // A scene names its location by id; its display name is the tree's —
  // already in the cache, because the tree is what resolved this reference.
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    staleTime: Infinity,
  });
  const excerpt =
    entry.data === undefined
      ? undefined
      : sceneExcerpt(
          entry.data,
          (id) => tree.data?.locations.find((location) => location.id === id)?.name,
          nameOf,
        );
  return (
    <>
      <CompactHead
        kind={sceneKindLabel(excerpt?.type, t)}
        status={
          excerpt === undefined
            ? undefined
            : {
                label: sceneStatusMeta(excerpt.status, t).label,
                tone: excerpt.status === "ready" ? "good" : "quiet",
              }
        }
      />
      {excerpt === undefined ? (
        <>
          <CompactName name={name} />
          {entry.isPending && <CompactPlaceholder widths={["w-[85%]", "w-[60%]"]} />}
        </>
      ) : (
        <SceneCompact name={name} excerpt={excerpt} />
      )}
    </>
  );
}

/** The scene's short form: title, then trigger and location as labelled rows. */
function SceneCompact({ name, excerpt }: { name: string; excerpt: SceneExcerpt }) {
  const t = useT();
  return (
    <>
      <CompactName name={name} />
      {excerpt.trigger !== undefined && (
        <p className="mt-1.5 flex items-baseline gap-2 text-[12.5px] leading-[1.5]">
          <span className="flex-none text-muted-foreground">{t("sceneArticle.trigger.label")}</span>
          <span className="line-clamp-3 min-w-0 text-soft italic">{excerpt.trigger}</span>
        </p>
      )}
      {excerpt.location !== undefined && (
        <p className="mt-1.5 flex items-baseline gap-2 text-[12.5px] leading-[1.5]">
          <span className="flex-none text-muted-foreground">{t("refPreview.scene.location")}</span>
          <span className="min-w-0 text-body">{excerpt.location}</span>
        </p>
      )}
    </>
  );
}
