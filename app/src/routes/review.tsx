// "/:campaign/review" — the review view, "Session-Nachbereitung" in the UI
// (issue #10; formerly "Fünf Minuten Ernte")
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
  adoptThread,
  ensureNpc,
  fetchFile,
  fetchTree,
  markInboxLineDone,
  markLogLineSeen,
} from "@/api";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NpcCreateDialog } from "@/components/NpcCreateDialog";
import { Button } from "@/components/ui/button";
import type { Translate } from "@/i18n";
import { useT } from "@/i18n";
import { parseChecklist } from "@/lib/review";
import type { ReviewActionKind } from "@/lib/review-memory";
import { useActedKeys, useReviewMemory } from "@/lib/review-memory";
import { cn } from "@/lib/utils";
import type { ReviewEntry } from "@/lib/use-review";
import { pcGroups, useReviewEntries } from "@/lib/use-review";
import { activeSessionKey, lastStartedSessionKey } from "@/lib/use-session";

type ActionKind = ReviewActionKind;

interface ActVars {
  entry: ReviewEntry;
  action: ActionKind;
  npc?: { id: string; name?: string };
}

/** The H2 the chapter's checklist lives under — a FORMAT token of the
 *  markdown body (README), not copy, so it stays German in every language. */
const THREADS_HEADING = "Offene Fäden";

function doneLabel(
  action: ActionKind | undefined,
  section: ReviewEntry["section"],
  t: Translate,
): string {
  switch (action) {
    case "thread":
      return t("review.done.thread");
    case "npc":
      return t("review.done.npc");
    case "dismiss":
      // An untagged note or a PC reminder is not "verworfen", it is done
      // with (issues #85, #86) — the write is the same, the word the DM sees
      // is not.
      return section === "harvest" ? t("review.done.dismiss") : t("review.done.resolved");
    default:
      // The server only stores done/not-done — after a reload the specific
      // action is gone and the neutral label is the honest one.
      return t("review.done.seen");
  }
}

