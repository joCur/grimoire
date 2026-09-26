// "/campaigns/:campaign/review" — the session wrap-up view, per the design
// reference: the tagged lines of today's log and the tagged ideas as cards
// with one-click actions, the chapter's threads below, a brass finish action
// at the end. Reached after a session is ended and from the quiet chapter
// overview affordance.
//
// The server is the truth: every action writes through its endpoint, and what
// comes back — the thread that was created, the npc that was created, plus
// the log entry that was reviewed or the idea that was ticked off — is
// seeded into the caches. The page harvests the first session of the list:
// the last started one, ended or not. An npc is created on its own resource
// (`POST …/npcs`) with the note as its text; when the id already names an npc
// with content, nothing is written, the dialog says so, and the row stays
// open. Adopting a thread creates a thread of the active chapter
// (`POST …/threads`); the chapter's text and its `rev` stay as they are
// (decisions/data-shape). The ONLY client state is cosmetic: which action a card got in
// this sitting (the server stores done/not-done, not which action) and which
// threads were adopted here (the "neu" chip, by thread id).
// Mobile: the desk task stays usable — one column, stacked cards.

import type { Idea } from "@grimoire/shared/idea";
import type { LogEntry } from "@grimoire/shared/log-entry";
import type { Npc } from "@grimoire/shared/npc";
import type { Thread } from "@grimoire/shared/thread";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { fetchTree } from "@/api";
import { MobileBackRow } from "@/components/MobileBackRow";
import { Button } from "@/components/ui/button";
import type { Translate } from "@/i18n";
import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { tickIdea } from "@/idea/idea-api";
import { tickFailureKey } from "@/idea/idea-tick";
import { ideasKey, withIdea } from "@/idea/idea-query";
import { createConflict } from "@/lib/create";
import type { ReviewActionKind } from "@/lib/review-memory";
import { useActedKeys, useReviewMemory } from "@/lib/review-memory";
import { cn } from "@/lib/utils";
import type { ReviewCard } from "@/lib/use-review";
import { pcGroups, useReviewCards } from "@/lib/use-review";
import { isWriteConflict } from "@/lib/write-with-rev";
import { NpcFromNoteDialog } from "@/npc/NpcFromNoteDialog";
import { createNpc } from "@/npc/npc-api";
import { npcKey, npcsKey } from "@/npc/npc-query";
import { reviewLogEntry } from "@/session/log-entry-api";
import { reviewFailureKey } from "@/session/log-entry-review";
import { putLogEntry, sessionScopeKey } from "@/session/session-query";
import { createThread } from "@/thread/thread-api";
import { threadsKey, withThread } from "@/thread/thread-query";
import { ThreadSummary } from "@/thread/ThreadSummary";

type ActionKind = ReviewActionKind;

interface ActVars {
  card: ReviewCard;
  action: ActionKind;
  npc?: { id: string; name?: string };
}

/** What one card action wrote: what it created plus the ticked source. */
interface ActResult {
  /** The npc the action created, or filled when it was empty. */
  npc?: Npc;
  /** The thread an adoption created. */
  thread?: Thread;
  logEntry?: LogEntry;
  idea?: Idea;
}

/** Why creating an npc from a note wrote nothing, as the sentence the dialog shows. */
function npcFailure(error: unknown, t: Translate): string {
  const conflict = createConflict(error);
  if (conflict !== undefined) {
    return t("review.npc.exists", { id: conflict.id, suggestion: conflict.suggestion });
  }
  return serverErrorMessage(error, t, "review.npc.failed");
}

