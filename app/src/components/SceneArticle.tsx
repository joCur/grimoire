// The scene article — type overline, serif title, trigger line, markdown
// body through the pipeline. Shared between the reading view ("scene") and
// the live center column ("live"); live is the denser variant from the
// design prototype: 26px title, location inside the overline, italic
// "Wenn:" line and a plain hairline instead of the chip row.

import type { CampaignTree, FileResponse } from "@grimoire/shared/types";
import { Bookmark, GitFork, MapPin } from "lucide-react";

import { locationName } from "@/lib/campaign";
import { fmString, fmStringArray } from "@/lib/frontmatter";
import { cn } from "@/lib/utils";
import { Markdown } from "@/markdown/Markdown";

export function SceneArticle({
  file,
  tree,
  variant,
}: {
  file: FileResponse;
  tree: CampaignTree | undefined;
  variant: "scene" | "live";
}) {
  const live = variant === "live";
  const fm = file.frontmatter;
  // npc/location files opened as a file view carry `name` instead of `title`.
  const title = fmString(fm.title) ?? fmString(fm.name) ?? file.path;
  // Everything that is not explicitly a contingency reads as a planned
  // scene (degrade — "planned" is the unmarked case).
  const isContingency = fmString(fm.type) === "contingency";
  const trigger = fmString(fm.trigger);
  const location = locationName(tree, fmString(fm.location));
  const tags = fmStringArray(fm.tags);
  const handouts = fmStringArray(fm.handouts);

  return (
    <article className="w-full min-w-0">
      <div className={cn("flex items-center gap-2.5", live ? "mb-2" : "mb-2.5")}>
        {isContingency ? (
          <GitFork aria-hidden size={16} className="flex-none text-soft" />
        ) : (
          <Bookmark aria-hidden size={16} className="flex-none text-success-text" />
        )}
        <span
          className={cn(
            "text-[12px] tracking-[.06em] uppercase",
            isContingency ? "text-soft" : "text-success-text",
          )}
        >
          {isContingency ? "Kontingenz" : "Geplante Szene"}
        </span>
        {live && location !== undefined && (
          <>
            <span aria-hidden className="text-input">·</span>
            <span className="min-w-0 truncate text-[12.5px] normal-case text-muted-foreground">
              {location}
            </span>
          </>
        )}
      </div>
      <h1
        className={cn(
          "font-serif leading-[1.2] font-semibold text-foreground",
          // Reading view: 24px below md (design/Grimoire-Mobil), 30px at md+.
          live ? "mb-1.5 text-[26px]" : "mb-3.5 text-[24px] md:text-[30px]",
        )}
      >
        {title}
      </h1>
      {isContingency &&
        trigger !== undefined &&
        (live ? (
          <p className="mb-1 text-[13px] text-soft italic">Wenn: {trigger}</p>
        ) : (
          <div className="mb-3 flex items-baseline gap-2 text-[13.5px]">
            <span className="text-muted-foreground">Auslöser</span>
            <span className="text-soft italic">{trigger}</span>
          </div>
        ))}
      {live ? (
        <div aria-hidden className="mt-4 mb-2.5 border-b border-border" />
      ) : (
        (location !== undefined || tags.length > 0 || handouts.length > 0) && (
          <div className="mb-7 flex flex-wrap items-center gap-2 border-b border-border pb-5">
            {location !== undefined && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[12.5px] text-body-secondary">
                <MapPin aria-hidden size={13} className="flex-none text-muted-foreground" />
                {location}
              </span>
            )}
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border bg-card px-3 py-1 text-[12.5px] text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
            {handouts.map((handout) => (
              <span
                key={handout}
                className="rounded-full border border-dashed border-input px-3 py-1 text-[12.5px] text-body-secondary"
              >
                Handout: {handout}
              </span>
            ))}
          </div>
        )
      )}
      <Markdown>{file.body}</Markdown>
    </article>
  );
}
