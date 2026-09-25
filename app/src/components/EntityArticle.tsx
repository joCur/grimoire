// The reading view of a chapter and the campaign: title and text. Same column
// and same markdown pipeline as the scene article — only the header differs,
// and the scene's type overline never appears here.

import type { EntryResponse } from "@grimoire/shared/types";
import type { ReactNode } from "react";

import { ActionGroup, Title } from "@/components/ArticleHeader";
import { propString } from "@/lib/properties";
import { Markdown } from "@/markdown/Markdown";

/**
 * `actions` is the header's quiet action slot (the edit, properties and
 * augment triggers). The component stays free of queries — the route owns the
 * actions and passes them in, exactly like the scene article's status control.
 */
export function EntityArticle({
  entry,
  actions,
  body,
}: {
  entry: EntryResponse;
  actions?: ReactNode;
  /**
   * Replaces the rendered body — edit mode puts its markdown
   * editor here and keeps the header standing above it.
   */
  body?: ReactNode;
}) {
  const properties = entry.properties;
  // A chapter and the campaign carry `title` (the campaign also `name`) —
  // either may be missing (degrade), then the address is the honest fallback.
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
