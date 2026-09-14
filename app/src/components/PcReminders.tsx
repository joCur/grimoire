// „Für die Spieler" — the live aside's reminder list (issue #86).
//
// The open `#pc` entries of log and inbox, grouped by character, as a
// compact checkable list. It reads the SAME model the wrap-up page and the
// topbar counter read (lib/use-review) and does the same two writes: a log
// line gets its `reviewed` hash, an inbox line its `- [x]`. Nothing is
// adopted here — a PC note is a reminder for the table, not campaign content.
//
// The list renders only when there is something to remind of: an empty
// heading in the aside would cost the space the log needs.

import type { FileResponse } from "@grimoire/shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { markInboxLineDone, markLogLineSeen } from "@/api";
import { useT } from "@/i18n";
import type { ReviewEntry } from "@/lib/use-review";
import { pcGroups, useReviewEntries } from "@/lib/use-review";
import { activeSessionKey, lastStartedSessionKey } from "@/lib/use-session";

export function PcReminders({ campaign }: { campaign: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const model = useReviewEntries(campaign);
  const groups = pcGroups(model.entries.filter((entry) => !entry.done));

  const done = useMutation({
    mutationFn: (entry: ReviewEntry): Promise<FileResponse> => {
      if (entry.source === "inbox") return markInboxLineDone(campaign, entry.rawLine);
      if (model.sessionPath === "") throw new Error("keine Session");
      return markLogLineSeen(campaign, model.sessionPath, entry.rawLine);
    },
    onSuccess: (file) => {
      queryClient.setQueryData(["file", campaign, file.path], file);
      void queryClient.invalidateQueries({ queryKey: ["file", campaign, file.path] });
      // The done-state of a log line lives in the session file's frontmatter
      // — both session queries have to see the fresh one.
      void queryClient.invalidateQueries({ queryKey: activeSessionKey(campaign) });
      void queryClient.invalidateQueries({ queryKey: lastStartedSessionKey(campaign) });
    },
  });

  if (groups.length === 0) return null;

  return (
    <section aria-label={t("live.pc.heading")}>
      <p className="pb-2 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
        {t("live.pc.heading")}
      </p>
      <div className="flex flex-col gap-2.5">
        {groups.map((group) => (
          <div key={group.tag ?? ""}>
            <p className="pb-1 font-mono text-[11.5px] text-primary-hover">
              {group.tag === undefined
                ? t("review.pc.groupGeneral")
                : t("review.pc.groupTag", { tag: group.tag })}
            </p>
            <ul className="flex flex-col gap-1">
              {group.entries.map((entry) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    disabled={done.isPending}
                    aria-label={t("live.pc.done", { text: entry.text })}
                    onClick={() => {
                      done.reset();
                      done.mutate(entry);
                    }}
                    className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left text-[12.5px] leading-[1.5] text-body hover:bg-divider hover:text-foreground"
                  >
                    <span
                      aria-hidden
                      className="mt-[3px] size-3.5 flex-none rounded-[4px] border-[1.5px] border-muted-foreground"
                    />
                    <span className="min-w-0">{entry.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {done.isError && (
        <p className="pt-1.5 text-[11.5px] text-destructive" aria-live="polite">
          {t("live.pc.failed")}
        </p>
      )}
    </section>
  );
}
