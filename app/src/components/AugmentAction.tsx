// The augment action — the third quiet action in an entry's header, next to
// the edit and the properties action. Same vocabulary, same size, no new
// chrome: the topbar does not grow, and the reading view gains one word.
//
// The flow is three states in ONE dialog, because it is one errand:
//
//   input     source text and/or a free instruction — at least one of them.
//             Submitting starts a SERVER job (ADR #10) and answers right away.
//   running   the job is polled through the shared generate-job query, so the
//             tab may be closed, navigated away from, or reloaded; a finished
//             proposal is still here afterwards, and so is a restart.
//   review    the proposal, on two levels:
//               properties per FIELD  stored value beside proposed one, take
//                                     or keep,
//               body per BLOCK        the block composer's own blocks, with a
//                                     word diff INSIDE a changed block, plus a
//                                     raw tab carrying a line/word diff over
//                                     the whole text.
//
// DEFAULTS never overwrite silently: what is empty or new is preselected, what
// is filled is kept. Accepting writes ONE request (properties + text, one
// transaction, one version guard) and, on a conflict, asks — nothing was
// written, and continuing from the stored text re-cuts the whole proposal
// against it.
//
// The action is DESKTOP-ONLY (`hidden md:inline-flex`): mobile is the reading,
// searching and inbox surface (UI-BRIEF), and a block-by-block diff review is
// not that. The reading view itself is untouched by this at every width.

import type {
  AugmentPropertyProposal,
  AugmentResult,
  EntryResponse,
  GenerateJob,
} from "@grimoire/shared/types";
import { isAugmentKind } from "@grimoire/shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, SpellCheck, StickyNote } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { applyAugment, deleteGenerateJob, startAugmentJob } from "@/api";
import { EditConflict } from "@/components/EditConflict";
import { HeaderAction } from "@/components/HeaderAction";
import { ReviewSaveStatus } from "@/components/ReviewSaveStatus";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useT, type Translate } from "@/i18n";
import {
  alignBlocks,
  assembleBody,
  defaultAccepted,
  formatPropertyValue,
  lineDiff,
  type BlockChange,
  type BlockChangeKind,
  type DiffToken,
} from "@/lib/augment";
import { blockLabel, blockTreeMarkdown } from "@/lib/blocks";
import { propString } from "@/lib/properties";
import { reviewOf, runJobArrived } from "@/lib/generate";
import { generateJobKey, useGenerateJob } from "@/lib/use-generate-job";
import { useJobReview } from "@/lib/use-job-review";
import { useEntryEdit } from "@/lib/use-entry-edit";
import { cn } from "@/lib/utils";

const OVERLINE = "text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground";

/**
 * What the dialog CALLS the entry: the name the DM gave it (an npc's `name`,
 * a scene's `title`), never the wire address. An address like `npcs/fenn` is
 * how the entry is addressed, not how it is known at the table.
 */
function entryName(entry: EntryResponse): string {
  return propString(entry.properties.name) ?? propString(entry.properties.title) ?? entry.path;
}

/**
 * What is accepted right now: the computed DEFAULT set, overridden by every
 * decision the job carries. Absent from the record means the DM has not
 * touched that field/block, so the default still stands — which is what keeps
 * "never overwrite silently" true after a reload.
 */
function decidedSet(
  defaults: ReadonlySet<string>,
  decided: Record<string, boolean>,
): Set<string> {
  const out = new Set(defaults);
  for (const [key, take] of Object.entries(decided)) {
    if (take) out.add(key);
    else out.delete(key);
  }
  return out;
}

/** The two review surfaces — blocks (default) and the raw text diff. */
type ReviewMode = "blocks" | "markdown";

export function AugmentAction({ campaign, entry }: { campaign: string; entry: EntryResponse }) {
  const t = useT();
  // Open-BY-ENTRY, like the properties dialog: the reading route stays
  // mounted across a navigation, and a dialog holding entry A while `entry`
  // already points at B would send A's decisions to B.
  const entryKey = `${campaign}/${entry.path}`;
  const [openEntry, setOpenEntry] = useState<string>();
  useEffect(() => {
    setOpenEntry(undefined);
  }, [entryKey]);
  if (!isAugmentKind(entry.kind)) return null;
  return (
    <>
      <HeaderAction
        icon={Sparkles}
        label={t("augment.action")}
        onClick={() => setOpenEntry(entryKey)}
        className="hidden md:inline-flex"
      />
      {openEntry === entryKey && (
        <AugmentDialog
          key={entryKey}
          campaign={campaign}
          entry={entry}
          onClose={() => setOpenEntry(undefined)}
        />
      )}
    </>
  );
}

