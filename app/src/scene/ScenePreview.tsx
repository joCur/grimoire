// What the hover preview of a `[[slug]]` reference to a scene says: its kind
// (planned or contingency) with its status, then its title and the rows of
// its short form — the trigger and the location. The title is known before
// anything loads — the tree that resolved the reference has it — so the card
// opens labelled. The rest comes with the scene's own query (the key its
// reading view and drawer share); while it loads, static bars stand in, and if
// it fails the card simply keeps kind and title.

import type { SceneType } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";

import { fetchTree } from "@/api";
import { CompactHead, CompactName, CompactPlaceholder } from "@/components/Compact";
import { useT, type Translate } from "@/i18n";
import { locationName } from "@/lib/campaign";

import { sceneExcerpt, type NameOf, type SceneExcerpt } from "./scene-excerpt";
import { sceneQuery } from "./scene-query";
import { sceneStatusMeta } from "./scene-status";

/** The scene's kind is its type: planned or contingency, else just "scene". */
function sceneKindLabel(type: SceneType | undefined, t: Translate): string {
  if (type === "contingency") return t("sceneArticle.type.contingency");
  if (type === "planned") return t("sceneArticle.type.planned");
  return t("kind.scene");
}

export function ScenePreview({
  campaign,
  id,
  name,
  nameOf,
}: {
  campaign: string;
  id: string;
  name: string;
  /** Display name of a slug — references inside the trigger read as names. */
  nameOf: NameOf;
}) {
  const t = useT();
  const scene = useQuery({
    ...sceneQuery(campaign, id),
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
    scene.data === undefined
      ? undefined
      : sceneExcerpt(
          scene.data,
          (location) => locationName(tree.data, location),
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
          {scene.isPending && <CompactPlaceholder widths={["w-[85%]", "w-[60%]"]} />}
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
