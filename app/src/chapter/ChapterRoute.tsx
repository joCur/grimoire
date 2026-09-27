// "/campaigns/:campaign/chapters/:id" — the reading view of ONE chapter, its
// own resource with its own type (decisions/resources): the article and the
// quiet edit action in its header.
//
// Edit switches the page into the chapter's edit mode
// (./ChapterEditMode.tsx): the same article, every field of the chapter
// editable in place and saved together.
//
// The threads of the chapter are not this slice's to read: the page is handed
// their query (`threadsQuery`), which the edit mode's delete dialog counts.
//
// Edit mode is remembered BY CHAPTER: this route stays mounted across a
// navigation, and an editor seeded from another chapter would be a lie. A
// navigation away from unsaved work asks first (UnsavedChangesGuard).

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { fetchTree, isNotFound } from "@/api";
import { BodyEditAction } from "@/components/BodyEditor";
import { MobileMenuRow } from "@/components/MobileMenuRow";
import { NotFound } from "@/components/NotFound";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { ChapterArticle } from "./ChapterArticle";
import { ChapterEditMode, type ChapterThreadsQuery } from "./ChapterEditMode";
import { chapterQuery } from "./chapter-query";

export function ChapterRoute({ threadsQuery }: { threadsQuery: ChapterThreadsQuery }) {
  return (
    <UnsavedChangesGuard>
      <ChapterPage threadsQuery={threadsQuery} />
    </UnsavedChangesGuard>
  );
}

function ChapterPage({ threadsQuery }: { threadsQuery: ChapterThreadsQuery }) {
  const t = useT();
  const { campaign = "", id = "" } = useParams();
  const [editingId, setEditingId] = useState<string>();
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsEdit = searchParams.get("edit") === "1";
  const { data, isPending, error } = useQuery({
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
  // `?edit=1` opens edit mode straight away — how the chapter overview's edit
  // action arrives here. The flag is CONSUMED (replace, so it leaves no
  // history entry): it is an instruction for this navigation, not a state of
  // the page, and a reload or a back gesture must not re-open an editor over
  // a text the DM has meanwhile left.
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
  // The error screen only when there is NOTHING to show: a failing background
  // refetch keeps the cached chapter — and an open editor with it.
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
            <ChapterEditMode
              key={data.id}
              campaign={campaign}
              chapter={data}
              tree={tree.data}
              threadsQuery={threadsQuery}
              onClose={() => setEditingId(undefined)}
            />
          ) : (
            <ChapterArticle
              chapter={data}
              actions={<BodyEditAction onEdit={() => setEditingId(data.id)} />}
            />
          )}
        </div>
      </div>
    </>
  );
}
