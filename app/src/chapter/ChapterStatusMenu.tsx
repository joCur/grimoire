// The chapter-status control in the chapter overview: the status DISPLAY is
// the control, exactly like the scene's (scene/SceneStatusMenu) — same markup
// (components/StatusMenu), same aria wording, same quiet inline message.
//
// Every value is one PATCH of the chapter, `active` included: the server puts
// the chapter that held it back to `planned` in the same transaction
// (./chapter-status.ts). The write needs the rev of the chapter, and the
// overview's tree carries none — so the control fetches the chapter LAZILY
// when the menu opens, one GET shared with the chapter's query cache. A stale
// rev is reported inline and the chapter is read again: the control has no
// conflict actions, the next pick carries the fresh version.
//
// MOBILE IS READ-ONLY, and it comes for free: below md the route renders the
// mobile start surface instead of the overview, so this control is not on the
// phone at all.

import type { ChapterStatus } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { StatusMenu } from "@/components/StatusMenu";
import { useT } from "@/i18n";

import { chapterQuery } from "./chapter-query";
import { chapterStatusMeta, chapterStatusOptions, chapterStatusValue } from "./chapter-status";
import { useChapterStatusMutation } from "./use-chapter-status";

export function ChapterStatusControl({
  campaign,
  id,
  status,
}: {
  campaign: string;
  id: string;
  /** The status as the tree carries it; absent reads as `planned`. */
  status: ChapterStatus | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Only ever requested once the menu opens, and served from the cache when
  // the chapter was read before (its text in the overview reads it too).
  const chapter = useQuery({
    ...chapterQuery(campaign, id),
    enabled: open && campaign !== "" && id !== "",
    retry: false,
  });
  const { setStatus, pendingStatus, message } = useChapterStatusMutation(
    campaign,
    id,
    chapter.data?.rev,
  );

  return (
    <ChapterStatusMenu
      status={chapterStatusValue(status)}
      pendingStatus={pendingStatus}
      // A chapter that could not be read at all cannot be written — the
      // display stays, the menu just does nothing.
      disabled={chapter.isError}
      message={message ?? (chapter.isError ? t("status.chapterUnloadable") : undefined)}
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
  status: ChapterStatus;
  pendingStatus?: ChapterStatus | undefined;
  message?: string | undefined;
  disabled?: boolean;
  open?: boolean | undefined;
  onOpenChange?: (open: boolean) => void;
  onSelect: (status: ChapterStatus) => void;
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
