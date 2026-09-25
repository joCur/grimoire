// "/campaigns/:campaign/list/scenes", "/campaigns/:campaign/npcs" and
// "/campaigns/:campaign/locations" — the simple list pages, reached from the
// mobile start surface's lookup rows and from the topbar's quiet npc and
// location links on the desktop. The page is the frame: the heading, the
// list's create action and the loading states; the rows come from the list
// they show — the scenes, the npcs and the locations each from their own
// slice (ADR #31). The layout is width-agnostic (a plain list).

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { fetchTree } from "@/api";
import { MobileBackRow } from "@/components/MobileBackRow";
import { useT, type MessageKey, type Translate } from "@/i18n";
import { LocationCreateAction } from "@/location/LocationCreateAction";
import { LocationList } from "@/location/LocationList";
import { NpcCreateAction } from "@/npc/NpcCreateAction";
import { NpcList } from "@/npc/NpcList";
import { SceneList } from "@/scene/SceneList";

/**
 * Title of a list page — the scene list (`/campaigns/:campaign/list/scenes`)
 * and the npc and location lists on their own routes — or undefined for a
 * kind that has no list.
 */
const LIST_TITLE_KEYS: Record<string, MessageKey> = {
  scenes: "browse.title.scenes",
  npcs: "browse.title.npcs",
  locations: "browse.title.locations",
};

export function browseListTitle(kind: string, t: Translate): string | undefined {
  const key = LIST_TITLE_KEYS[kind];
  return key === undefined ? undefined : t(key);
}

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
            the chapter overview — a scene always belongs to one. */}
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
