// The random tables page with what a rolled result becomes: a log line of
// the running session, or an idea when none runs. It joins the random-table
// slice with the session and the idea slices, so it sits with the page that
// composes them.
//
// A result is taken once per roll: the action turns into a quiet sentence
// saying where it went, and the next roll offers it again.

import type { Idea } from "@grimoire/shared/idea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { createIdea } from "@/idea/idea-api";
import { ideasKey, withIdea } from "@/idea/idea-query";
import { cn } from "@/lib/utils";
import { RandomTablesPage, type RolledResult } from "@/random-table/RandomTablesPage";
import { createLogEntry } from "@/session/log-entry-api";
import { putLogEntry, runningSessionQuery } from "@/session/session-query";

export function RandomTablesRoute() {
  return <RandomTablesPage resultActions={(result) => <TakeResult result={result} />} />;
}

function TakeResult({ result }: { result: RolledResult }) {
  const { campaign = "" } = useParams();
  const t = useT();
  const queryClient = useQueryClient();
  const running = useQuery(runningSessionQuery(campaign));
  const session = running.data ?? null;

  const take = useMutation({
    mutationFn: async (): Promise<"log" | "idea"> => {
      if (session !== null) {
        const entry = await createLogEntry(campaign, session.id, { text: result.line });
        putLogEntry(queryClient, campaign, session.id, entry);
        return "log";
      }
      const idea = await createIdea(campaign, result.line);
      queryClient.setQueryData<Idea[]>(ideasKey(campaign), (list) => withIdea(list, idea));
      return "idea";
    },
    onError: () =>
      void queryClient.invalidateQueries({ queryKey: runningSessionQuery(campaign).queryKey }),
  });

  if (running.isPending) return null;
  if (take.isSuccess) {
    return (
      <p className="text-[12.5px] text-success-text" data-testid="random-table-taken">
        {t(take.data === "log" ? "randomTables.take.loggedDone" : "randomTables.take.ideaDone")}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={take.isPending}
        onClick={() => take.mutate()}
        data-testid="random-table-take"
      >
        {t(session !== null ? "randomTables.take.log" : "randomTables.take.idea")}
      </Button>
      <p
        className={cn(
          "min-w-0 flex-1 text-[12.5px]",
          take.isError ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {take.isError ? t("randomTables.take.failed") : ""}
      </p>
    </div>
  );
}
