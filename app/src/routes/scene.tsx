// "/:campaign/file/*" — the reading view of ONE file. For a scene that is
// the scene article per the design reference (type overline, Literata title,
// trigger row, chip row, markdown body — shared with the live view via
// SceneArticle) plus a sticky right aside with the scene's NPC cards. Below
// md (issue #11): a "‹ Pool" back row on top and the NPC cards stacked below
// the body (the column layout already stacks under lg).
//
// Every other entity (issue #26) renders through EntityArticle, chosen by the
// `kind` the server sends: NPC, location, or a plain titled header for
// chapter/campaign/anything else. The scene's type overline belongs to scenes
// only — "Geplante Szene" above an NPC was the PO's pain report.
//
// Above the article sits the context line (issue #34): the topbar carries no
// breadcrumb any more, so "chapter › group" for a scene and "NPCs"/"Orte" for
// an npc/location live here, right above the title they belong to.
//
// „Bearbeiten" in the header (issue #15) turns the body into the raw markdown
// editor — header, chips and status regler keep standing, the properties is
// not part of it. The route owns only the "which path is being edited" bit;
// the write, the 409 and the discard guard live in FileBodyEditor.
//
// „Eigenschaften" next to it (issue #42) is the properties half: a form over
// all typed fields of the kind. It stays available while the body editor runs —
// its patch never touches the body, and the editor adopts a body-neutral new
// version instead of turning it into a conflict (shouldAdvanceBase).

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { fetchFile, fetchTree } from "@/api";
import { CampaignMetaAction } from "@/components/CampaignMetaAction";
import { EntityArticle } from "@/components/EntityArticle";
import { FileBodyEditAction, FileBodyEditor } from "@/components/FileBodyEditor";
import { PropertiesAction } from "@/components/PropertiesAction";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NpcCard } from "@/components/NpcCard";
import { PageContext } from "@/components/PageContext";
import { RenameAction } from "@/components/RenameAction";
import { SceneArticle } from "@/components/SceneArticle";
import { SceneStatusControl } from "@/components/SceneStatusMenu";
import { entityHeaderKind } from "@/lib/entity";
import { canEditFileBody } from "@/lib/file-body";
import { fmString, fmStringArray } from "@/lib/properties";
import { pageContextCrumbs } from "@/lib/page-context";
import { renameTargetFor } from "@/lib/rename";

export function SceneRoute() {
  const params = useParams();
  const campaign = params.campaign ?? "";
  const path = params["*"] ?? "";
  // Edit mode (issue #15) is remembered BY PATH, not as a plain boolean: this
  // route stays mounted across a navigation, and an editor seeded from another
  // file would be a lie. Opening a different file simply leaves edit mode.
  const [editingPath, setEditingPath] = useState<string>();
  const editing = editingPath !== undefined && editingPath === path;
  // … and it ENDS at a navigation. Leaving the file drops the draft (accepted
  // for this slice), so coming back must not re-open the editor unasked: an
  // editor seeded from disk looks exactly like the one the DM left, and the
  // paragraph they typed would be silently gone from it.
  useEffect(() => {
    setEditingPath(undefined);
  }, [path]);
  const enabled = campaign !== "" && path !== "";
  const { data, isPending } = useQuery({
    queryKey: ["file", campaign, path],
    queryFn: () => fetchFile(campaign, path),
    enabled,
  });
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  if (isPending) {
    return <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">Lade Eintrag …</p>;
  }
  // The error screen only when there is NOTHING to show. A failing BACKGROUND
  // refetch (server restarted, network blip) also flips the query to 'error'
  // while the cached file is still there — swapping the page for an error line
  // then would unmount an open editor and take the DM's unsaved text with it.
  if (data === undefined) {
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        Eintrag nicht ladbar — Pfad prüfen oder Server starten.
      </p>
    );
  }

  const isScene = entityHeaderKind(data.kind) === "scene";
  // The aside belongs to scenes: only they reference npcs in properties.
  const npcs = isScene ? fmStringArray(data.properties.npcs) : [];
  // „Umbenennen" (issue #30) — offered for the kinds that HAVE a renameable
  // id (npc, location, scene, chapter); undefined for sessions, inbox,
  // glossary and the campaign file, where the action renders nothing.
  const renameAction = (
    <RenameAction campaign={campaign} currentPath={data.path} target={renameTargetFor(data)} />
  );
  // „Bearbeiten" (issue #15) — the body editor, offered for the kinds whose
  // prose the DM maintains (canEditFileBody). While it runs the trigger is
  // gone: the editor's own toggle owns the mode from then on.
  const editAction =
    canEditFileBody(data.kind) && !editing ? (
      <FileBodyEditAction onEdit={() => setEditingPath(path)} />
    ) : null;
  // The body slot of the article — the editor while edit mode is on, seeded
  // from the file on screen (and re-keyed per path, so it never carries the
  // draft of another file).
  const bodyEditor = editing ? (
    <FileBodyEditor
      key={data.path}
      campaign={campaign}
      file={data}
      onClose={() => setEditingPath(undefined)}
    />
  ) : undefined;
  // „Eigenschaften" (issue #42) — the properties form of the kinds that have
  // typed fields (scene, npc, location, chapter); it renders nothing for the
  // rest. The tree feeds its reference fields (npc/location/chapter ids).
  const propertiesAction = (
    <PropertiesAction campaign={campaign} file={data} tree={tree.data} />
  );
  const articleActions = (
    <>
      {editAction}
      {propertiesAction}
      {renameAction}
    </>
  );
  // The campaign file's header carries the metadata „Bearbeiten" instead
  // (issue #34): its name/description are what this page shows, and its id is
  // the campaign directory — not renameable from here.
  const headerActions =
    data.kind === "campaign" ? <CampaignMetaAction campaign={campaign} /> : articleActions;

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-5 pt-5 pb-[100px] md:px-7 md:pt-10 lg:flex-row">
        <div className="w-full min-w-0 flex-1 lg:max-w-[680px]">
          {/* Where this file sits — the context the topbar breadcrumb used to
              carry (issue #34): chapter › group for a scene, the list for an
              npc/location, nothing for the rest. */}
          <PageContext crumbs={pageContextCrumbs(campaign, data.path, tree.data)} />
          {isScene ? (
            <SceneArticle
              file={data}
              tree={tree.data}
              variant="scene"
              actions={articleActions}
              body={bodyEditor}
              // Issue #28: the status display IS the control here. The rev
              // comes from the FileResponse on screen, so the patch carries
              // exactly the version the DM was looking at.
              statusControl={
                <SceneStatusControl
                  campaign={campaign}
                  path={data.path}
                  status={fmString(data.properties.status) ?? "draft"}
                  rev={data.rev}
                  variant="pill"
                />
              }
            />
          ) : (
            <EntityArticle file={data} actions={headerActions} body={bodyEditor} />
          )}
        </div>
        {npcs.length > 0 && (
          <aside className="flex w-full flex-none flex-col gap-3.5 lg:sticky lg:top-0 lg:w-[280px]">
            <h2 className="text-[12px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
              NPCs dieser Szene
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
