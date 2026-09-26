// The chapter's own action in the chapter overview: edit, which opens the
// chapter's reading view in its edit mode (./ChapterEditMode.tsx) — title,
// status and text are edited there, in one place, with one save. The overview
// is a list, it does not turn into an editing surface.
//
// Setting the active chapter is NOT a second action here: the status control
// in the chapter's heading row (./ChapterStatusMenu) already offers it, and
// two controls for one value is how they end up disagreeing about it.
//
// MOBILE IS READ-ONLY in the overview, and it comes for free: below md the
// route renders the mobile start surface instead of the overview, so this
// action is not on the phone at all.

import { PenLine } from "lucide-react";
import { useNavigate } from "react-router";

import { HeaderAction } from "@/components/HeaderAction";
import { useT } from "@/i18n";

import { chapterHref } from "./chapter-links";

export function ChapterOverviewActions({ campaign, id }: { campaign: string; id: string }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {/* The label names the chapter rather than only the kind of action: the
          overview header carries its own edit action for the campaign, so the
          bare word would be ambiguous — for a screen reader, and for anyone
          counting Tab stops down the list. */}
      <HeaderAction
        icon={PenLine}
        label={t("chapterOverview.chapter.edit")}
        onClick={() => void navigate(`${chapterHref(campaign, id)}?edit=1`)}
      />
    </div>
  );
}
