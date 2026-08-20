// The reading view of everything that is NOT a scene (issue #26): NPC,
// location and the plain titled entities (chapter, campaign, and whatever
// else the file route is pointed at). Same column and same markdown pipeline
// as the scene article — only the header differs, and the scene's type
// overline ("Geplante Szene") never appears here.
//
// Reference lines (statblock, roll20-page) stay PLAIN TEXT on purpose: the
// format references Roll20 by name, it never links or copies it (README).

import type { FileResponse } from "@grimoire/shared/types";

import { entityHeaderKind, npcStatusLabel } from "@/lib/entity";
import { fmQuickstats, fmString } from "@/lib/frontmatter";
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

export function EntityArticle({ file }: { file: FileResponse }) {
  const header = entityHeaderKind(file.kind);
  const fm = file.frontmatter;
  // npc/location files carry `name`, chapter/campaign files `title` — either
  // may be missing (degrade), then the path is the honest fallback.
  const name = fmString(fm.name) ?? fmString(fm.title) ?? file.path;
  const title = fmString(fm.title) ?? fmString(fm.name) ?? file.path;

  return (
    <article className="w-full min-w-0">
      {header === "npc" ? (
        <NpcHeader file={file} name={name} />
      ) : header === "location" ? (
        <LocationHeader file={file} name={name} />
      ) : (
        <Title className="mb-6">{title}</Title>
      )}
      <Markdown>{file.body}</Markdown>
    </article>
  );
}

function NpcHeader({ file, name }: { file: FileResponse; name: string }) {
  const fm = file.frontmatter;
  const role = fmString(fm.role);
  const status = fmString(fm.status);
  const voice = fmString(fm.voice);
  const appearance = fmString(fm.appearance);
  const statblock = fmString(fm.statblock);
  const quickstats = fmQuickstats(fm.quickstats);

  return (
    <header className="mb-7 border-b border-border pb-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <Title>{name}</Title>
        {status !== undefined && (
          <span className="flex-none rounded-full border border-input px-[9px] py-px text-[11.5px] text-dim">
            {npcStatusLabel(status)}
          </span>
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
        <p className="mt-3 text-[12.5px] text-muted-foreground">Statblock: {statblock}</p>
      )}
    </header>
  );
}

function LocationHeader({ file, name }: { file: FileResponse; name: string }) {
  const page = fmString(file.frontmatter["roll20-page"]);
  return (
    <header className="mb-7 border-b border-border pb-5">
      <Title>{name}</Title>
      {page !== undefined && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">Roll20-Seite: {page}</p>
      )}
    </header>
  );
}
