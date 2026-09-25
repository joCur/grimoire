// One chapter of the chapter overview: an accordion whose heading row carries
// the title, the scene count and the status control, and whose content
// carries the chapter's own actions and text — read lazily on first expand —
// followed by what the chapter holds.
//
// What it holds is not this slice's to draw: the open threads and the scene
// list are handed in (`threads`, `scenes`), so the chapter never reaches into
// another entity's slice. The overview composes them.

import type { ChapterNode } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ClampedText } from "@/components/ClampedText";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useT } from "@/i18n";

import { ChapterOverviewActions } from "./ChapterActions";
import { chapterQuery } from "./chapter-query";
import { ChapterStatusControl } from "./ChapterStatusMenu";

export function ChapterSection({
  campaign,
  chapter,
  defaultOpen,
  threads,
  scenes,
}: {
  campaign: string;
  /** The chapter as the tree carries it — title, status, its scenes. */
  chapter: ChapterNode;
  defaultOpen: boolean;
  /** The chapter's open threads, under its text. */
  threads: ReactNode;
  /** The chapter's scenes, below the threads. */
  scenes: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  // The chapter's text and rev — read lazily on first expand; a chapter that
  // cannot be read simply shows no text and no actions.
  const read = useQuery({
    ...chapterQuery(campaign, chapter.id),
    enabled: open,
    retry: false,
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-4">
      {/* ONE row, but not one button: the status control is a menu trigger,
          and a button inside a button is invalid markup. So the trigger covers
          the chevron, the heading and the scene count — the whole reading of
          the row — and the control sits BESIDE it in the same flex line with
          the shared bottom border. */}
      <div className="flex w-full items-center gap-2.5 border-b border-border pt-2.5 pb-3">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronDown
            aria-hidden
            size={15}
            className="flex-none -rotate-90 text-muted-foreground transition-transform group-data-[state=open]:rotate-0 motion-reduce:transition-none"
          />
          {/* The chapter names a section of the page, so it IS a heading —
              inside the trigger, which stays the button that opens it. */}
          <h2 className="min-w-0 truncate font-serif text-[18px] font-semibold text-foreground">
            {chapter.title}
          </h2>
          <span className="flex-1" />
          <span className="flex-none text-[12.5px] text-muted-foreground">
            {t("chapterOverview.sceneCount", { count: chapter.scenes.length })}
          </span>
        </CollapsibleTrigger>
        {/* The status is the control: every value is one write of this
            chapter, and picking the active one puts the chapter that held it
            back to planned. */}
        <ChapterStatusControl campaign={campaign} id={chapter.id} status={chapter.status} />
      </div>
      <CollapsibleContent>
        <div className="pt-4 pb-1 pl-[25px]">
          {/* The chapter's own actions. They sit INSIDE the accordion and not
              in the heading row: that row is already as wide as it gets, and
              the actions are for the chapter the DM has opened. */}
          <ChapterOverviewActions campaign={campaign} chapter={read.data} />
          {/* The whole text of the chapter, whatever it says and however it
              is structured — a few lines of it until the DM opens it. */}
          <ClampedText className="mb-3">{read.data?.body ?? ""}</ClampedText>
          {threads}
          {scenes}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
