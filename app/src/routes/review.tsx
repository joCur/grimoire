// "/:campaign/review" — the review view ("Fünf Minuten Ernte", issue #10)
// per the design reference: the tagged lines of today's log and of the inbox
// as cards with one-click actions, the chapter's open threads below, brass
// "Fertig" at the end. Reached after "Session beenden" and from the quiet
// pool affordance.
//
// The server files are the truth: every action writes through the review
// endpoints, the returned FileResponse is seeded into the cache and the
// query invalidated on top. The ONLY client state is cosmetic — which action
// a card got in this sitting (the server stores done/not-done, not which
// action) and which threads were adopted here (the "neu" chip).
// Mobile: the desk task stays usable — one column, stacked cards.

import type { FileResponse } from "@grimoire/shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  ApiError,
  adoptThread,
  createNpcStub,
  fetchFile,
  fetchTree,
  markInboxLineDone,
  markLogLineSeen,
} from "@/api";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NpcStubDialog } from "@/components/NpcStubDialog";
import { Button } from "@/components/ui/button";
import { parseChecklist } from "@/lib/review";
import type { ReviewActionKind } from "@/lib/review-memory";
import { useActedKeys, useReviewMemory } from "@/lib/review-memory";
import { cn } from "@/lib/utils";
import type { ReviewEntry } from "@/lib/use-review";
import { useReviewEntries } from "@/lib/use-review";

type ActionKind = ReviewActionKind;

interface ActVars {
  entry: ReviewEntry;
  action: ActionKind;
  npc?: { id: string; name?: string };
}

const THREADS_HEADING = "Offene Fäden";

function doneLabel(action: ActionKind | undefined): string {
  switch (action) {
    case "thread":
      return "Als Faden übernommen";
    case "npc":
      return "NPC-Stub angelegt";
    case "dismiss":
      return "Verworfen";
    default:
      // The server only stores done/not-done — after a reload the specific
      // action is gone and the neutral label is the honest one.
      return "gesichtet";
  }
}

