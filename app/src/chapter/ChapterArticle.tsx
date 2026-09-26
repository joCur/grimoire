// The article of a chapter's reading view: its title and its text, the same
// column and the same markdown pipeline as every other article. Free of
// queries, so it renders without a server.

import type { Chapter } from "@grimoire/shared/chapter";
import type { ReactNode } from "react";

import { ActionGroup, Title } from "@/components/ArticleHeader";
import { Markdown } from "@/markdown/Markdown";

/** `actions` is the header's quiet action slot — the route owns the actions. */
export function ChapterArticle({ chapter, actions }: { chapter: Chapter; actions?: ReactNode }) {
  return (
    <article className="w-full min-w-0">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        {/* A chapter without a title is shown under its id — never blank. */}
        <Title>{chapter.title.trim() === "" ? chapter.id : chapter.title}</Title>
        <ActionGroup>{actions}</ActionGroup>
      </div>
      <Markdown>{chapter.body}</Markdown>
    </article>
  );
}
