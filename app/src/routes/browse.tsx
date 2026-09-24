// "/campaigns/:campaign/list/scenes", "/campaigns/:campaign/npcs" and
// "/campaigns/:campaign/locations" — the simple list pages, reached from the
// mobile start surface's lookup rows and from the topbar's quiet npc and
// location links on the desktop: scenes grouped flat by chapter, npcs and
// locations alphabetical. A scene row opens its read view
// (/campaigns/:campaign/entries/<path>), an npc or a location row its own
// (/campaigns/:campaign/npcs/<id>, /campaigns/:campaign/locations/<id>,
// ADR #31) — and the npc and location lists are their resources' own lists.
// The layout is width-agnostic (a plain list).

import type { CampaignTree } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, ChevronRight, GitFork, MapPin, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useParams } from "react-router";

import { fetchLocations, fetchNpcs, fetchTree } from "@/api";
import { LocationCreateAction, NpcCreateAction } from "@/components/CreateActions";
import { MobileBackRow } from "@/components/MobileBackRow";
import { useT } from "@/i18n";
import { locationName } from "@/lib/campaign";
import { browseListTitle } from "@/lib/entity";
import { encodeAddress } from "@/lib/address";
import { locationHref, npcHref } from "@/lib/open-target";

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
            <Row
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

/** The npcs, read from their own resource list (already sorted by name). */
function NpcList({ campaign }: { campaign: string }) {
  const t = useT();
  const { data: npcs } = useQuery({
    queryKey: ["npcs", campaign],
    queryFn: () => fetchNpcs(campaign),
  });
  if (npcs === undefined) return null;
  if (npcs.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">{t("browse.empty.npcs")}</p>;
  }
  return (
    <>
      {npcs.map((npc) => (
        <Row
          key={npc.id}
          to={npcHref(campaign, npc.id)}
          icon={User}
          title={npc.name === "" ? npc.id : npc.name}
          meta={npc.role}
        />
      ))}
    </>
  );
}

/** The locations, read from their own resource list (already sorted by name). */
function LocationList({ campaign, tree }: { campaign: string; tree: CampaignTree }) {
  const t = useT();
  const { data: locations } = useQuery({
    queryKey: ["locations", campaign],
    queryFn: () => fetchLocations(campaign),
  });
  if (locations === undefined) return null;
  if (locations.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">{t("browse.empty.locations")}</p>;
  }
  return (
    <>
      {locations.map((location) => (
        <Row
          key={location.id}
          to={locationHref(campaign, location.id)}
          icon={MapPin}
          title={location.name}
          meta={tree.chapters.find((ch) => ch.id === location.chapter)?.title}
        />
      ))}
    </>
  );
}

/** The read view of a scene, by its address. */
function entryHref(campaign: string, path: string): string {
  return `/campaigns/${campaign}/entries/${encodeAddress(path)}`;
}

function Row({
  to,
  icon: Icon,
  title,
  meta,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  meta: string | undefined;
}) {
  return (
    <Link
      to={to}
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
