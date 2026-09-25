// "/campaigns/:campaign/locations/:id" — the reading view of ONE location,
// its own resource with its own type (ADR #31). The page is the scene
// route's sibling: the context line on top (the location list), the
// article, and the three quiet actions in its header — edit (the text with
// the `atmosphere` beside it), the dialog over the other fields, and the
// augment run.
//
// Edit mode is remembered BY LOCATION: this route stays mounted across a
// navigation, and an editor seeded from another location would be a lie.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { fetchTree } from "@/api";
import { BodyEditAction } from "@/components/BodyEditor";
import { MobileBackRow } from "@/components/MobileBackRow";
import { PageContext } from "@/components/PageContext";
import { useT } from "@/i18n";

import { LocationArticle } from "./LocationArticle";
import { LocationBodyEditor, LocationFieldsAction } from "./LocationActions";
import { LocationAugmentAction } from "./LocationAugmentAction";
import { locationPageCrumbs } from "./location-links";
import { locationQuery } from "./location-query";

export function LocationRoute() {
  const t = useT();
  const { campaign = "", id = "" } = useParams();
  const [editingId, setEditingId] = useState<string>();
  const { data, isPending } = useQuery({
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
        {t("scene.loading")}
      </p>
    );
  }
  // The error screen only when there is NOTHING to show: a failing background
  // refetch keeps the cached location — and an open editor with it.
  if (data === undefined) {
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        {t("scene.notLoadable")}
      </p>
    );
  }

  const editing = editingId === data.id;
  const actions = (
    <>
      {editing ? null : <BodyEditAction onEdit={() => setEditingId(data.id)} />}
      <LocationFieldsAction campaign={campaign} location={data} tree={tree.data} />
      {editing ? null : <LocationAugmentAction campaign={campaign} location={data} />}
    </>
  );
  const body = editing ? (
    <LocationBodyEditor
      key={data.id}
      campaign={campaign}
      location={data}
      onClose={() => setEditingId(undefined)}
    />
  ) : undefined;

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-5 pt-5 pb-[100px] md:px-7 md:pt-10 lg:flex-row">
        <div className="w-full min-w-0 flex-1 lg:max-w-[680px]">
          <PageContext crumbs={locationPageCrumbs(campaign, t)} />
          <LocationArticle location={data} actions={actions} body={body} />
        </div>
      </div>
    </>
  );
}
