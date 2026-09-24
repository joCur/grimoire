// The reading view of every entry that is NOT a scene: NPC and the plain
// titled entities (chapter, campaign, and whatever else the entry route is
// pointed at). Same column and same markdown pipeline as the scene article —
// only the header differs, and the scene's type overline never appears here.
// A location has its own article on its own route (./LocationArticle.tsx),
// built from the title and action group exported here.
//
// Reference lines (statblock) stay PLAIN TEXT on purpose: the format
// references Roll20 by name, it never links or copies it (README).
//
// The npc's prose property `motivation` stands in the header, read exactly as
// the cards read it (lib/entity-excerpt.ts): a `[[slug]]` inside reads as the
// current name.

import type { EntryResponse } from "@grimoire/shared/types";
import type { ReactNode } from "react";

import { entityHeaderKind, npcStatusLabel, npcStatusOf } from "@/lib/entity";
import { npcExcerpt } from "@/lib/entity-excerpt";
import { propQuickstats, propString } from "@/lib/properties";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useEntityRefs } from "@/markdown/entity-refs";
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
  const header = entityHeaderKind(entry.kind);
  const properties = entry.properties;
  // npc entries carry `name`, chapter/campaign entries `title` — either
  // may be missing (degrade), then the address is the honest fallback.
  const fallback = entry.path;
  const name = propString(properties.name) ?? propString(properties.title) ?? fallback;
  const title = propString(properties.title) ?? propString(properties.name) ?? fallback;

  return (
    <article className="w-full min-w-0">
      {header === "npc" ? (
        <NpcHeader entry={entry} name={name} actions={actions} />
      ) : (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <Title>{title}</Title>
          <ActionGroup>{actions}</ActionGroup>
        </div>
      )}
      {body ?? <Markdown>{entry.body}</Markdown>}
    </article>
  );
}

function NpcHeader({
  entry,
  name,
  actions,
}: {
  entry: EntryResponse;
  name: string;
  actions?: ReactNode;
}) {
  const t = useT();
  const { resolve } = useEntityRefs();
  const properties = entry.properties;
  const motivation = npcExcerpt(entry, (slug) => resolve(slug)?.name).will;
  const role = propString(properties.role);
  const status = npcStatusOf(properties);
  const voice = propString(properties.voice);
  const appearance = propString(properties.appearance);
  const statblock = propString(properties.statblock);
  const quickstats = propQuickstats(properties.quickstats);

  return (
    <header className="mb-7 border-b border-border pb-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <Title>{name}</Title>
        {status !== undefined && (
          <span className="flex-none rounded-full border border-input px-[9px] py-px text-[11.5px] text-dim">
            {npcStatusLabel(status, t)}
          </span>
        )}
        {actions !== undefined && (
          <span className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</span>
        )}
      </div>
      {role !== undefined && (
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">{role}</p>
      )}
      {voice !== undefined && (
        <p className="mt-3 text-[14px] leading-[1.6] text-body italic">{voice}</p>
      )}
      {appearance !== undefined && (
        <p className="mt-1 text-[14px] leading-[1.6] text-body-secondary italic">{appearance}</p>
      )}
      {motivation !== undefined && (
        <p className="mt-3 text-[14px] leading-[1.6] text-body">
          <span className="text-muted-foreground">{t("npcCard.will.inline")}</span> {motivation}
        </p>
      )}
      {quickstats.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {quickstats.map(([key, value]) => (
            <span
              key={key}
              className="rounded-[4px] border border-input bg-background px-[7px] py-[3px] font-mono text-[11px] text-soft"
            >
              {key} {value}
            </span>
          ))}
        </div>
      )}
      {statblock !== undefined && (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {t("entity.npc.statblock", { value: statblock })}
        </p>
      )}
    </header>
  );
}
