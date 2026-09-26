// The live aside's reminder list.
//
// The open `#pc` entries of the session's log and of the ideas, grouped by
// character, as a compact checkable list. It joins two entities — the session
// and the idea — so it sits with the page that composes them, not in either
// slice. It reads the SAME model the wrap-up page and the topbar counter read
// (lib/use-review) and does the same two writes: a log entry is marked
// reviewed, an idea ticked off, each against its own guard. Nothing is
// adopted here — a PC note is a reminder for the table, not campaign content.
//
// The list renders only when there is something to remind of: an empty
// heading in the aside would cost the space the log needs. Once the LAST
// reminder is ticked off, the region does not simply vanish — the focus would
// fall to the body — it becomes a focusable "Alles erledigt" line that takes
// the focus over.

import type { Idea } from "@grimoire/shared/idea";
import type { LogEntry } from "@grimoire/shared/log-entry";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useT } from "@/i18n";
import { tickIdea } from "@/idea/idea-api";
import { ideasKey, withIdea } from "@/idea/idea-query";
import { tickFailureKey } from "@/idea/idea-tick";
import { isWriteConflict } from "@/lib/write-with-rev";
import type { ReviewEntry } from "@/lib/use-review";
import { pcGroups, useReviewEntries } from "@/lib/use-review";
import { reviewLogEntry } from "@/session/log-entry-api";
import { reviewFailureKey } from "@/session/log-entry-review";
import { putLogEntry, sessionScopeKey } from "@/session/session-query";

export function PcReminders({ campaign }: { campaign: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const model = useReviewEntries(campaign);
  const groups = pcGroups(model.entries.filter((entry) => !entry.done));
  // Was something ticked off HERE? Then the emptied region stays as the
  // done-line instead of unmounting under the keyboard focus.
  const [cleared, setCleared] = useState(false);

  const done = useMutation({
    mutationFn: async (entry: ReviewEntry): Promise<{ idea?: Idea; logEntry?: LogEntry }> => {
      if (entry.idea !== undefined) return { idea: await tickIdea(campaign, entry.idea) };
      if (entry.logEntry === undefined || model.sessionId === "") {
        throw new Error("no log entry to review");
      }
      return { logEntry: await reviewLogEntry(campaign, model.sessionId, entry.logEntry) };
    },
    onSuccess: ({ idea, logEntry }) => {
      setCleared(true);
      // The done-state of a log entry lives in its session, an idea's on the
      // idea — the answer is the fresh row either way.
      if (logEntry !== undefined) putLogEntry(queryClient, campaign, model.sessionId, logEntry);
      if (idea !== undefined) {
        queryClient.setQueryData<Idea[]>(ideasKey(campaign), (list) => withIdea(list, idea));
      }
    },
    onError: (error, entry) => {
      // The row moved since it was read: read it again, so the next tick
      // carries its current guard.
      if (!isWriteConflict(error)) return;
      void queryClient.invalidateQueries({
        queryKey: entry.idea !== undefined ? ideasKey(campaign) : sessionScopeKey(campaign),
      });
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
          {t(
            done.variables?.logEntry !== undefined
              ? reviewFailureKey(done.error, "live.pc.failed")
              : tickFailureKey(done.error, "live.pc.failed"),
          )}
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
