// "/campaigns/:campaign/scenes", "/campaigns/:campaign/npcs" and
// "/campaigns/:campaign/locations" — the simple list pages, reached from the
// mobile start surface's lookup rows and from the topbar's quiet npc and
// location links on the desktop. The page is the frame: the heading, the
// loading states and the place of the list's create action; the list itself
// and its action come from the slice of what it lists (decisions/resources), handed in by
// App.tsx. The layout is width-agnostic (a plain list).

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useParams } from "react-router";

import { fetchTree } from "@/api";
import { MobileBackRow } from "@/components/MobileBackRow";
import { useT, type MessageKey } from "@/i18n";

export function BrowseRoute({
  titleKey,
  action,
  list,
}: {
  /** The page's heading, out of the catalog. */
  titleKey: MessageKey;
  /** The list's create action beside the heading, when it has one. */
  action?: (campaign: string) => ReactNode;
  /** The rows, drawn by the slice of what the page lists. */
  list: (campaign: string, tree: CampaignTree) => ReactNode;
}) {
  const t = useT();
  const { campaign = "" } = useParams();
  const { data, isPending, isError } = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[760px] px-5 pt-5 pb-16 md:px-7 md:pt-10">
        {/* The list heading carries the list's own create action: the npc
            and location pages are the only surfaces that show ALL of them,
            and the only ones a phone reaches. Scenes are created in their
            chapter, in the chapter overview — a scene always belongs to one. */}
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[24px] leading-[1.25] font-semibold text-foreground">
            {t(titleKey)}
          </h1>
          {action !== undefined && <span className="ml-auto">{action(campaign)}</span>}
        </div>
        {isPending && <p className="text-[13.5px] text-muted-foreground">{t("browse.loading")}</p>}
        {isError && <p className="text-[13.5px] text-muted-foreground">{t("common.serverDown")}</p>}
        {data !== undefined && list(campaign, data)}
      </div>
    </>
  );
}
