// The scene article — type overline, serif title, trigger line, markdown
// body through the pipeline. Shared between the reading view ("scene") and
// the live center column ("live"); live is the denser variant from the
// design prototype: 26px title, location inside the overline, italic trigger
// line and a plain hairline instead of the chip row.
//
// The live column also starts the text's `## If:` branches COLLAPSED: at the
// table the DM opens the one case that happens, and a scene whose branches
// are all unfolded scrolls the next information out of reach. Reading and
// editing keep them open.
//
// `statusControl` is the status control of the reading view; it rides at the
// right end of the overline row. `actions` — the edit and augment triggers —
// sits quietly to its left. The component stays free of queries —
// the route owns both and passes them in, so the live view simply passes
// nothing.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { Scene } from "@grimoire/shared/scene";
import { Bookmark, GitFork, MapPin } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@/i18n";
import { locationName } from "@/lib/campaign";
import { cn } from "@/lib/utils";
import { Markdown } from "@/markdown/Markdown";

export function SceneArticle({
  scene,
  tree,
  variant,
  statusControl,
  actions,
}: {
  scene: Scene;
  tree: CampaignTree | undefined;
  variant: "scene" | "live";
  statusControl?: ReactNode;
  actions?: ReactNode;
}) {
  const t = useT();
  const live = variant === "live";
  // A scene without a title of its own shows its id.
  const title = scene.title === "" ? scene.id : scene.title;
  const isContingency = scene.type === "contingency";
  const trigger = scene.trigger === "" ? undefined : scene.trigger;
  const location = locationName(tree, scene.location);
  const { tags, handouts } = scene;

  return (
    <article className="w-full min-w-0">
      <div className={cn("flex flex-wrap items-center gap-2.5", live ? "mb-2" : "mb-2.5")}>
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
          {isContingency ? t("sceneArticle.type.contingency") : t("sceneArticle.type.planned")}
        </span>
        {live && location !== undefined && (
          <>
            <span aria-hidden className="text-input">·</span>
            <span className="min-w-0 truncate text-[12.5px] normal-case text-muted-foreground">
              {location}
            </span>
          </>
        )}
        {(statusControl !== undefined || actions !== undefined) && (
          <>
            <span className="flex-1" />
            {/* One wrapping unit: three actions plus the status control need
                a second row below md instead of being squeezed off the
                edge. */}
            <span className="flex flex-wrap items-center justify-end gap-2">
              {actions}
              {statusControl}
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
          <p className="mb-1 text-[13px] text-soft italic">
            {t("sceneArticle.trigger.inline", { trigger })}
          </p>
        ) : (
          <div className="mb-3 flex items-baseline gap-2 text-[13.5px]">
            <span className="text-muted-foreground">{t("sceneArticle.trigger.label")}</span>
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
                {t("sceneArticle.tag", { tag })}
              </span>
            ))}
            {handouts.map((handout) => (
              <span
                key={handout}
                className="rounded-full border border-dashed border-input px-3 py-1 text-[12.5px] text-body-secondary"
              >
                {t("sceneArticle.handout", { handout })}
              </span>
            ))}
          </div>
        )
      )}
      <Markdown ifSections={live ? "collapsed" : "open"}>{scene.body}</Markdown>
    </article>
  );
}
