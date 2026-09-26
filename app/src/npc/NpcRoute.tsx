// "/campaigns/:campaign/npcs/:id" — the reading view of ONE npc, its own
// resource with its own type (decisions/resources). The page is the scene
// route's sibling: the context line on top (the npc list), the article, and
// the quiet actions in its header — edit and the augment run.
//
// Edit switches the page into the npc's edit mode (./NpcEditMode.tsx): the
// same article, every field of the npc editable in place and saved together.
//
// Edit mode is remembered BY NPC: this route stays mounted across a
// navigation, and an editor seeded from another npc would be a lie. A
// navigation away from unsaved work asks first (UnsavedChangesGuard).

import type { Npc } from "@grimoire/shared/npc";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router";

import { fetchTree, isNotFound } from "@/api";
import { BodyEditAction } from "@/components/BodyEditor";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NotFound } from "@/components/NotFound";
import { PageContext } from "@/components/PageContext";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { NpcArticle } from "./NpcArticle";
import { NpcEditMode } from "./NpcEditMode";
import { npcPageCrumbs } from "./npc-links";
import { npcQuery } from "./npc-query";

export function NpcRoute(props: {
  /** The augment run on this npc — the generator job's dialog, handed in. */
  augmentAction: (campaign: string, npc: Npc) => ReactNode;
}) {
  return (
    <UnsavedChangesGuard>
      <NpcPage {...props} />
    </UnsavedChangesGuard>
  );
}

function NpcPage({
  augmentAction,
}: {
  augmentAction: (campaign: string, npc: Npc) => ReactNode;
}) {
  const t = useT();
  const { campaign = "", id = "" } = useParams();
  const [editingId, setEditingId] = useState<string>();
  const { data, isPending, error } = useQuery({
    ...npcQuery(campaign, id),
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
  // refetch keeps the cached npc — and an open editor with it.
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
      <MobileBackRow campaign={campaign} />
      <div
        className={cn(
          "mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-5 pt-5 md:px-7 md:pt-10 lg:flex-row",
          // Room for the save bar at the bottom of the phone's screen.
          editing ? "pb-[140px] md:pb-[100px]" : "pb-[100px]",
        )}
      >
        <div className={cn("w-full min-w-0 flex-1", editing ? "lg:max-w-[820px]" : "lg:max-w-[680px]")}>
          <PageContext crumbs={npcPageCrumbs(campaign, t)} />
          {editing ? (
            <NpcEditMode
              key={data.id}
              campaign={campaign}
              npc={data}
              tree={tree.data}
              onClose={() => setEditingId(undefined)}
            />
          ) : (
            <NpcArticle
              npc={data}
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