function doneLabel(
  action: ActionKind | undefined,
  section: ReviewCard["section"],
  t: Translate,
): string {
  switch (action) {
    case "thread":
      return t("review.done.thread");
    case "npc":
      return t("review.done.npc");
    case "dismiss":
      // An untagged note or a PC reminder is not discarded, it is done with —
      // the write is the same, the word the DM sees is not.
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
  const [npcCard, setNpcCard] = useState<ReviewCard>();
  // The keep action writes nothing: the card stays open (and counted) for the
  // next wrap-up, the marker is cosmetic and lives for this sitting only.
  // Campaign-scoped like the rest of the review memory: the route param
  // changes without remounting this component, so an unscoped set would carry
  // a keep mark over into the NEXT campaign.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set<string>());
  const keptKey = (card: ReviewCard) => `${campaign}:${card.key}`;

  const model = useReviewCards(campaign);

  // The active chapter (fallback: the first) — the same rule as the live nav.
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  const chapters = tree.data?.chapters ?? [];
  const chapter = chapters.find((ch) => ch.status === "active") ?? chapters[0];

  const act = useMutation({
    mutationFn: async ({ card, action, npc }: ActVars): Promise<ActResult> => {
      let created: Npc | undefined;
      let thread: Thread | undefined;
      if (action === "thread") {
        if (chapter === undefined) throw new Error("no chapter to adopt into");
        thread = await createThread(campaign, { chapter: chapter.id, text: card.text });
      } else if (action === "npc") {
        if (npc === undefined) throw new Error("no npc id");
        // The note becomes the npc's text. An id whose npc already holds
        // something is a 409 that wrote nothing — it throws here, so the row
        // below is NOT marked, and the dialog says what happened.
        created = await createNpc(campaign, {
          // An npc without a name of its own shows its id (README).
          name: npc.name ?? npc.id,
          id: npc.id,
          body: card.text,
        });
      }
      const made = {
        ...(created === undefined ? {} : { npc: created }),
        ...(thread === undefined ? {} : { thread }),
      };
      // Only after the harvest succeeded is the source marked done.
      if (card.idea !== undefined) {
        return { ...made, idea: await tickIdea(campaign, card.idea) };
      }
      // The session comes from the server (the last started one — which may
      // have started yesterday). Without it there is nothing to review.
      if (card.logEntry === undefined || model.sessionId === "") {
        throw new Error("no log entry to review");
      }
      return {
        ...made,
        logEntry: await reviewLogEntry(campaign, model.sessionId, card.logEntry),
      };
    },
    onSuccess: (result, vars) => {
      // Every endpoint returns what it wrote: seed the npc's own query.
      if (result.npc !== undefined) {
        queryClient.setQueryData(npcKey(campaign, result.npc.id), result.npc);
      }
      // A log entry's done-state lives in its session, an idea's on the idea
      // — the live aside and the topbar read both, so they see the fresh
      // answer (same rule as routes/PcReminders).
      if (result.logEntry !== undefined) {
        putLogEntry(queryClient, campaign, model.sessionId, result.logEntry);
      }
      const { idea, thread } = result;
      if (idea !== undefined) {
        queryClient.setQueryData<Idea[]>(ideasKey(campaign), (list) => withIdea(list, idea));
      }
      // The new thread joins its chapter's threads — the overview reads the
      // same key.
      if (thread !== undefined) {
        queryClient.setQueryData<Thread[]>(threadsKey(campaign, thread.chapter), (list) =>
          withThread(list, thread),
        );
      }
      // A new npc changes the tree, the npc list and ⌘K.
      if (vars.action === "npc") {
        void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
        void queryClient.invalidateQueries({ queryKey: npcsKey(campaign) });
        void queryClient.invalidateQueries({ queryKey: ["search", campaign] });
      }
      remember(campaign, vars.card.key, vars.action, thread?.id);
      if (vars.action === "npc") setNpcCard(undefined);
    },
    onError: (error, { card }) => {
      // The row moved since it was read: read it again, so the next attempt
      // carries its current guard.
      if (!isWriteConflict(error)) return;
      void queryClient.invalidateQueries({
        queryKey: card.idea !== undefined ? ideasKey(campaign) : sessionScopeKey(campaign),
      });
    },
  });

  const busyKey = act.isPending ? act.variables?.card.key : undefined;
  // The dialog's own line: the id names an npc with content (nothing was
  // written, the note stays in the row), or any other refusal in the
  // server's words, or a server that did not answer.
  const npcError =
    act.isError && act.variables?.action === "npc" ? npcFailure(act.error, t) : undefined;
  const cardError = (card: ReviewCard) =>
    act.isError && act.variables?.action !== "npc" && act.variables?.card.key === card.key
      ? t(
          card.logEntry !== undefined
            ? reviewFailureKey(act.error, "review.action.failed")
            : tickFailureKey(act.error, "review.action.failed"),
        )
      : undefined;

  const harvest = model.cards.filter((card) => card.section === "harvest");
  const notes = model.cards.filter((card) => card.section === "notes");
  const pcs = pcGroups(model.cards);

  const renderCard = (card: ReviewCard) => (
    <ReviewCardView
      key={card.key}
      card={card}
      action={acted.get(card.key)}
      busy={busyKey === card.key}
      error={cardError(card)}
      canAdopt={chapter !== undefined}
      kept={kept.has(keptKey(card))}
      onKeep={() =>
        setKept((current) => {
          const next = new Set(current);
          const key = keptKey(card);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        })
      }
      onThread={() => {
        act.reset();
        act.mutate({ card, action: "thread" });
      }}
      onNpc={() => {
        act.reset();
        setNpcCard(card);
      }}
      onDismiss={() => {
        act.reset();
        act.mutate({ card, action: "dismiss" });
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
            <Link to={`/campaigns/${campaign}`} className="text-primary hover:text-primary-hover">
              {t("review.backToChapters")}
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

            {model.isPending ? (
              <p className="text-[14px] text-muted-foreground">{t("review.loading")}</p>
            ) : model.total === 0 ? (
              <p className="rounded-lg border border-dashed border-input px-8 py-8 text-center text-[14px] text-muted-foreground">
                {t("review.empty")}
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2.5">{harvest.map(renderCard)}</div>
                {/* `#pc` lines, grouped by character: reminders
                    for the table — tick off or keep, never adopted. */}
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
                          {group.items.map(renderCard)}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {/* Untagged ideas get their own section so
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
              <ThreadSummary campaign={campaign} chapter={chapter?.id} adopted={adoptedHere} />
            </section>

            <Button
              type="button"
              onClick={() => void navigate(`/campaigns/${campaign}`)}
              className="mt-9 h-auto px-[18px] py-2.5 text-[13.5px] font-semibold"
            >
              {t("review.finish")}
            </Button>
          </>
        )}
      </div>

      {npcCard !== undefined && (
        <NpcFromNoteDialog
          key={npcCard.key}
          text={npcCard.text}
          pending={act.isPending}
          error={npcError}
          onClose={() => {
            act.reset();
            setNpcCard(undefined);
          }}
          onSubmit={(npc) => {
            act.reset();
            act.mutate({ card: npcCard, action: "npc", npc });
          }}
        />
      )}
    </>
  );
}

/** One harvest card per the prototype: source · mono time · mono tag chip,
 *  the text, then the action row — or the dimmed done row. */
function ReviewCardView({
  card,
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
  card: ReviewCard;
  action: ActionKind | undefined;
  busy: boolean;
  error: string | undefined;
  canAdopt: boolean;
  /** The keep action was clicked in this sitting — still open. */
  kept: boolean;
  onThread: () => void;
  onNpc: () => void;
  onDismiss: () => void;
  onKeep: () => void;
}) {
  const t = useT();
  const label = doneLabel(action, card.section, t);
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3.5",
        card.done && "opacity-55",
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-muted-foreground">{card.sourceLabel}</span>
        {card.meta !== undefined && <span className="font-mono text-faint">{card.meta}</span>}
        {card.tag !== "" && (
          <span className="rounded-[4px] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-[7px] py-px font-mono text-[11.5px] text-primary-hover">
            #{card.tag}
          </span>
        )}
      </div>
      <p className="mb-2.5 text-[14px] leading-[1.55] text-foreground">{card.text}</p>

      {card.done ? (
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
            {card.canThread && canAdopt && (
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
            {card.canNpc && (
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
              {card.section === "harvest" ? t("common.discard") : t("review.action.resolve")}
            </Button>
            {card.section === "pc" && (
              // The keep action writes NOTHING — it is a marker for this
              // sitting, so it stays a toggle (aria-pressed) and never claims
              // a recorded decision. The card stays open either way.
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
