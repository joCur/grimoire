// "/campaigns/:campaign/locations/:id" — the reading view of ONE location,
// its own resource with its own type (decisions/resources). The page is the
// scene route's sibling: the context line on top (the location list), the
// article, and the quiet actions in its header — edit and the augment run.
//
// Edit switches the page into the location's edit mode
// (./LocationEditMode.tsx): the same article, every field of the location
// editable in place and saved together.
//
// Edit mode is remembered BY LOCATION: this route stays mounted across a
// navigation, and an editor seeded from another location would be a lie. A
// navigation away from unsaved work asks first (UnsavedChangesGuard).

import type { Location } from "@grimoire/shared/location";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router";

import { fetchTree, isNotFound } from "@/api";
import { BodyEditAction } from "@/components/BodyEditor";
import { MobileMenuRow } from "@/components/MobileMenuRow";
import { NotFound } from "@/components/NotFound";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { LocationArticle } from "./LocationArticle";
import { LocationEditMode } from "./LocationEditMode";
import { locationQuery } from "./location-query";

export function LocationRoute(props: {
  /** The augment run on this location — the generator job's dialog, handed in. */
  augmentAction: (campaign: string, location: Location) => ReactNode;
}) {
  return (
    <UnsavedChangesGuard>
      <LocationPage {...props} />
    </UnsavedChangesGuard>
  );
}

function LocationPage({
  augmentAction,
}: {
  augmentAction: (campaign: string, location: Location) => ReactNode;
}) {
  const t = useT();
  const { campaign = "", id = "" } = useParams();
  const [editingId, setEditingId] = useState<string>();
  const { data, isPending, error } = useQuery({
    ...locationQuery(campaign, id),
    enabled: campaign !== "" && id !== "",
  });
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  // Edit mode ENDS at a navigation: coming back must not re-open an editor
  // seeded from the server over a paragraph the DM already left behind.
  useEffect(() => {
    setEditingId(undefined);
  }, [campaign, id]);

  if (isPending) {
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        {t("reading.loading")}
      </p>
    );
  }
  // The error screen only when there is NOTHING to show: a failing background
  // refetch keeps the cached location — and an open editor with it.
  if (data === undefined) {
    if (isNotFound(error)) return <NotFound campaign={campaign} />;
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        {t("reading.notLoadable")}
      </p>
    );
  }

  const editing = editingId === data.id;

  return (
    <>
      <MobileMenuRow campaign={campaign} />
      <div
        className={cn(
          "mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-5 pt-5 md:px-7 md:pt-10 lg:flex-row",
          // Room for the save bar at the bottom of the phone's screen.
          editing ? "pb-[140px] md:pb-[100px]" : "pb-[100px]",
        )}
      >
        <div className={cn("w-full min-w-0 flex-1", editing ? "lg:max-w-[820px]" : "lg:max-w-[680px]")}>
          {editing ? (
            <LocationEditMode
              key={data.id}
              campaign={campaign}
              location={data}
              tree={tree.data}
              onClose={() => setEditingId(undefined)}
            />
          ) : (
            <LocationArticle
              location={data}
              actions={
                <>
                  <BodyEditAction onEdit={() => setEditingId(data.id)} />
                  {augmentAction(campaign, data)}
                </>
              }
            />
          )}
        </div>
      </div>
    </>
  );
}