export function ReviewRoute() {
  const { campaign = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Cosmetic client memory (never persisted — the server is the truth).
  const { adopted, remember } = useReviewMemory();
  const acted = useActedKeys(campaign);
  const adoptedHere = adopted[campaign] ?? [];
  const [npcEntry, setNpcEntry] = useState<ReviewEntry>();

  const model = useReviewEntries(campaign);

  // The active chapter (fallback: the first) — the same rule as the live nav.
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  const chapters = tree.data?.chapters ?? [];
  const chapter = chapters.find((ch) => ch.status === "active") ?? chapters[0];
  const chapterPath = chapter?.path;

  const chapterFile = useQuery({
    queryKey: ["file", campaign, chapterPath],
    queryFn: () => fetchFile(campaign, chapterPath as string),
    enabled: chapterPath !== undefined,
    retry: false,
  });
  const threads = useMemo(
    () => parseChecklist(chapterFile.data?.body ?? "", THREADS_HEADING),
    [chapterFile.data?.body],
  );

  const act = useMutation({
    mutationFn: async ({ entry, action, npc }: ActVars): Promise<FileResponse[]> => {
      const written: FileResponse[] = [];
      if (action === "thread") {
        if (chapter === undefined) throw new Error("kein Kapitel");
        written.push(await adoptThread(campaign, chapter.id, entry.text));
      } else if (action === "npc") {
        if (npc === undefined) throw new Error("keine id");
        written.push(await createNpcStub(campaign, npc.id, npc.name, entry.text));
      }
      // Only after the harvest succeeded is the source marked done.
      if (entry.source === "log") {
        // The path comes from the server (the last started session — which
        // may be yesterday's file). Without it there is nothing to patch.
        if (model.sessionPath === "") throw new Error("keine Session");
        written.push(await markLogLineSeen(campaign, model.sessionPath, entry.rawLine));
      } else {
        written.push(await markInboxLineDone(campaign, entry.rawLine));
      }
      return written;
    },
    onSuccess: (files, vars) => {
      // Every endpoint returns the fresh file: seed, then invalidate on top.
      for (const file of files) {
        queryClient.setQueryData(["file", campaign, file.path], file);
        void queryClient.invalidateQueries({ queryKey: ["file", campaign, file.path] });
      }
      // A new thread section or npc file can change the tree, too.
      if (vars.action !== "dismiss") {
        void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
      }
      remember(
        campaign,
        vars.entry.key,
        vars.action,
        vars.action === "thread" ? vars.entry.text : undefined,
      );
      if (vars.action === "npc") setNpcEntry(undefined);
    },
  });

  const busyKey = act.isPending ? act.variables?.entry.key : undefined;
  const npcError =
    act.isError && act.variables?.action === "npc"
      ? act.error instanceof ApiError && act.error.status === 409
        ? `npcs/${act.variables.npc?.id ?? ""}.md existiert schon`
        : "NPC-Stub nicht angelegt — Server prüfen."
      : undefined;
  const cardError = (entry: ReviewEntry) =>
    act.isError && act.variables?.action !== "npc" && act.variables?.entry.key === entry.key
      ? "Aktion nicht gespeichert — Server prüfen."
      : undefined;

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[680px] px-5 pt-8 pb-24 md:px-7 md:pt-10 md:pb-[100px]">
        <h1 className="mb-2 font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
          Fünf Minuten Ernte
        </h1>

        {model.isError ? (
          <p className="text-[14px] text-muted-foreground">
            Session nicht ladbar — Server prüfen und neu laden.
          </p>
        ) : model.noSession ? (
          <p className="text-[14px] leading-[1.6] text-muted-foreground">
            Es gibt keine Session zum Sichten.{" "}
            <Link to={`/${campaign}`} className="text-primary hover:text-primary-hover">
              Zurück zum Pool
            </Link>
          </p>
        ) : (
          <>
            <p className="mb-2 text-[14px] leading-[1.6] text-body-secondary md:mb-8">
              Einträge mit #thread und #npc aus Log und Inbox. Übernehmen, anlegen oder
              verwerfen — der Rest bleibt im Log.
            </p>
            {/* The topbar carries the progress on the desktop; below md it is
                hidden, so the count lives in the page there. */}
            <p className="mb-8 text-[13px] text-muted-foreground md:hidden">
              {model.progressLabel}
            </p>

            {model.hashUnavailable && (
              <p className="mb-6 text-[12.5px] text-muted-foreground">
                Gesichtet-Status der Log-Zeilen nicht verfügbar — Grimoire über localhost oder
                https öffnen.
              </p>
            )}

            {model.isPending ? (
              <p className="text-[14px] text-muted-foreground">Lade Einträge …</p>
            ) : model.total === 0 ? (
              <p className="rounded-lg border border-dashed border-input px-8 py-8 text-center text-[14px] text-muted-foreground">
                Keine markierten Einträge in dieser Session — nichts zu sichten.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {model.entries.map((entry) => (
                  <EntryCard
                    key={entry.key}
                    entry={entry}
                    action={acted.get(entry.key)}
                    busy={busyKey === entry.key}
                    error={cardError(entry)}
                    canAdopt={chapter !== undefined}
                    onThread={() => {
                      act.reset();
                      act.mutate({ entry, action: "thread" });
                    }}
                    onNpc={() => {
                      act.reset();
                      setNpcEntry(entry);
                    }}
                    onDismiss={() => {
                      act.reset();
                      act.mutate({ entry, action: "dismiss" });
                    }}
                  />
                ))}
              </div>
            )}

            <section className="mt-9 border-t border-border pt-5">
              <h2 className="mb-3 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
                Offene Fäden des Kapitels
              </h2>
              {threads.length === 0 ? (
                <p className="text-[13.5px] text-muted-foreground">
                  Noch keine offenen Fäden in diesem Kapitel.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {threads.map((thread, index) => (
                    <li
                      key={`${index}-${thread.text}`}
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
                      {adoptedHere.includes(thread.text) && (
                        <span className="flex-none rounded-[4px] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-[7px] py-px text-[11px] text-primary-hover">
                          neu
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Button
              type="button"
              onClick={() => void navigate(`/${campaign}`)}
              className="mt-9 h-auto px-[18px] py-2.5 text-[13.5px] font-semibold"
            >
              Fertig — zurück zum Pool
            </Button>
          </>
        )}
      </div>

      {npcEntry !== undefined && (
        <NpcStubDialog
          key={npcEntry.key}
          entry={npcEntry}
          pending={act.isPending}
          error={npcError}
          onClose={() => {
            act.reset();
            setNpcEntry(undefined);
          }}
          onSubmit={(npc) => {
            act.reset();
            act.mutate({ entry: npcEntry, action: "npc", npc });
          }}
        />
      )}
    </>
  );
}

/** One harvest card per the prototype: source · mono time · mono tag chip,
 *  the text, then the action row — or the dimmed done row. */
function EntryCard({
  entry,
  action,
  busy,
  error,
  canAdopt,
  onThread,
  onNpc,
  onDismiss,
}: {
  entry: ReviewEntry;
  action: ActionKind | undefined;
  busy: boolean;
  error: string | undefined;
  canAdopt: boolean;
  onThread: () => void;
  onNpc: () => void;
  onDismiss: () => void;
}) {
  const label = doneLabel(action);
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3.5",
        entry.done && "opacity-55",
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-muted-foreground">{entry.sourceLabel}</span>
        {entry.meta !== undefined && <span className="font-mono text-faint">{entry.meta}</span>}
        {entry.tag !== "" && (
          <span className="rounded-[4px] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-[7px] py-px font-mono text-[11.5px] text-primary-hover">
            #{entry.tag}
          </span>
        )}
      </div>
      <p className="mb-2.5 text-[14px] leading-[1.55] text-foreground">{entry.text}</p>

      {entry.done ? (
        <p
          className={cn(
            "flex items-center gap-[7px] text-[12.5px]",
            action === undefined || action === "dismiss"
              ? "text-muted-foreground"
              : "text-success-text",
          )}
        >
          <Check aria-hidden size={13} className="flex-none" />
          {label}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {entry.canThread && canAdopt && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onThread}
                className="h-auto rounded-md border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-3 py-1.5 text-[12.5px] font-normal text-primary-hover hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] hover:text-primary-hover"
              >
                Als Faden übernehmen
              </Button>
            )}
            {entry.canNpc && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onNpc}
                className="h-auto rounded-md border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-3 py-1.5 text-[12.5px] font-normal text-primary-hover hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] hover:text-primary-hover"
              >
                NPC-Stub anlegen
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onDismiss}
              className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              Verwerfen
            </Button>
          </div>
          {error !== undefined && (
            <p className="mt-2 text-[12px] text-destructive" aria-live="polite">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
