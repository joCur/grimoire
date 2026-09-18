// The reading view of everything that is NOT a scene: NPC, location and the
// plain titled entities (chapter, campaign, and whatever else the entry route
// is pointed at). Same column and same markdown pipeline as the scene
// article — only the header differs, and the scene's type overline never
// appears here.
//
// Reference lines (statblock, roll20-page) stay PLAIN TEXT on purpose: the
// format references Roll20 by name, it never links or copies it (README).

import type { EntryResponse } from "@grimoire/shared/types";
import type { ReactNode } from "react";

import { entityHeaderKind, npcStatusLabel } from "@/lib/entity";
import { propQuickstats, propString } from "@/lib/properties";
import { useT } from "@/i18n";
import { sessionDateLabel } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Markdown } from "@/markdown/Markdown";

/** Reading-view title, identical to the scene article's h1. */
function Title({ children, className }: { children: string; className?: string }) {
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
function ActionGroup({ children }: { children?: ReactNode }) {
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
  file,
  actions,
  body,
}: {
  file: EntryResponse;
  actions?: ReactNode;
  /**
   * Replaces the rendered body — edit mode puts its markdown
   * editor here and keeps the entity header standing above it.
   */
  body?: ReactNode;
}) {
  const t = useT();
  const header = entityHeaderKind(file.kind);
  const properties = file.properties;
  // npc/location entries carry `name`, chapter/campaign entries `title` — either
  // may be missing (degrade), then the path is the honest fallback.
  // A SESSION has no `title` and its id is opaque noise, so the heading is
  // derived from `started` instead of falling through to the path.
  const fallback = file.kind === "session" ? sessionDateLabel(properties, t) : file.path;
  const name = propString(properties.name) ?? propString(properties.title) ?? fallback;
  const title = propString(properties.title) ?? propString(properties.name) ?? fallback;

  return (
    <article className="w-full min-w-0">
      {header === "npc" ? (
        <NpcHeader file={file} name={name} actions={actions} />
      ) : header === "location" ? (
        <LocationHeader file={file} name={name} actions={actions} />
      ) : (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <Title>{title}</Title>
          <ActionGroup>{actions}</ActionGroup>
        </div>
      )}
      {body ?? <Markdown>{file.body}</Markdown>}
    </article>
  );
}

function NpcHeader({
  file,
  name,
  actions,
}: {
  file: EntryResponse;
  name: string;
  actions?: ReactNode;
}) {
  const t = useT();
  const properties = file.properties;
  const role = propString(properties.role);
  const status = propString(properties.status);
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

function LocationHeader({
  file,
  name,
  actions,
}: {
  file: EntryResponse;
  name: string;
  actions?: ReactNode;
}) {
  const t = useT();
  const page = propString(file.properties["roll20-page"]);
  return (
    <header className="mb-7 border-b border-border pb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Title>{name}</Title>
        <ActionGroup>{actions}</ActionGroup>
      </div>
      {page !== undefined && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {t("entity.location.roll20", { value: page })}
        </p>
      )}
    </header>
  );
}