export function ReviewRoute() {
  const { campaign = "" } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Cosmetic client memory (never persisted — the server is the truth).
  const { adopted, remember } = useReviewMemory();
  const acted = useActedKeys(campaign);
  const adoptedHere = adopted[campaign] ?? [];
  const [npcEntry, setNpcEntry] = useState<ReviewEntry>();
  // „Behalten" writes nothing: the entry stays open (and counted) for the next
  // wrap-up, the marker is cosmetic and lives for this sitting only.
  // Campaign-scoped like the rest of the review memory: the entry key is only
  // the line index in its file, so an unscoped set would carry a „Behalten"
  // over to the same index in the NEXT campaign (the route param changes
  // without remounting this component).
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set<string>());
  const keptKey = (entry: ReviewEntry) => `${campaign}:${entry.key}`;

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
        written.push(await ensureNpc(campaign, npc.id, npc.name, entry.text));
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
        // A log line's done-state lives in the session file's frontmatter, and
        // the live aside and the topbar read that file through the SESSION
        // queries — they have to see the fresh one too (same rule as
        // components/PcReminders).
        if (file.path === model.sessionPath) {
          void queryClient.invalidateQueries({ queryKey: activeSessionKey(campaign) });
          void queryClient.invalidateQueries({ queryKey: lastStartedSessionKey(campaign) });
        }
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
  // No 409 case any more (issue #70): an id that already has an entry is
  // LINKED, not refused, so the only thing left to report is a server that
  // did not answer.
  const npcError =
    act.isError && act.variables?.action === "npc" ? t("review.npc.failed") : undefined;
  const cardError = (entry: ReviewEntry) =>
    act.isError && act.variables?.action !== "npc" && act.variables?.entry.key === entry.key
      ? t("review.action.failed")
      : undefined;

  const harvest = model.entries.filter((entry) => entry.section === "harvest");
  const notes = model.entries.filter((entry) => entry.section === "notes");
  const pcs = pcGroups(model.entries);

  const renderCard = (entry: ReviewEntry) => (
    <EntryCard
      key={entry.key}
      entry={entry}
      action={acted.get(entry.key)}
      busy={busyKey === entry.key}
      error={cardError(entry)}
      canAdopt={chapter !== undefined}
      kept={kept.has(keptKey(entry))}
      onKeep={() =>
        setKept((current) => {
          const next = new Set(current);
          const key = keptKey(entry);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        })
      }
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
  );

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[680px] px-5 pt-8 pb-24 md:px-7 md:pt-10 md:pb-[100px]">
        <h1 className="mb-2 font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
          {t("review.title")}
        </h1>

        {model.isError ? (
          <p className="text-[14px] text-muted-foreground">{t("review.sessionFailed")}</p>
        ) : model.noSession ? (
          <p className="text-[14px] leading-[1.6] text-muted-foreground">
            {t("review.noSession")}{" "}
            <Link to={`/${campaign}`} className="text-primary hover:text-primary-hover">
              {t("review.backToPool")}
            </Link>
          </p>
        ) : (
          <>
            <p className="mb-2 text-[14px] leading-[1.6] text-body-secondary md:mb-8">
              {t("review.lead")}
            </p>
            {/* The topbar carries the progress on the desktop; below md it is
                hidden, so the count lives in the page there. */}
            <p className="mb-8 text-[13px] text-muted-foreground md:hidden">
              {model.progressLabel}
            </p>

            {model.hashUnavailable && (
              <p className="mb-6 text-[12.5px] text-muted-foreground">
                {t("review.hashUnavailable")}
              </p>
            )}

            {model.isPending ? (
              <p className="text-[14px] text-muted-foreground">{t("review.loading")}</p>
            ) : model.total === 0 ? (
              <p className="rounded-lg border border-dashed border-input px-8 py-8 text-center text-[14px] text-muted-foreground">
                {t("review.empty")}
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2.5">{harvest.map(renderCard)}</div>
                {/* `#pc` lines, grouped by character (issue #86): reminders
                    for the table — abhaken or keep, never adopted. */}
                {pcs.length > 0 && (
                  <section className="mt-9">
                    <h2 className="mb-3 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
                      {t("review.pc.title")}
                    </h2>
                    <p className="mb-3 text-[13.5px] leading-[1.6] text-muted-foreground">
                      {t("review.pc.lead")}
                    </p>
                    <div className="flex flex-col gap-5">
                      {pcs.map((group) => (
                        <div key={group.tag ?? ""} className="flex flex-col gap-2.5">
                          <h3 className="font-serif text-[15px] text-foreground">
                            {group.tag === undefined
                              ? t("review.pc.groupGeneral")
                              : t("review.pc.groupTag", { tag: group.tag })}
                          </h3>
                          {group.entries.map(renderCard)}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {/* Untagged inbox lines get their own section (issue #85) so
                    the tagged harvest above keeps reading as one list. */}
                {notes.length > 0 && (
                  <section className="mt-9">
                    <h2 className="mb-3 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
                      {t("review.notes.title")}
                    </h2>
                    <p className="mb-3 text-[13.5px] leading-[1.6] text-muted-foreground">
                      {t("review.notes.lead")}
                    </p>
                    <div className="flex flex-col gap-2.5">{notes.map(renderCard)}</div>
                  </section>
                )}
              </>
            )}

            <section className="mt-9 border-t border-border pt-5">
              <h2 className="mb-3 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
                {t("review.threads.title")}
              </h2>
              {threads.length === 0 ? (
                <p className="text-[13.5px] text-muted-foreground">{t("review.threads.empty")}</p>
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
                          {t("review.threads.new")}
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
              {t("review.finish")}
            </Button>
          </>
        )}
      </div>

      {npcEntry !== undefined && (
        <NpcCreateDialog
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
  kept,
  onThread,
  onNpc,
  onDismiss,
  onKeep,
}: {
  entry: ReviewEntry;
  action: ActionKind | undefined;
  busy: boolean;
  error: string | undefined;
  canAdopt: boolean;
  /** „Behalten" was clicked in this sitting (issue #86) — still open. */
  kept: boolean;
  onThread: () => void;
  onNpc: () => void;
  onDismiss: () => void;
  onKeep: () => void;
}) {
  const t = useT();
  const label = doneLabel(action, entry.section, t);
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
                {t("review.action.thread")}
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
                {t("create.npc.title")}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onDismiss}
              className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              {entry.section === "harvest" ? t("common.discard") : t("review.action.resolve")}
            </Button>
            {entry.section === "pc" && (
              // „Behalten" writes NOTHING — it is a marker for this sitting,
              // so it stays a toggle (aria-pressed) and never claims a
              // recorded decision. The entry stays open either way.
              <Button
                type="button"
                variant="outline"
                aria-pressed={kept}
                title={t("review.action.keepHint")}
                disabled={busy}
                onClick={onKeep}
                className={cn(
                  "h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground",
                  kept && "border-border-hover text-foreground",
                )}
              >
                {t("review.action.keep")}
              </Button>
            )}
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
