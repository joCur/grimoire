// "/campaigns/:campaign/scenes/:id" — the reading view of ONE scene, its own
// resource with its own type (decisions/resources): the scene article per the design
// reference (type overline, Literata title, trigger row, chip row, markdown
// body — shared with the session view through SceneArticle) plus a sticky
// right aside with the cards of the scene's npcs. Below md: a back row to the
// chapter overview on top and the npc cards stacked below the body (the
// column layout already stacks under lg).
//
// Above the article sits the context line: the topbar carries no breadcrumb,
// so the chapter and the location live here, right above the title they
// belong to.
//
// The header carries the scene's quiet actions — edit and the augment run —
// and its status control. Edit switches the page into the scene's edit mode
// (./SceneEditMode.tsx): the same article, every field of the scene editable
// in place and saved together. The npc cards step aside while it stands, so
// the text gets the width.
//
// The npc cards and the augment action are not this slice's to draw: the
// route is handed them (`npcCard`, `augmentAction`), so the scene never
// reaches into the npc's slice or the generator job's.
//
// Edit mode is remembered BY SCENE: this route stays mounted across a
// navigation, and an editor seeded from another scene would be a lie. A
// navigation away from unsaved work asks first (UnsavedChangesGuard).

import type { Scene } from "@grimoire/shared/scene";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";

import { fetchTree, isNotFound } from "@/api";
import { BodyEditAction } from "@/components/BodyEditor";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NotFound } from "@/components/NotFound";
import { PageContext } from "@/components/PageContext";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { SceneArticle } from "./SceneArticle";
import { SceneEditMode } from "./SceneEditMode";
import { SceneStatusControl } from "./SceneStatusMenu";
import { scenePageCrumbs } from "./scene-links";
import { sceneQuery } from "./scene-query";

export function SceneRoute(props: {
  /** The card of one npc the scene names — drawn by the npc, not by the scene. */
  npcCard: (campaign: string, id: string) => ReactNode;
  /** The augment run on this scene — the generator job's dialog. */
  augmentAction: (campaign: string, scene: Scene) => ReactNode;
}) {
  return (
    <UnsavedChangesGuard>
      <ScenePage {...props} />
    </UnsavedChangesGuard>
  );
}

function ScenePage({
  npcCard,
  augmentAction,
}: {
  npcCard: (campaign: string, id: string) => ReactNode;
  augmentAction: (campaign: string, scene: Scene) => ReactNode;
}) {
  const t = useT();
  const { campaign = "", id = "" } = useParams();
  const [editingId, setEditingId] = useState<string>();
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsEdit = searchParams.get("edit") === "1";
  const { data, isPending, error } = useQuery({
    ...sceneQuery(campaign, id),
    enabled: campaign !== "" && id !== "",
  });
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  // Edit mode ENDS at a navigation. Leaving the scene drops the draft (after
  // the guard asked, when there was one), so coming back must not re-open the
  // editor unasked: an editor seeded from the server looks exactly like the
  // one the DM left, and the paragraph they typed would be silently gone.
  useEffect(() => {
    setEditingId(undefined);
  }, [campaign, id]);
  // `?edit=1` opens edit mode straight away — how a freshly created scene
  // arrives here (a scene with nothing but a title is there to be written,
  // and the block composer is how). The flag is CONSUMED (replace, so it
  // leaves no history entry): it is an instruction for this navigation, not a
  // state of the page, and a reload or a back gesture must not re-open an
  // editor over a text the DM has meanwhile left.
  const loadedId = data?.id;
  useEffect(() => {
    if (!wantsEdit || loadedId === undefined) return;
    setEditingId(loadedId);
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  }, [wantsEdit, loadedId, searchParams, setSearchParams]);

  if (isPending) {
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        {t("reading.loading")}
      </p>
    );
  }
  // The error screen only when there is NOTHING to show. A failing BACKGROUND
  // refetch (server restarted, network blip) also flips the query to 'error'
  // while the cached scene is still there — swapping the page for an error
  // line then would unmount an open editor and take the DM's unsaved text
  // with it.
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
          <PageContext crumbs={scenePageCrumbs(campaign, data, tree.data)} />
          {editing ? (
            <SceneEditMode
              key={data.id}
              campaign={campaign}
              scene={data}
              tree={tree.data}
              onClose={() => setEditingId(undefined)}
            />
          ) : (
            <SceneArticle
              scene={data}
              tree={tree.data}
              variant="scene"
              // The augment action is desktop-only (mobile is the reading
              // surface).
              actions={
                <>
                  <BodyEditAction onEdit={() => setEditingId(data.id)} />
                  {augmentAction(campaign, data)}
                </>
              }
              // The status display IS the control here. The rev comes from the
              // scene on screen, so the write carries exactly the version the
              // DM was looking at.
              statusControl={
                <SceneStatusControl
                  campaign={campaign}
                  id={data.id}
                  status={data.status}
                  rev={data.rev}
                  variant="pill"
                />
              }
            />
          )}
        </div>
        {!editing && data.npcs.length > 0 && (
          <aside className="flex w-full flex-none flex-col gap-3.5 lg:sticky lg:top-0 lg:w-[280px]">
            <h2 className="text-[12px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
              {t("scene.npcs.heading")}
            </h2>
            {data.npcs.map((npc) => (
              <Fragment key={npc}>{npcCard(campaign, npc)}</Fragment>
            ))}
          </aside>
        )}
      </div>
    </>
  );
}
