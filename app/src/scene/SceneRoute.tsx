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
// The header carries the scene's quiet actions — edit (the text), the dialog
// over its other fields and the augment run — and its status control. The
// edit action turns the body into the editor while header, chips and status
// control keep standing; the dialog stays available beside it. Each is its
// own editing session over the one row, so a save from one while the other
// stands asks what to do instead of overwriting it.
//
// The npc cards and the augment action are not this slice's to draw: the
// route is handed them (`npcCard`, `augmentAction`), so the scene never
// reaches into the npc's slice or the generator job's.
//
// Edit mode is remembered BY SCENE: this route stays mounted across a
// navigation, and an editor seeded from another scene would be a lie.

import type { Scene } from "@grimoire/shared/scene";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";

import { fetchTree, isNotFound } from "@/api";
import { BodyEditAction } from "@/components/BodyEditor";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NotFound } from "@/components/NotFound";
import { PageContext } from "@/components/PageContext";
import { useT } from "@/i18n";

import { SceneArticle } from "./SceneArticle";
import { SceneBodyEditor, SceneFieldsAction } from "./SceneActions";
import { SceneStatusControl } from "./SceneStatusMenu";
import { scenePageCrumbs } from "./scene-links";
import { sceneQuery } from "./scene-query";

export function SceneRoute({
  npcCard,
  augmentAction,
}: {
  /** The card of one npc the scene names — drawn by the npc, not by the scene. */
  npcCard: (campaign: string, id: string) => ReactNode;
  /** The augment run on this scene — the generator job's dialog. */
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

  // Edit mode ENDS at a navigation. Leaving the scene drops the draft, so
  // coming back must not re-open the editor unasked: an editor seeded from
  // the server looks exactly like the one the DM left, and the paragraph they
  // typed would be silently gone from it.
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
        {t("scene.loading")}
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
        {t("scene.notLoadable")}
      </p>
    );
  }

  const editing = editingId === data.id;
  // While the body editor runs, the edit trigger is gone (the editor's own
  // toggle owns the mode) and so is the augment run: two writers on one text
  // is not a review. The augment action is desktop-only (mobile is the
  // reading surface).
  const actions = (
    <>
      {editing ? null : <BodyEditAction onEdit={() => setEditingId(data.id)} />}
      <SceneFieldsAction campaign={campaign} scene={data} tree={tree.data} />
      {editing ? null : augmentAction(campaign, data)}
    </>
  );
  const body = editing ? (
    <SceneBodyEditor
      key={data.id}
      campaign={campaign}
      scene={data}
      onClose={() => setEditingId(undefined)}
    />
  ) : undefined;

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-5 pt-5 pb-[100px] md:px-7 md:pt-10 lg:flex-row">
        <div className="w-full min-w-0 flex-1 lg:max-w-[680px]">
          <PageContext crumbs={scenePageCrumbs(campaign, data, tree.data)} />
          <SceneArticle
            scene={data}
            tree={tree.data}
            variant="scene"
            actions={actions}
            body={body}
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
        </div>
        {data.npcs.length > 0 && (
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
