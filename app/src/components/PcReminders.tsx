// „Für die Spieler" — the live aside's reminder list (issue #86).
//
// The open `#pc` entries of log and inbox, grouped by character, as a
// compact checkable list. It reads the SAME model the wrap-up page and the
// topbar counter read (lib/use-review) and does the same two writes: a log
// line gets its `reviewed` hash, an inbox line its `- [x]`. Nothing is
// adopted here — a PC note is a reminder for the table, not campaign content.
//
// The list renders only when there is something to remind of: an empty
// heading in the aside would cost the space the log needs. Once the LAST
// reminder is ticked off, the region does not simply vanish — the focus would
// fall to the body — it becomes a focusable "Alles erledigt" line that takes
// the focus over.

import type { EntryResponse } from "@grimoire/shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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
  // Was something ticked off HERE? Then the emptied region stays as the
  // done-line instead of unmounting under the keyboard focus.
  const [cleared, setCleared] = useState(false);

  const done = useMutation({
    mutationFn: (entry: ReviewEntry): Promise<EntryResponse> => {
      if (entry.source === "inbox") return markInboxLineDone(campaign, entry.rawLine);
      if (model.sessionPath === "") throw new Error("keine Session");
      return markLogLineSeen(campaign, model.sessionPath, entry.rawLine);
    },
    onSuccess: (file) => {
      setCleared(true);
      queryClient.setQueryData(["file", campaign, file.path], file);
      void queryClient.invalidateQueries({ queryKey: ["file", campaign, file.path] });
      // The done-state of a log line lives in the session's properties
      // — both session queries have to see the fresh one.
      void queryClient.invalidateQueries({ queryKey: activeSessionKey(campaign) });
      void queryClient.invalidateQueries({ queryKey: lastStartedSessionKey(campaign) });
    },
  });

  if (groups.length === 0) return cleared ? <PcRemindersDone /> : null;

  return (
    <section aria-labelledby="pc-reminders-heading">
      <h2
        id="pc-reminders-heading"
        className="pb-2 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground"
      >
        {t("live.pc.heading")}
      </h2>
      <div className="flex flex-col gap-2.5">
        {groups.map((group) => (
          <div key={group.tag ?? ""}>
            <h3 className="pb-1 font-mono text-[11.5px] text-primary-hover">
              {group.tag === undefined
                ? t("review.pc.groupGeneral")
                : t("review.pc.groupTag", { tag: group.tag })}
            </h3>
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

/** What is left of the region when the last reminder is ticked off: one line
 *  that TAKES the focus, so tabbing on does not start over at the body. */
function PcRemindersDone() {
  const t = useT();
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    line.current?.focus();
  }, []);
  return (
    <section aria-labelledby="pc-reminders-heading">
      <h2
        id="pc-reminders-heading"
        className="pb-2 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground"
      >
        {t("live.pc.heading")}
      </h2>
      <p
        ref={line}
        tabIndex={-1}
        aria-live="polite"
        className="rounded-md text-[12.5px] leading-[1.5] text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t("live.pc.allDone")}
      </p>
    </section>
  );
}
