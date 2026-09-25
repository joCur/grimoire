// The threads of one chapter as the review shows them: a quiet read-only
// list under the harvest, with a „neu" note on each thread adopted in this
// sitting. Where they are kept — ticked, reworded, deleted — is the chapter
// overview (./ThreadList.tsx).

import { Check } from "lucide-react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { useThreads } from "./use-thread-writes";

export function ThreadSummary({
  campaign,
  chapter,
  adopted,
}: {
  campaign: string;
  /** The chapter whose threads are shown; nothing while there is none. */
  chapter: string | undefined;
  /** Ids of the threads adopted in this sitting. */
  adopted: readonly string[];
}) {
  const t = useT();
  const threads = useThreads(campaign, chapter).data;

  if (threads === undefined) return null;
  if (threads.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">{t("review.threads.empty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {threads.map((thread) => (
        <li
          key={thread.id}
          className={cn(
            "flex items-center gap-2.5 text-[14px] text-body",
            thread.done && "text-muted-foreground",
          )}
        >
          {thread.done ? (
            <Check aria-hidden size={14} className="flex-none text-success-text" />
          ) : (
            <span
              aria-hidden
              className="size-3.5 flex-none rounded-[4px] border-[1.5px] border-muted-foreground"
            />
          )}
          <span>{thread.text}</span>
          {adopted.includes(thread.id) && (
            <span className="flex-none rounded-[4px] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-[7px] py-px text-[11px] text-primary-hover">
              {t("review.threads.new")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
