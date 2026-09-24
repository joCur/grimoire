// "/campaigns/:campaign/entries/*" — the reading view of ONE entry. For a
// scene that is the scene article per the design reference (type overline, Literata title,
// trigger row, chip row, markdown body — shared with the live view via
// SceneArticle) plus a sticky right aside with the scene's NPC cards. Below
// md: a back row to the chapter overview on top and the NPC cards stacked below
// the body (the column layout already stacks under lg).
//
// Every other entry renders through EntityArticle, chosen by the
// `kind` the server sends: a plain titled header for chapter/campaign/anything
// else. An npc and a location are each read on their own route
// (routes/npc.tsx, routes/location.tsx, ADR #31). The scene's type overline
// belongs to scenes only — a scene status above a chapter would name the
// wrong thing.
//
// Above the article sits the context line: the topbar carries no
// breadcrumb, so chapter and group for a scene live here, right above the
// title they belong to.
//
// The edit action in the header turns the body into the editor — header,
// chips and status control keep standing. The route owns only the "which
// path is being edited" bit; the write, the 409 and the discard guard live in
// EntryBodyEditor.
//
// The augment action is the third one: source text and/or an
// instruction go to a server job, and its proposal comes back as a review —
// properties per field, body per block, nothing written until accepted.
//
// The properties action next to it is the properties half: a form over
// the typed fields of the kind, less the prose the editor carries — for the
// campaign entry, the dialog over its name and description. It stays available while the body editor runs;
// each of them is its own editing session, so a save from one while the other
// stands asks what to do instead of overwriting it.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { fetchEntry, fetchTree } from "@/api";
import { AugmentAction } from "@/components/AugmentAction";
import { CampaignMetaAction } from "@/components/CampaignMetaAction";
import { EntityArticle } from "@/components/EntityArticle";
import { EntryBodyEditAction, EntryBodyEditor } from "@/components/EntryBodyEditor";
import { PropertiesAction } from "@/components/PropertiesAction";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NpcCard } from "@/components/NpcCard";
import { PageContext } from "@/components/PageContext";
import { SceneArticle } from "@/components/SceneArticle";
import { SceneStatusControl } from "@/components/SceneStatusMenu";
import { useT } from "@/i18n";
import { entityHeaderKind } from "@/lib/entity";
import { encodeAddress } from "@/lib/address";
import { propString, propStringArray } from "@/lib/properties";
import { sceneStatusOf } from "@/lib/scene-status";
import { pageContextCrumbs } from "@/lib/page-context";

