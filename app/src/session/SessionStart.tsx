// The live mode's quiet state while nothing is running — and the ONE place a
// start conflict becomes a question the DM can answer.
//
// Exactly ONE conflict is a question here: `session_running`, an OLDER
// session that was never ended — ending someone else's evening is not implied
// by "starten". An already ended session of today is no question at all: the
// start opens the NEXT session of the day, so there is no "fortsetzen" here
// either.

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

import { useOlderSessionEnd, useSessionStartFlow } from "./use-session";

export function SessionStart({ campaign }: { campaign: string }) {
  const t = useT();
  const { enter, entering, conflict, conflictSessionId, failed } = useSessionStartFlow(campaign);
  const end = useOlderSessionEnd(campaign);
  const busy = entering || end.isPending;
  return (
    <div className="flex h-full items-center justify-center px-7">
      <div className="max-w-[380px] text-center">
        {conflict === "session_running" && conflictSessionId !== undefined ? (
          <>
            <p className="mb-4 text-[14px] leading-[1.6] text-muted-foreground">
              {t("live.session.olderRunning.withSession", { session: conflictSessionId })}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => end.mutate(conflictSessionId)}
              className="h-auto px-4 py-2 text-[13px]"
            >
              {t("live.session.endOld")}
            </Button>
          </>
        ) : conflict === "session_running" ? (
          <p className="mb-4 text-[14px] leading-[1.6] text-muted-foreground">
            {t("live.session.olderRunning")}
          </p>
        ) : (
          <>
            <p className="mb-4 text-[14px] text-muted-foreground">{t("live.session.none")}</p>
            <Button
              type="button"
              disabled={busy}
              onClick={() => enter()}
              className="h-auto px-4 py-2 text-[13px] font-semibold"
            >
              {t("session.start")}
            </Button>
          </>
        )}
        {(failed || end.isError) && (
          <p className="mt-3 text-[12.5px] text-destructive">{t("session.write.failed")}</p>
        )}
      </div>
    </div>
  );
}
