// "/campaigns/:campaign/chapters/:id" — the reading view of ONE chapter, its
// own resource with its own type (decisions/resources): the context line on top (the
// chapter itself, linking to the chapter overview where its scenes stand),
// the article, and the two quiet actions in its header — edit (the text) and
// the dialog over its other fields. Each is its own editing session over the
// one row, so a save from one while the other stands asks what to do instead
// of overwriting it.
//
// Edit mode is remembered BY CHAPTER: this route stays mounted across a
// navigation, and an editor seeded from another chapter would be a lie.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { fetchTree } from "@/api";
import { BodyEditAction } from "@/components/BodyEditor";
import { MobileBackRow } from "@/components/MobileBackRow";
import { PageContext } from "@/components/PageContext";
import { useT } from "@/i18n";

import { ChapterArticle } from "./ChapterArticle";
import { ChapterBodyEditor, ChapterFieldsAction } from "./ChapterActions";
import { chapterPageCrumbs } from "./chapter-links";
import { chapterQuery } from "./chapter-query";

export function ChapterRoute() {
  const t = useT();
  const { campaign = "", id = "" } = useParams();
  const [editingId, setEditingId] = useState<string>();
  const { data, isPending } = useQuery({
    ...chapterQuery(campaign, id),
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
  // refetch keeps the cached chapter — and an open editor with it.
  if (data === undefined) {
    return (
      <p className="mx-auto max-w-[1060px] px-7 pt-10 text-muted-foreground">
        {t("reading.notLoadable")}
      </p>
    );
  }

  const editing = editingId === data.id;
  const actions = (
    <>
      {editing ? null : <BodyEditAction onEdit={() => setEditingId(data.id)} />}
      <ChapterFieldsAction campaign={campaign} chapter={data} />
    </>
  );
  const body = editing ? (
    <ChapterBodyEditor
      key={data.id}
      campaign={campaign}
      chapter={data}
      onClose={() => setEditingId(undefined)}
    />
  ) : undefined;

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto flex max-w-[1060px] flex-col items-start gap-10 px-5 pt-5 pb-[100px] md:px-7 md:pt-10 lg:flex-row">
        <div className="w-full min-w-0 flex-1 lg:max-w-[680px]">
          <PageContext crumbs={chapterPageCrumbs(campaign, data.id, tree.data)} />
          <ChapterArticle chapter={data} actions={actions} body={body} />
        </div>
      </div>
    </>
  );
}
