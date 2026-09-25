// "/campaigns/:campaign/list/scenes", "/campaigns/:campaign/npcs" and
// "/campaigns/:campaign/locations" — the simple list pages, reached from the
// mobile start surface's lookup rows and from the topbar's quiet npc and
// location links on the desktop. The page is the frame: the heading, the
// list's create action and the loading states; the rows come from the list
// they show — the scenes grouped flat by chapter here, the npcs and the
// locations from their own slices (ADR #31). The layout is width-agnostic (a
// plain list).

import type { CampaignTree } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, GitFork } from "lucide-react";
import { useParams } from "react-router";

import { fetchTree } from "@/api";
import { ListRow } from "@/components/ListRow";
import { MobileBackRow } from "@/components/MobileBackRow";
import { useT } from "@/i18n";
import { locationName } from "@/lib/campaign";
import { browseListTitle } from "@/lib/entity";
import { encodeAddress } from "@/lib/address";
import { LocationCreateAction } from "@/location/LocationCreateAction";
import { LocationList } from "@/location/LocationList";
import { NpcCreateAction } from "@/npc/NpcCreateAction";
import { NpcList } from "@/npc/NpcList";

/**
 * `kind` is the list of a route of its own (`npcs`, `locations`); without it
 * the `:kind` of the `list/` route decides — where `npcs` and `locations` name
 * nothing, because those lists live at their own routes.
 */
export function BrowseRoute({ kind: ownKind }: { kind?: "npcs" | "locations" } = {}) {
  const t = useT();
  const params = useParams();
  const campaign = params.campaign ?? "";
  const kind = ownKind ?? (params.kind === "scenes" ? "scenes" : "");
  const { data, isPending, isError } = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  const title = browseListTitle(kind, t);

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[760px] px-5 pt-5 pb-16 md:px-7 md:pt-10">
        {/* The list heading carries the list's own create action: these two
            pages are the only surfaces that show ALL npcs/locations, and the
            only ones a phone reaches. Scenes are created in their chapter, in
            the chapter overview — a scene without one has no address. */}
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[24px] leading-[1.25] font-semibold text-foreground">
            {title ?? t("browse.fallbackTitle")}
          </h1>
          <span className="ml-auto">
            {kind === "npcs" && <NpcCreateAction campaign={campaign} />}
            {kind === "locations" && <LocationCreateAction campaign={campaign} />}
          </span>
        </div>
        {title === undefined && (
          <p className="text-[13.5px] text-muted-foreground">{t("browse.unknown")}</p>
        )}
        {title !== undefined && isPending && (
          <p className="text-[13.5px] text-muted-foreground">{t("browse.loading")}</p>
        )}
        {title !== undefined && isError && (
          <p className="text-[13.5px] text-muted-foreground">{t("common.serverDown")}</p>
        )}
        {data !== undefined && kind === "scenes" && <SceneList campaign={campaign} tree={data} />}
        {data !== undefined && kind === "npcs" && <NpcList campaign={campaign} />}
        {data !== undefined && kind === "locations" && (
          <LocationList campaign={campaign} tree={data} />
        )}
      </div>
    </>
  );
}

/** Scenes flat per chapter — the chapter title as a quiet group overline. */
function SceneList({ campaign, tree }: { campaign: string; tree: CampaignTree }) {
  const t = useT();
  const chapters = tree.chapters.filter((ch) => ch.scenes.length > 0);
  if (chapters.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">{t("browse.empty.scenes")}</p>;
  }
  return (
    <>
      {chapters.map((chapter) => (
        <section key={chapter.id} className="mb-6">
          <p className="mb-1 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
            {chapter.title}
          </p>
          {chapter.scenes.map((scene) => (
            <ListRow
              key={scene.path}
              to={entryHref(campaign, scene.path)}
              icon={scene.type === "contingency" ? GitFork : Bookmark}
              title={scene.title}
              meta={locationName(tree, scene.location)}
            />
          ))}
        </section>
      ))}
    </>
  );
}

/** The read view of a scene, by its address. */
function entryHref(campaign: string, path: string): string {
  return `/campaigns/${campaign}/entries/${encodeAddress(path)}`;
}