function AugmentDialog({
  campaign,
  entry,
  onClose,
}: {
  campaign: string;
  entry: EntryResponse;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  // `awaitingJob` is on from the click on the submit button until the job of
  // THAT run is readable, and it carries the id that was in the cache at the click
  // — because that is the one the new job does NOT have (lib/generate.ts
  // runJobArrived). It is the running view's first half and the poll loop's
  // reason to live at the same time, and those two have to be ONE flag: a GET
  // that overtakes the new row answers 404 and a previous run's job is
  // settled, so without it the interval switched off with nothing to switch
  // it back on — the dialog sat in front of a run that had long finished on
  // the server, and only closing and reopening it showed the proposal.
  const [awaitingJob, setAwaitingJob] = useState<{
    staleJobId: string | null;
    startedJobId?: string;
  }>();
  const job = useGenerateJob(campaign, { expectJob: awaitingJob !== undefined });
  const [sourceText, setSourceText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [message, setMessage] = useState<string>();

  // The job belongs to this dialog only when it is an augment run for THIS
  // entry. Anything else (a scene run someone started on the generator page)
  // is reported as busy rather than silently adopted — one job per campaign
  // is the server's rule and the DM has to know whose job is in the way.
  const current = job.data;
  const mine = current?.kind === "augment" && current.target === entry.path;
  // ANY foreign job blocks, not just a running one: a finished generator run
  // whose review nobody has looked at yet would be DELETED by the next start
  // (one job per campaign, and a start replaces a finished row). The DM has
  // to go and deal with it there — so the two cases get their own sentence.
  const foreign = current !== undefined && current !== null && !mine;
  const foreignRunning = foreign && current.status === "running";
  const proposal = mine ? current?.augmentResult : undefined;

  const start = useMutation({
    mutationFn: () => startAugmentJob(campaign, { path: entry.path, sourceText, instruction }),
    onMutate: () => {
      setMessage(undefined);
      // From here on this run's job is EXPECTED — see `awaitingJob` above.
      setAwaitingJob({ staleJobId: current?.id ?? null });
    },
    onSuccess: (started) => {
      // The id the start answered with (a 202's, or an adopted 409's) belongs
      // to THIS wait — kept here and not read off `start.data`, which
      // outlives it: a second run over a failed one would otherwise
      // recognise the OLD run's job as its own.
      setAwaitingJob((waiting) =>
        waiting === undefined ? waiting : { ...waiting, startedJobId: started.jobId },
      );
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
    },
    onError: () => {
      // The run never started: stop waiting for a job that is not coming.
      setAwaitingJob(undefined);
      setMessage(t("augment.start.failed"));
    },
  });

  const discard = useMutation({
    mutationFn: () => deleteGenerateJob(campaign),
    onSuccess: () => {
      setAwaitingJob(undefined);
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
      onClose();
    },
    onError: () => setMessage(t("augment.discard.failed")),
  });

  // The window between the click and "this run's job is readable" — and
  // NOTHING more: the moment the job answers, the JOB decides the phase, even
  // while its own 202 is still on the way. With a fast model the run is
  // finished before that response arrives, and taking the start request's
  // lifetime for the run's left the DM in front of a done run.
  const arrived =
    awaitingJob !== undefined &&
    runJobArrived({
      jobId: current?.id ?? null,
      staleJobId: awaitingJob.staleJobId,
      ...(awaitingJob.startedJobId === undefined
        ? {}
        : { startedJobId: awaitingJob.startedJobId }),
    });
  if (arrived) setAwaitingJob(undefined);
  const starting = awaitingJob !== undefined && !arrived;

  const canStart =
    (sourceText.trim() !== "" || instruction.trim() !== "") && !starting && !foreign;

  const failure = !starting && mine && current?.status === "failed" ? current.error : undefined;
  // Phase = f(job), with the start window as its only local part: the
  // proposal wins over everything (a done job is a review, whatever a
  // pending request says), and the spinner needs either an expected job or a
  // running one — never a mutation's `isPending`.
  const running =
    proposal === undefined && (starting || (mine && current?.status === "running"));
  const name = entryName(entry);

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-48px)] w-[calc(100vw-48px)] max-w-[820px] flex-col">
        <DialogTitle>{t("augment.title")}</DialogTitle>
        {/* One lead per phase (never the input hint during a run or a
            review), and it names the ENTRY, not its address. */}
        <DialogDescription>
          {t(
            proposal !== undefined
              ? "augment.description.review"
              : running
                ? "augment.description.running"
                : "augment.description",
            { name },
          )}
        </DialogDescription>
        {/* ONE live region for the whole dialog: the phases swap their
            subtrees, and a region that unmounts announces nothing. */}
        <p aria-live="polite" className="sr-only">
          {proposal !== undefined
            ? t("augment.announce.ready")
            : running
              ? t("augment.announce.running")
              : ""}
        </p>

        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto pr-0.5">
          {proposal !== undefined ? (
            <AugmentReview
              campaign={campaign}
              entry={entry}
              jobId={current?.id}
              job={current}
              proposal={proposal}
              onDone={onClose}
            />
          ) : running ? (
            <p className="py-10 text-center text-[13.5px] text-muted-foreground">
              {t("augment.running")}
            </p>
          ) : (
            <>
              {failure !== undefined && (
                <p className="mb-3 rounded-md border border-destructive/40 px-3 py-2 text-[13px] text-destructive">
                  {String(failure.body.error ?? t("augment.start.failed"))}
                </p>
              )}
              {foreign && (
                <p className="mb-3 text-[13px] text-muted-foreground">
                  {t(foreignRunning ? "augment.busy" : "augment.busy.review")}
                </p>
              )}
              <label htmlFor="augment-source" className={cn(OVERLINE, "mb-2 block")}>
                {t("augment.source.label")}
              </label>
              <textarea
                id="augment-source"
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                rows={6}
                placeholder={t("augment.source.placeholder")}
                className="mb-4 w-full resize-y rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
              />
              <label htmlFor="augment-instruction" className={cn(OVERLINE, "mb-2 block")}>
                {t("augment.instruction.label")}
              </label>
              <textarea
                id="augment-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder={t("augment.instruction.placeholder")}
                className="w-full resize-y rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
              />
              <p className="mt-2 text-[12px] text-faint">{t("augment.input.hint")}</p>
            </>
          )}
        </div>

        <p aria-live="polite" className="min-h-[17px] pt-2 text-[12px] text-destructive">
          {message ?? ""}
        </p>

        {/* One footer per PHASE — never the input's buttons over a running
            job. While the run is on, the submit button would start nothing
            (one job per campaign) and the cancel button would read like a
            stop: the only honest controls there are discarding the run and
            the close cross.
            The review brings its own footer. */}
        {proposal === undefined && (
          <div className="flex items-center justify-end gap-2">
            {mine && current !== null && current !== undefined && (
              <Button
                type="button"
                variant="outline"
                onClick={() => discard.mutate()}
                className="mr-auto h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
              >
                {t("augment.discard")}
              </Button>
            )}
            {!running && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  disabled={!canStart}
                  onClick={() => start.mutate()}
                  className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
                >
                  {t(starting ? "augment.starting" : "augment.start")}
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- the review ---------------------------------------------------------------

function AugmentReview({
  campaign,
  entry,
  jobId,
  job,
  proposal,
  onDone,
}: {
  campaign: string;
  entry: EntryResponse;
  jobId: string | undefined;
  /** The job the proposal came from — it carries the DM's decisions. */
  job: GenerateJob | null | undefined;
  proposal: AugmentResult;
  onDone: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  // The per-field and per-block decisions are SERVER state: a closed dialog,
  // a reload or a second tab all come back to the same review. Only the
  // DEFAULTS are computed here — a key the job does not carry has not been
  // decided, and then the standing rule applies: take what is new, keep what
  // is filled.
  const review = useJobReview(campaign, job);
  const stored = reviewOf(job);
  // The text the proposal is diffed AGAINST. It starts as the one the run saw
  // and moves only when the DM continues from what is stored (`onReload`).
  const [currentBody, setCurrentBody] = useState(proposal.currentBody);
  const changes = useMemo(
    () => alignBlocks(currentBody, proposal.proposedBody),
    [currentBody, proposal.proposedBody],
  );
  // Re-derived after a conflict (see `onConflict`): the blocks are cut
  // against a body that moved, so their ids did too.
  const [blockDefaults, setBlockDefaults] = useState<Set<string>>(() => defaultAccepted(changes));
  const acceptedBlocks = decidedSet(blockDefaults, stored.blocks);
  // Properties default (AK2): take what is new, keep what is filled.
  const fieldDefaults = useMemo(
    () => new Set(proposal.properties.filter((p) => p.state === "new").map((p) => p.key)),
    [proposal.properties],
  );
  const acceptedFields = decidedSet(fieldDefaults, stored.fields);
  const [mode, setMode] = useState<ReviewMode>("blocks");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [rejectMessage, setRejectMessage] = useState<string>();
  // The review takes the focus when it replaces the running state: the button
  // that had it is gone, and focus on <body> announces nothing at all.
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    container.current?.focus();
  }, []);

  const decisions = changes.filter((change) => change.kind !== "same");
  const hasUnchanged = changes.some((change) => change.kind === "same");
  const visible = changes.filter((change) => showUnchanged || change.kind !== "same");
  const body = assembleBody(changes, acceptedBlocks);
  const patch = Object.fromEntries(
    proposal.properties
      .filter((p) => acceptedFields.has(p.key))
      .map((p) => [p.key, p.proposed] as const),
  );
  const bodyChanged = body !== currentBody;
  const canApply = bodyChanged || Object.keys(patch).length > 0;

  // The accept is an ordinary editing session over the entry — same held
  // version, same conflict answer as every other editing surface — but it does
  // NOT go through the entry write: the accept endpoint discards the job in the
  // same transaction, which is the whole reason it exists. So the session is
  // handed that request instead, and the force action is not offered, because
  // that endpoint has no force.
  const apply = useEntryEdit(campaign, entry.path, entry.rev, {
    writeEntry: (request) =>
      applyAugment(campaign, {
        path: proposal.path,
        rev: request.rev,
        ...(request.properties === undefined ? {} : { properties: request.properties }),
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(jobId === undefined ? {} : { jobId }),
      }),
    canForce: false,
    // The command palette must not keep the text the proposal replaced.
    invalidateOnSuccess: [
      ["tree", campaign],
      ["search", campaign],
      generateJobKey(campaign),
    ],
    onSaved: onDone,
    onReload: (storedEntry) => {
      // Continue from what is stored: the other writer's text is the truth
      // now, so the proposal is re-cut against it and the defaults are
      // re-derived — keeping decisions that were cut against the stale text
      // would overwrite that writer on the next attempt, silently.
      //
      // The stored decisions are keyed by BLOCK ID, and the ids come out of
      // the alignment — re-cutting renames them. A decision left behind under
      // an old id would either apply to whatever block inherits that id or sit
      // on the job forever, so they are cleared FIRST and the defaults are
      // re-derived after.
      const stale = Object.keys(stored.blocks);
      if (stale.length > 0) {
        review.decide({ blocks: Object.fromEntries(stale.map((id) => [id, null])) });
      }
      setCurrentBody(storedEntry.body);
      setBlockDefaults(defaultAccepted(alignBlocks(storedEntry.body, proposal.proposedBody)));
    },
  });

  const reject = useMutation({
    mutationFn: () => deleteGenerateJob(campaign),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
      onDone();
    },
    onError: () => setRejectMessage(t("augment.discard.failed")),
  });

  const message = rejectMessage ?? apply.message;

  return (
    <div
      ref={container}
      tabIndex={-1}
      aria-label={t("augment.review.aria")}
      className="flex min-h-0 flex-col outline-none"
    >
      {proposal.warnings.map((warning) => (
        <div
          key={warning}
          className="mb-2 flex items-start gap-2.5 rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-3.5 py-2.5"
        >
          <StickyNote aria-hidden size={15} className="mt-px flex-none text-primary" />
          <p className="text-[13px] leading-[1.55] text-soft">{warning}</p>
        </div>
      ))}
      {proposal.namingHints !== undefined && proposal.namingHints.length > 0 && (
        <section className="mb-3 rounded-md border border-border bg-card px-3.5 py-3">
          <div className="mb-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
            <SpellCheck aria-hidden size={14} className="flex-none" />
            <h3 className="font-medium">
              {t("augment.review.namingHeading", { count: proposal.namingHints.length })}
            </h3>
          </div>
          <ul className="flex flex-col gap-1">
            {proposal.namingHints.map((hint, index) => (
              <li
                key={`${hint.field}:${hint.line ?? 0}:${hint.from}:${index}`}
                className="text-[13px] leading-[1.5] text-soft"
              >
                {t("augment.review.namingHint", { from: hint.from, to: hint.to })}
                <span className="ml-1.5 text-[12px] text-muted-foreground">{hint.excerpt}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- properties, per field ------------------------------------- */}
      <h3 className={cn(OVERLINE, "mb-2")}>{t("augment.properties.heading")}</h3>
      {proposal.properties.length === 0 ? (
        <p className="mb-4 text-[13px] text-muted-foreground">{t("augment.properties.none")}</p>
      ) : (
        <ul className="mb-5 flex flex-col gap-2">
          {proposal.properties.map((field) => (
            <PropertyRow
              key={field.key}
              field={field}
              accepted={acceptedFields.has(field.key)}
              onDecide={(take) => review.decide({ fields: { [field.key]: take } })}
              t={t}
            />
          ))}
        </ul>
      )}

      {/* --- the body ----------------------------------------------------- */}
      <div className="mb-2 flex items-center gap-3">
        <h3 className={OVERLINE}>{t("augment.body.heading")}</h3>
        <div
          role="group"
          aria-label={t("augment.body.modeGroup")}
          className="ml-auto flex items-center gap-px rounded-md border border-input p-px"
        >
          {(["blocks", "markdown"] as const).map((candidate) => (
            <Button
              key={candidate}
              type="button"
              variant="ghost"
              aria-pressed={mode === candidate}
              onClick={() => setMode(candidate)}
              className={cn(
                "h-auto rounded-[5px] px-2.5 py-[5px] text-[12px] font-normal",
                mode === candidate
                  ? "bg-secondary text-foreground hover:bg-secondary"
                  : "text-body-secondary hover:bg-transparent hover:text-foreground",
              )}
            >
              {t(candidate === "blocks" ? "augment.body.blocks" : "augment.body.markdown")}
            </Button>
          ))}
        </div>
      </div>

      {mode === "blocks" ? (
        <>
          {decisions.length === 0 && (
            <p className="text-[13px] text-muted-foreground">{t("augment.body.none")}</p>
          )}
          {visible.length > 0 && (
            <ul className="flex flex-col gap-2.5">
              {visible.map((change) => (
                <BlockRow
                  key={change.id}
                  change={change}
                  accepted={acceptedBlocks.has(change.id)}
                  onDecide={(take) => review.decide({ blocks: { [change.id]: take } })}
                  t={t}
                />
              ))}
            </ul>
          )}
          {/* Only offered when there is something behind it — the toggle used
              to sit there on an all-new body and reveal nothing. */}
          {hasUnchanged && (
            <button
              type="button"
              onClick={() => setShowUnchanged((prev) => !prev)}
              className="mt-2.5 self-start rounded-md text-[12px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              {t(showUnchanged ? "augment.body.hideUnchanged" : "augment.body.showUnchanged")}
            </button>
          )}
        </>
      ) : (
        <RawDiff before={currentBody} after={proposal.proposedBody} t={t} />
      )}

      <p aria-live="polite" className="min-h-[17px] pt-3 text-[12px] text-destructive">
        {message ?? ""}
      </p>
      {/* A refused accept asks instead of deciding: every decision above is
          untouched until the DM continues from what is stored. */}
      {apply.conflict !== undefined && (
        <EditConflict onReload={apply.reload} onForce={apply.forceSave} busy={apply.isSaving} />
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        {/* Every decision above is saved on the job — said here as quietly
            as in the generator review, and with the same words. */}
        <ReviewSaveStatus status={review.status} />
        <Button
          type="button"
          variant="outline"
          onClick={() => reject.mutate()}
          className="mr-auto h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
        >
          {t("augment.reject")}
        </Button>
        <Button
          type="button"
          disabled={!canApply || apply.isSaving}
          onClick={() =>
            apply.save({
              ...(Object.keys(patch).length === 0 ? {} : { properties: patch }),
              ...(bodyChanged ? { body } : {}),
            })
          }
          className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
        >
          {t(apply.isSaving ? "common.saving" : "augment.accept")}
        </Button>
      </div>
    </div>
  );
}

/** The stored value beside the proposed one, for one properties field. */
function PropertyRow({
  field,
  accepted,
  onDecide,
  t,
}: {
  field: AugmentPropertyProposal;
  accepted: boolean;
  onDecide: (take: boolean) => void;
  t: Translate;
}) {
  const current = formatPropertyValue(field.current);
  return (
    <li className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-[12px] text-soft">{field.key}</span>
        <StateBadge state={field.state} t={t} />
        <DecisionToggle accepted={accepted} onDecide={onDecide} unit={field.key} t={t} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] leading-[1.5]">
        <dt className="text-[11.5px] text-muted-foreground">{t("augment.field.current")}</dt>
        <dd className={cn("text-body-secondary", current === "" && "text-faint italic")}>
          {current === "" ? t("augment.field.empty") : current}
        </dd>
        <dt className="text-[11.5px] text-muted-foreground">{t("augment.field.proposed")}</dt>
        <dd className="text-foreground">{formatPropertyValue(field.proposed)}</dd>
      </dl>
    </li>
  );
}

/** One block decision: the label, the state, the diff and the toggle. */
function BlockRow({
  change,
  accepted,
  onDecide,
  t,
}: {
  change: BlockChange;
  accepted: boolean;
  onDecide: (take: boolean) => void;
  t: Translate;
}) {
  const block = change.after ?? change.before;
  if (block === undefined) return null;
  const quiet = change.kind === "same";
  return (
    <li
      className={cn(
        "rounded-md border px-3 py-2.5",
        quiet ? "border-border/60 bg-transparent" : "border-border bg-card",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className={OVERLINE}>{blockLabel(block, t)}</span>
        {change.kind !== "same" && <StateBadge state={change.kind} t={t} />}
        {!quiet && (
          <DecisionToggle accepted={accepted} onDecide={onDecide} unit={blockLabel(block, t)} t={t} />
        )}
      </div>
      {change.kind === "changed" ? (
        <WordDiffText tokens={change.words ?? []} t={t} />
      ) : (
        <pre
          className={cn(
            "font-serif text-[13.5px] leading-[1.6] whitespace-pre-wrap",
            change.kind === "removed" ? "text-muted-foreground line-through" : "text-body-secondary",
          )}
        >
          {blockSource(change)}
        </pre>
      )}
    </li>
  );
}

/**
 * The markdown a non-changed row shows — the side that exists. It is the
 * block's VERBATIM source WITH everything the block contains: an `## If:`
 * section's card shows its heading AND its body, because that whole section
 * is what the one toggle next to it decides about. So the review
 * shows exactly the text the accept would write.
 */
function blockSource(change: BlockChange): string {
  const block = change.kind === "removed" ? change.before : change.after;
  return block === undefined ? "" : blockTreeMarkdown(block);
}

/**
 * Word-level diff: only what moved is highlighted, the rest is neutral.
 *
 * Colour is never the only cue — a removed run is struck through and an added
 * one is announced, so "added"/"removed" reaches a reader who sees no
 * highlight at all.
 */
function WordDiffText({ tokens, t }: { tokens: DiffToken[]; t: Translate }) {
  return (
    <p className="font-serif text-[13.5px] leading-[1.6] whitespace-pre-wrap text-body-secondary">
      {tokens.map((token, index) => (
        <span
          key={index}
          className={cn(
            token.kind === "removed" &&
              "bg-destructive/15 text-muted-foreground line-through decoration-1",
            token.kind === "added" && "bg-primary/15 text-foreground",
          )}
        >
          {token.kind !== "same" && (
            <span className="sr-only">
              {t(token.kind === "added" ? "augment.diff.added" : "augment.diff.removed")}{" "}
            </span>
          )}
          {token.text}
        </span>
      ))}
    </p>
  );
}

/** The raw tab: a line diff over the whole body, word diff inside a line. */
function RawDiff({ before, after, t }: { before: string; after: string; t: Translate }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-panel-deep">
      <pre className="min-w-full p-3 font-mono text-[12px] leading-[1.6]">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              // A left accent, not colour alone: an added line reads as added
              // in a monochrome rendering too.
              "whitespace-pre-wrap border-l-2 pl-1.5",
              line.kind === "added" && "border-primary bg-primary/10 text-foreground",
              line.kind === "removed" &&
                "border-destructive bg-destructive/10 text-muted-foreground line-through",
              line.kind === "changed" && "border-primary/50",
              line.kind === "same" && "border-transparent text-body-secondary",
            )}
          >
            {/* The gutter marker is REAL text, and the kind is spelled out
                for a reader who cannot see it. */}
            <span className="mr-2 inline-block w-2 text-faint">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : line.kind === "changed" ? "~" : " "}
            </span>
            {line.kind !== "same" && (
              <span className="sr-only">
                {t(
                  line.kind === "added"
                    ? "augment.diff.added"
                    : line.kind === "removed"
                      ? "augment.diff.removed"
                      : "augment.diff.changed",
                )}{" "}
              </span>
            )}
            {line.kind === "changed" ? (
              (line.words ?? []).map((token, tokenIndex) => (
                <span
                  key={tokenIndex}
                  className={cn(
                    token.kind === "removed" &&
                      "bg-destructive/15 text-muted-foreground line-through",
                    token.kind === "added" && "bg-primary/15 text-foreground",
                    token.kind === "same" && "text-body-secondary",
                  )}
                >
                  {token.text}
                </span>
              ))
            ) : (
              <span>{line.after ?? line.before}</span>
            )}
          </div>
        ))}
      </pre>
    </div>
  );
}

function StateBadge({
  state,
  t,
}: {
  state: AugmentPropertyProposal["state"] | Exclude<BlockChangeKind, "same">;
  t: Translate;
}) {
  const key =
    state === "new" || state === "added"
      ? "augment.state.new"
      : state === "removed"
        ? "augment.state.removed"
        : "augment.state.changed";
  return (
    <span className="rounded-full border border-input px-2 py-px text-[11px] text-muted-foreground">
      {t(key)}
    </span>
  );
}

/**
 * Take ⇄ keep — two real buttons with aria-pressed, no select.
 *
 * The VISIBLE word stays the screen's vocabulary, but the accessible name
 * carries the unit it decides on: a review of a dozen decisions plus the
 * footer button otherwise offers a dozen identically named controls to a
 * screen reader, and the footer's is the one that writes.
 */
function DecisionToggle({
  accepted,
  onDecide,
  unit,
  t,
}: {
  accepted: boolean;
  onDecide: (take: boolean) => void;
  unit: string;
  t: Translate;
}) {
  return (
    <div
      role="group"
      aria-label={t("augment.decision.aria")}
      className="ml-auto flex items-center gap-px rounded-md border border-input p-px"
    >
      {([true, false] as const).map((take) => (
        <Button
          key={String(take)}
          type="button"
          variant="ghost"
          aria-pressed={accepted === take}
          aria-label={t(take ? "augment.decision.takeUnit" : "augment.decision.keepUnit", {
            label: unit,
          })}
          onClick={() => onDecide(take)}
          className={cn(
            "h-auto rounded-[5px] px-2 py-[3px] text-[11.5px] font-normal",
            accepted === take
              ? "bg-secondary text-foreground hover:bg-secondary"
              : "text-body-secondary hover:bg-transparent hover:text-foreground",
          )}
        >
          {t(take ? "augment.decision.take" : "augment.decision.keep")}
        </Button>
      ))}
    </div>
  );
}
