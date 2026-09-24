// The reading view of every entry that is NOT a scene: the plain titled
// entities (chapter, campaign, and whatever else the entry route is pointed
// at). Same column and same markdown pipeline as the scene article — only the
// header differs, and the scene's type overline never appears here. An npc
// and a location each have their own article on their own route
// (./NpcArticle.tsx, ./LocationArticle.tsx), built from the title and action
// group exported here.

import type { EntryResponse } from "@grimoire/shared/types";
import type { ReactNode } from "react";

import { propString } from "@/lib/properties";
import { cn } from "@/lib/utils";
import { Markdown } from "@/markdown/Markdown";

/** Reading-view title, identical to the scene article's h1. */
export function Title({ children, className }: { children: string; className?: string }) {
  return (
    <h1
      className={cn(
        "font-serif text-[24px] leading-[1.2] font-semibold text-foreground md:text-[30px]",
        className,
      )}
    >
      {children}
    </h1>
  );
}

/**
 * The header's action slot is a GROUP, not a single button: it carries the
 * edit action next to the properties action. Wrapping them keeps them one
 * right-aligned, evenly spaced unit in every header variant — without it the
 * `justify-between` rows below would strand the first button in the middle of
 * the header. Renders nothing when there are no actions.
 *
 * It WRAPS because labels plus a long title do not fit a 390px line, and a
 * clipped action is worse than a second row.
 */
export function ActionGroup({ children }: { children?: ReactNode }) {
  if (children === undefined) return null;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">{children}</span>
  );
}

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
   * editor here and keeps the entity header standing above it.
   */
  body?: ReactNode;
}) {
  const properties = entry.properties;
  // Chapter and campaign entries carry `title` (the campaign also `name`) —
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
