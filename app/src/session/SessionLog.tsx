// The log panel of the live mode: the session's log (newest first) pinned
// above the Schnellnotiz — recessed panel, max ~46% of the aside. Nothing may
// ever overlay the note input.
//
// A note is a log entry of the running session, taken in the scene that is
// open (`sceneId`). It records nothing else: whether that scene counts as
// played is decided when the DM leaves it (./played-scene-rule.ts).

import type { Session } from "@grimoire/shared/session";
import { useState } from "react";

import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";

import { useLogEntryCreate } from "./use-session";

export function SessionLog({
  campaign,
  session,
  activeSceneId,
}: {
  campaign: string;
  session: Session;
  activeSceneId: string | undefined;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const rows = [...session.log].reverse();
  const append = useLogEntryCreate(campaign, session.id);

  const send = () => {
    const text = note.trim();
    if (text === "") return;
    // Clear immediately (the input keeps focus); a failed send restores the
    // text unless the DM already typed something new.
    setNote("");
    append.mutate(
      activeSceneId === undefined ? { text } : { text, sceneId: activeSceneId },
      { onError: () => setNote((current) => (current === "" ? text : current)) },
    );
  };

  return (
    <div className="flex flex-none flex-col border-t border-border bg-panel-deep lg:max-h-[46%]">
      <p className="px-4 pt-3.5 pb-2 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
        {t("live.log.heading")}
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-2.5">
        {rows.length === 0 && (
          <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
            {t("live.log.empty")}
          </p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="flex gap-2 text-[12.5px] leading-[1.5]">
            {row.at !== "" && (
              <span className="flex-none font-mono text-muted-foreground">{row.at}</span>
            )}
            <span className="min-w-0 text-body">{row.text}</span>
          </div>
        ))}
      </div>
      <div className="flex-none px-4 pt-1 pb-3.5">
        {append.isError && (
          <p className="mb-1.5 text-[11.5px] text-destructive" aria-live="polite">
            {serverErrorMessage(append.error, t, "live.note.failed")}
          </p>
        )}
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          placeholder={t("live.note.placeholder")}
          aria-label={t("live.note.aria")}
          className="w-full rounded-lg border border-input bg-card px-[13px] py-[11px] text-[13.5px] text-foreground placeholder:text-muted-foreground"
        />
        <p className="mt-[7px] text-[11.5px] text-faint">{t("live.note.hint")}</p>
      </div>
    </div>
  );
}
