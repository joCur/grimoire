// "/:campaign/list/:kind" — the simple mobile list pages (issue #11),
// reached from the start surface's "Nachschlagen" rows: scenes grouped flat
// by chapter, npcs and locations alphabetical. Every row opens the read
// view (/:campaign/file/<path>). The layout is width-agnostic (a plain
// list), but the pages are only linked from the mobile chrome.

import type { CampaignTree } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, ChevronRight, GitFork, MapPin, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useParams } from "react-router";

import { fetchTree } from "@/api";
import { MobileBackRow } from "@/components/MobileBackRow";
import { locationName } from "@/lib/campaign";

const TITLES: Record<string, string> = {
  scenes: "Szenen",
  npcs: "NPCs",
  locations: "Orte",
};

export function BrowseRoute() {
  const { campaign = "", kind = "" } = useParams();
  const { data, isPending, isError } = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  const title = TITLES[kind];

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[760px] px-5 pt-5 pb-16 md:px-7 md:pt-10">
        <h1 className="mb-3 font-serif text-[24px] leading-[1.25] font-semibold text-foreground">
          {title ?? "Nachschlagen"}
        </h1>
        {title === undefined && (
          <p className="text-[13.5px] text-muted-foreground">Diese Liste gibt es nicht.</p>
        )}
        {title !== undefined && isPending && (
          <p className="text-[13.5px] text-muted-foreground">Lade …</p>
        )}
        {title !== undefined && isError && (
          <p className="text-[13.5px] text-muted-foreground">
            Server nicht erreichbar — Grimoire-Server auf Port 3000 starten.
          </p>
        )}
        {data !== undefined && kind === "scenes" && <SceneList campaign={campaign} tree={data} />}
        {data !== undefined && kind === "npcs" && <NpcList campaign={campaign} tree={data} />}
        {data !== undefined && kind === "locations" && (
          <LocationList campaign={campaign} tree={data} />
        )}
      </div>
    </>
  );
}

/** Scenes flat per chapter — the chapter title as a quiet group overline. */
function SceneList({ campaign, tree }: { campaign: string; tree: CampaignTree }) {
  const chapters = tree.chapters.filter((ch) => ch.groups.some((g) => g.scenes.length > 0));
  if (chapters.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">Noch keine Szenen.</p>;
  }
  return (
    <>
      {chapters.map((chapter) => (
        <section key={chapter.id} className="mb-6">
          <p className="mb-1 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
            {chapter.title}
          </p>
          {chapter.groups
            .flatMap((g) => g.scenes)
            .map((scene) => (
              <Row
                key={scene.path}
                campaign={campaign}
                path={scene.path}
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

function NpcList({ campaign, tree }: { campaign: string; tree: CampaignTree }) {
  if (tree.npcs.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">Noch keine NPCs.</p>;
  }
  const npcs = [...tree.npcs].sort((a, b) => a.name.localeCompare(b.name, "de"));
  return (
    <>
      {npcs.map((npc) => (
        <Row
          key={npc.path}
          campaign={campaign}
          path={npc.path}
          icon={User}
          title={npc.name}
          meta={npc.role}
        />
      ))}
    </>
  );
}

function LocationList({ campaign, tree }: { campaign: string; tree: CampaignTree }) {
  if (tree.locations.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">Noch keine Orte.</p>;
  }
  const locations = [...tree.locations].sort((a, b) => a.name.localeCompare(b.name, "de"));
  return (
    <>
      {locations.map((location) => (
        <Row
          key={location.path}
          campaign={campaign}
          path={location.path}
          icon={MapPin}
          title={location.name}
          meta={tree.chapters.find((ch) => ch.id === location.chapter)?.title}
        />
      ))}
    </>
  );
}

function Row({
  campaign,
  path,
  icon: Icon,
  title,
  meta,
}: {
  campaign: string;
  path: string;
  icon: LucideIcon;
  title: string;
  meta: string | undefined;
}) {
  return (
    <Link
      to={`/${campaign}/file/${path}`}
      className="flex min-h-[52px] items-center gap-3 rounded-md border-b border-divider px-1 py-1.5 hover:bg-card"
    >
      <Icon aria-hidden size={16} className="flex-none text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-foreground">{title}</span>
        {meta !== undefined && meta !== "" && (
          <span className="mt-px block truncate text-[12.5px] text-muted-foreground">{meta}</span>
        )}
      </span>
      <ChevronRight aria-hidden size={15} className="flex-none text-faint" />
    </Link>
  );
}
