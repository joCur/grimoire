// The chapter-status control in the chapter overview: the status DISPLAY is
// the control, exactly like the scene's (components/SceneStatusMenu) — same
// markup (components/StatusMenu), same aria wording, same quiet inline
// message. What differs is the write behind it, and that is the whole reason
// this module exists:
//
//   `planned` / `done`   a properties write on the chapter entry, rev-guarded
//                        like every other properties write.
//   `active`             POST /chapters/:id/active — ONE call for ONE decision
//                        about TWO chapters, so the campaign never has two
//                        active ones.
//
// The rev for the patch branch comes from the chapter ENTRY, and the
// overview's tree carries none — so it is fetched LAZILY when the control
// opens (one GET, shared with the entry query cache), the same trick the
// overview's scene rows use. `active` needs no rev at all and stays available
// even if that read fails.
//
// MOBILE IS READ-ONLY, and it comes for free: below md the route renders the
// mobile start surface instead of the overview, so this control is not on the
// phone at all.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchEntry } from "@/api";
import { StatusMenu } from "@/components/StatusMenu";
import { useT } from "@/i18n";
import { chapterMetaPath } from "@/lib/chapter-meta";
import { chapterStatusMeta, chapterStatusOptions, chapterStatusValue } from "@/lib/chapter-status";
import { useChapterStatusMutation } from "@/lib/use-chapter-status";

export function ChapterStatusControl({
  campaign,
  chapter,
  status,
}: {
  campaign: string;
  chapter: string;
  /** The status as the tree carries it — unknown values pass through. */
  status: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const path = chapterMetaPath(chapter);
  const entry = useQuery({
    queryKey: ["entry", campaign, path],
    queryFn: () => fetchEntry(campaign, path),
    enabled: open && campaign !== "" && chapter !== "",
    retry: false,
  });
  const shown = chapterStatusValue(status);
  const { setStatus, pendingStatus, message } = useChapterStatusMutation(
    campaign,
    chapter,
    entry.data?.rev,
    shown,
  );

  return (
    <ChapterStatusMenu
      status={shown}
      pendingStatus={pendingStatus}
      message={message}
      open={open}
      onOpenChange={setOpen}
      onSelect={setStatus}
    />
  );
}

/**
 * The presentation: the pill plus the three options with the current one
 * checked. Pure (no queries, no mutation) so it can be render-tested.
 */
export function ChapterStatusMenu({
  status,
  pendingStatus,
  message,
  disabled = false,
  open,
  onOpenChange,
  onSelect,
}: {
  status: string;
  pendingStatus?: string | undefined;
  message?: string | undefined;
  disabled?: boolean;
  open?: boolean | undefined;
  onOpenChange?: (open: boolean) => void;
  onSelect: (status: string) => void;
}) {
  const t = useT();
  return (
    <StatusMenu
      status={status}
      pendingStatus={pendingStatus}
      options={chapterStatusOptions(t)}
      meta={(value) => chapterStatusMeta(value, t)}
      ariaLabel={t("status.change.aria", { current: chapterStatusMeta(status, t).label })}
      variant="pill"
      message={message}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      onSelect={onSelect}
    />
  );
}