export function SceneRoute() {
  const t = useT();
  const params = useParams();
  const campaign = params.campaign ?? "";
  const path = params["*"] ?? "";
  // Edit mode is remembered BY ENTRY, not as a plain boolean:
  // this route stays mounted across a navigation, and an editor seeded from
  // another entry would be a lie. Opening a different entry simply leaves edit
  // mode.
  //
  // The entry is identified by its `id`, NOT by its address:
  // a scene's address carries its `location`, so correcting the location
  // while the body editor is open moves the address — and keying on the
  // address threw the open draft away for a move the DM had just asked for.
  const [editingId, setEditingId] = useState<string>();
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsEdit = searchParams.get("edit") === "1";
  const enabled = campaign !== "" && path !== "";
  const { data, isPending } = useQuery({
    queryKey: ["entry", campaign, path],
    queryFn: () => fetchEntry(campaign, path),
    enabled,
  });
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  // What the entry on screen IS, across every address it may have: the
  // properties `id`, which the format declares immutable, with
  // the canonical address as the fallback for an entry whose properties
  // carries none.
  const docId = data === undefined ? undefined : (propString(data.properties.id) ?? data.path);
  const editing = data !== undefined && editingId !== undefined && editingId === docId;
  // Edit mode ENDS at a navigation. Leaving the entry drops the draft, so
  // coming back must not re-open the editor
  // unasked: an editor seeded from the server looks exactly like the one the DM
  // left, and the paragraph they typed would be silently gone from it.
  useEffect(() => {
    setEditingId(undefined);
  }, [docId]);
  // `?edit=1` opens edit mode straight away — how a freshly created scene
  // arrives here (a scene with nothing but a title is there to be
  // written, and the block composer is how). The flag is CONSUMED (replace, so
  // it leaves no history entry): it is an instruction for this navigation, not
  // a state of the page, and a reload or a back gesture must not re-open an editor
  // over a body the DM has meanwhile left.
  useEffect(() => {
    if (!wantsEdit || docId === undefined) return;
    setEditingId(docId);
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  }, [wantsEdit, docId, searchParams, setSearchParams]);

  // The scene MOVED. A scene's group segment is its `location`,
  // so correcting the location rewrites the address — and every link written
  // before that correction (a browser bookmark, the URL in another tab, a
  // note) now names the old one. The server resolves a scene by id and
  // answers with the CURRENT address in `path`, so the one thing left to do
  // is to make the URL agree with it: replace, never push, because the stale
  // address must not become a history entry the back button returns to.
  const canonical = data?.path;
  const navigate = useNavigate();
  useEffect(() => {
    if (canonical === undefined || canonical === path) return;
    navigate(`/campaigns/${encodeURIComponent(campaign)}/entries/${encodeAddress(canonical)}`, {
      replace: true,
    });
  }, [campaign, canonical, path, navigate]);

  if (isPending) {
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        {t("scene.loading")}
      </p>
    );
  }
  // The error screen only when there is NOTHING to show. A failing BACKGROUND
  // refetch (server restarted, network blip) also flips the query to 'error'
  // while the cached entry is still there — swapping the page for an error line
  // then would unmount an open editor and take the DM's unsaved text with it.
  if (data === undefined) {
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        {t("scene.notLoadable")}
      </p>
    );
  }

  const isScene = entityHeaderKind(data.kind) === "scene";
  // The aside belongs to scenes: only they reference npcs in properties.
  const npcs = isScene ? propStringArray(data.properties.npcs) : [];
  // The edit action — the body editor. While it runs the trigger is gone: the
  // editor's own toggle owns the mode from then on.
  const editAction = editing ? null : <EntryBodyEditAction onEdit={() => setEditingId(docId)} />;
  // The body slot of the article — the editor while edit mode is on, seeded
  // from the entry on screen (and re-keyed per path, so it never carries the
  // draft of another entry).
  const bodyEditor = editing ? (
    <EntryBodyEditor
      key={docId}
      campaign={campaign}
      entry={data}
      onClose={() => setEditingId(undefined)}
    />
  ) : undefined;
  // The properties action — the properties form of the kinds that have typed
  // fields (scene, chapter); it renders nothing for the rest.
  // The tree feeds its reference fields (npc/location/chapter ids).
  const propertiesAction = (
    <PropertiesAction campaign={campaign} entry={data} tree={tree.data} />
  );
  // The augment action — the third quiet action, for the kind
  // that has an augment prompt here (scene); it renders nothing
  // for the rest, and it is desktop-only (mobile is the reading surface).
  // While the body editor runs it stays out of the way for the same reason
  // the edit action does: two writers on one body is not a review.
  const augmentAction = editing ? null : <AugmentAction campaign={campaign} entry={data} />;
  // The campaign entry's properties half is its own dialog — name and
  // description, the two values no typed form models — so it stands where the
  // properties action stands for every other kind, and under that name. The
  // body next to it is prose the DM edits like a chapter's.
  const campaignMetaAction =
    data.kind === "campaign" ? <CampaignMetaAction campaign={campaign} as="properties" /> : null;
  const articleActions = (
    <>
      {editAction}
      {propertiesAction}
      {campaignMetaAction}
      {augmentAction}
    </>
  );

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-5 pt-5 pb-[100px] md:px-7 md:pt-10 lg:flex-row">
        <div className="w-full min-w-0 flex-1 lg:max-w-[680px]">
          {/* Where this entry sits — the context the topbar does not carry:
              chapter › group for a scene, the chapter for a chapter, nothing
              for the rest. */}
          <PageContext crumbs={pageContextCrumbs(campaign, data.path, tree.data, t)} />
          {isScene ? (
            <SceneArticle
              entry={data}
              tree={tree.data}
              variant="scene"
              actions={articleActions}
              body={bodyEditor}
              // The status display IS the control here. The rev
              // comes from the EntryResponse on screen, so the patch carries
              // exactly the version the DM was looking at.
              statusControl={
                <SceneStatusControl
                  campaign={campaign}
                  path={data.path}
                  status={sceneStatusOf(data.properties)}
                  rev={data.rev}
                  variant="pill"
                />
              }
            />
          ) : (
            <EntityArticle entry={data} actions={articleActions} body={bodyEditor} />
          )}
        </div>
        {npcs.length > 0 && (
          <aside className="flex w-full flex-none flex-col gap-3.5 lg:sticky lg:top-0 lg:w-[280px]">
            <h2 className="text-[12px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
              {t("scene.npcs.heading")}
            </h2>
            {npcs.map((id) => (
              <NpcCard key={id} campaign={campaign} id={id} />
            ))}
          </aside>
        )}
      </div>
    </>
  );
}
