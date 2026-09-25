// "/campaigns/:campaign/entries/*" — the reading view of what is reached by
// its ADDRESS (server/src/store/paths.ts): a chapter (`<chapter>`) and the
// campaign (`campaign`). Title and text, the same column and the same
// markdown pipeline as every other article. A scene, an npc and a location
// are each read on their own route (ADR #31).
//
// Above the article sits the context line — for a chapter the chapter itself
// — and in its header the quiet actions: edit (the text), the chapter's field
// dialog, and for the campaign the dialog over its name and description, under
// the name the field dialog carries everywhere else. Each is its own editing
// session over the one row, so a save from one while the other stands asks
// what to do instead of overwriting it.
//
// Edit mode is remembered BY ADDRESS: this route stays mounted across a
// navigation, and an editor seeded from another row would be a lie.

import type { EntryResponse } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router";

import { fetchEntry, fetchTree } from "@/api";
import { ActionGroup, Title } from "@/components/ArticleHeader";
import { CampaignMetaAction } from "@/components/CampaignMetaAction";
import { EntryBodyEditAction, EntryBodyEditor } from "@/components/EntryBodyEditor";
import { MobileBackRow } from "@/components/MobileBackRow";
import { PageContext } from "@/components/PageContext";
import { PropertiesAction } from "@/components/PropertiesAction";
import { useT } from "@/i18n";
import { pageContextCrumbs } from "@/lib/page-context";
import { propString } from "@/lib/properties";
import { Markdown } from "@/markdown/Markdown";

export function AddressRoute() {
  const t = useT();
  const params = useParams();
  const campaign = params.campaign ?? "";
  const path = params["*"] ?? "";
  const [editingPath, setEditingPath] = useState<string>();
  const { data, isPending } = useQuery({
    queryKey: ["entry", campaign, path],
    queryFn: () => fetchEntry(campaign, path),
    enabled: campaign !== "" && path !== "",
  });
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  // Edit mode ENDS at a navigation: coming back must not re-open an editor
  // seeded from the server over a paragraph the DM already left behind.
  useEffect(() => {
    setEditingPath(undefined);
  }, [campaign, path]);

  if (isPending) {
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        {t("scene.loading")}
      </p>
    );
  }
  // The error screen only when there is NOTHING to show: a failing background
  // refetch keeps the cached row — and an open editor with it.
  if (data === undefined) {
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        {t("scene.notLoadable")}
      </p>
    );
  }

  const editing = editingPath === data.path;
  const actions = (
    <>
      {editing ? null : <EntryBodyEditAction onEdit={() => setEditingPath(data.path)} />}
      {/* The chapter's field dialog; it renders nothing for the campaign. */}
      <PropertiesAction campaign={campaign} entry={data} />
      {data.kind === "campaign" && <CampaignMetaAction campaign={campaign} as="properties" />}
    </>
  );
  const body = editing ? (
    <EntryBodyEditor
      key={data.path}
      campaign={campaign}
      entry={data}
      onClose={() => setEditingPath(undefined)}
    />
  ) : undefined;

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-5 pt-5 pb-[100px] md:px-7 md:pt-10 lg:flex-row">
        <div className="w-full min-w-0 flex-1 lg:max-w-[680px]">
          <PageContext crumbs={pageContextCrumbs(campaign, data.path, tree.data)} />
          <AddressArticle entry={data} actions={actions} body={body} />
        </div>
      </div>
    </>
  );
}

/**
 * The article itself: title and text. `actions` is the header's quiet action
 * slot, `body` replaces the rendered text — edit mode puts its editor there
 * and keeps the header standing above it. Free of queries, so it renders
 * without a server.
 */
export function AddressArticle({
  entry,
  actions,
  body,
}: {
  entry: EntryResponse;
  actions?: ReactNode;
  body?: ReactNode;
}) {
  const properties = entry.properties;
  // A chapter carries `title`, the campaign `name` — either may be missing
  // (degrade), then the address is the honest fallback.
  const title = propString(properties.title) ?? propString(properties.name) ?? entry.path;

  return (
    <article className="w-full min-w-0">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <Title>{title}</Title>
        <ActionGroup>{actions}</ActionGroup>
      </div>
      {body ?? <Markdown>{entry.body}</Markdown>}
    </article>
  );
}
