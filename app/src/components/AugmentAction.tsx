// „Mit KI ergänzen" (issue #36) — the third quiet action in an entry's header,
// next to „Bearbeiten" and „Eigenschaften". Same vocabulary, same size, no new
// chrome: the topbar does not grow, and the reading view gains one word.
//
// The flow is three states in ONE dialog, because it is one errand:
//
//   Eingabe   Quelltext (EN) and/or a free instruction — at least one of them.
//             Submitting starts a SERVER job (ADR #10) and answers right away.
//   Läuft     the job is polled through the shared generate-job query, so the
//             tab may be closed, navigated away from, or reloaded; a finished
//             proposal is still here afterwards, and so is a restart.
//   Review    the proposal, on the two levels the ticket asks for:
//               properties per FIELD  „Vorhanden | Vorschlag" with
//                                     Übernehmen/Behalten,
//               body per BLOCK        the Block-Composer's own blocks, with a
//                                     word diff INSIDE a changed block, plus a
//                                     „Roh" tab carrying a line/word diff over
//                                     the whole body.
//
// DEFAULTS are the ticket's own sentence, „nie stilles Überschreiben": what is
// empty or new is preselected, what is filled is kept. Accepting writes ONE
// request (properties + body, one transaction, one rev guard); a 409 is the
// house conflict protocol — nothing was written, the entry is re-read and the
// next attempt carries the fresh token.
//
// The action is DESKTOP-ONLY (`hidden md:inline-flex`): mobile is the reading,
// searching and inbox surface (UI-BRIEF), and a block-by-block diff review is
// not that. The reading view itself is untouched by this at every width.

import type { AugmentPropertyProposal, AugmentResult, FileResponse } from "@grimoire/shared/types";
import { isAugmentKind } from "@grimoire/shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, SpellCheck, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { applyAugment, deleteGenerateJob, fetchFile, startAugmentJob } from "@/api";
import { HeaderAction } from "@/components/HeaderAction";
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
import { blockLabel, blockMarkdown } from "@/lib/blocks";
import { generateJobKey, useGenerateJob } from "@/lib/use-generate-job";
import { cn } from "@/lib/utils";
import { isStaleFileError } from "@/lib/write-with-rev";

const OVERLINE = "text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground";

/** The two review surfaces — blocks (default) and the raw text diff. */
type ReviewMode = "blocks" | "raw";

export function AugmentAction({ campaign, file }: { campaign: string; file: FileResponse }) {
  const t = useT();
  // Open-BY-FILE, like the properties dialog: the reading route stays mounted
  // across a navigation, and a dialog holding entry A while `file` already
  // points at B would send A's decisions to B.
  const fileKey = `${campaign}/${file.path}`;
  const [openFile, setOpenFile] = useState<string>();
  useEffect(() => {
    setOpenFile(undefined);
  }, [fileKey]);
  if (!isAugmentKind(file.kind)) return null;
  return (
    <>
      <HeaderAction
        icon={Sparkles}
        label={t("augment.action")}
        onClick={() => setOpenFile(fileKey)}
        className="hidden md:inline-flex"
      />
      {openFile === fileKey && (
        <AugmentDialog
          key={fileKey}
          campaign={campaign}
          file={file}
          onClose={() => setOpenFile(undefined)}
        />
      )}
    </>
  );
}

function AugmentDialog({
  campaign,
  file,
  onClose,
}: {
  campaign: string;
  file: FileResponse;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const job = useGenerateJob(campaign);
  const [sourceText, setSourceText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [message, setMessage] = useState<string>();

  // The job belongs to this dialog only when it is an augment run for THIS
  // entry. Anything else (a scene run someone started on the generator page)
  // is reported as „busy" rather than silently adopted — one job per campaign
  // is the server's rule and the DM has to know whose job is in the way.
  const current = job.data;
  const mine = current?.kind === "augment" && current.target === file.path;
  const foreign = current !== undefined && current !== null && !mine && current.status === "running";
  const proposal = mine ? current?.augmentResult : undefined;

  const start = useMutation({
    mutationFn: () => startAugmentJob(campaign, { path: file.path, sourceText, instruction }),
    onMutate: () => setMessage(undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
    },
    onError: () => setMessage(t("augment.start.failed")),
  });

  const discard = useMutation({
    mutationFn: () => deleteGenerateJob(campaign),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
      onClose();
    },
    onError: () => setMessage(t("augment.discard.failed")),
  });

  const canStart =
    (sourceText.trim() !== "" || instruction.trim() !== "") && !start.isPending && !foreign;

  const failure = mine && current?.status === "failed" ? current.error : undefined;

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-48px)] w-[calc(100vw-48px)] max-w-[820px] flex-col"
      >
        <DialogTitle>{t("augment.title")}</DialogTitle>
        <DialogDescription>
          {t("augment.description", { path: file.path })}
        </DialogDescription>

        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto pr-0.5">
          {proposal !== undefined ? (
            <AugmentReview
              campaign={campaign}
              file={file}
              jobId={current?.id}
              proposal={proposal}
              onDone={onClose}
            />
          ) : mine && current?.status === "running" ? (
            <p role="status" className="py-10 text-center text-[13.5px] text-muted-foreground">
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
                <p className="mb-3 text-[13px] text-muted-foreground">{t("augment.busy")}</p>
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
              {t(start.isPending ? "augment.starting" : "augment.start")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- the review ---------------------------------------------------------------

function AugmentReview({
  campaign,
  file,
  jobId,
  proposal,
  onDone,
}: {
  campaign: string;
  file: FileResponse;
  jobId: string | undefined;
  proposal: AugmentResult;
  onDone: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const changes = useMemo(
    () => alignBlocks(proposal.currentBody, proposal.proposedBody),
    [proposal.currentBody, proposal.proposedBody],
  );
  const [acceptedBlocks, setAcceptedBlocks] = useState<Set<string>>(() => defaultAccepted(changes));
  // Properties default (AK2): take what is new, keep what is filled.
  const [acceptedFields, setAcceptedFields] = useState<Set<string>>(
    () => new Set(proposal.properties.filter((p) => p.state === "new").map((p) => p.key)),
  );
  const [mode, setMode] = useState<ReviewMode>("blocks");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [message, setMessage] = useState<string>();
  // Frozen at review time and advanced only after a conflict — the same rule
  // the properties dialog follows, so the 5s version poll cannot turn an
  // external write into a silent overwrite.
  const [base, setBase] = useState(file.rev);

  const decisions = changes.filter((change) => change.kind !== "same");
  const body = assembleBody(changes, acceptedBlocks);
  const patch = Object.fromEntries(
    proposal.properties
      .filter((p) => acceptedFields.has(p.key))
      .map((p) => [p.key, p.proposed] as const),
  );
  const bodyChanged = body !== proposal.currentBody;
  const canApply = bodyChanged || Object.keys(patch).length > 0;

  const apply = useMutation({
    mutationFn: () =>
      applyAugment(campaign, {
        path: proposal.path,
        rev: base,
        ...(Object.keys(patch).length === 0 ? {} : { properties: patch }),
        ...(bodyChanged ? { body } : {}),
        ...(jobId === undefined ? {} : { jobId }),
      }),
    onMutate: () => setMessage(undefined),
    onSuccess: (written) => {
      queryClient.setQueryData(["file", campaign, file.path], written);
      void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
      onDone();
    },
    onError: (error) => {
      if (!isStaleFileError(error)) {
        setMessage(t("write.failed"));
        return;
      }
      // 409: nothing was written. Re-read once so the next attempt carries
      // the fresh token, and say so instead of losing the decisions.
      setMessage(t("write.stale"));
      void fetchFile(campaign, file.path)
        .then((reread) => {
          queryClient.setQueryData(["file", campaign, file.path], reread);
          setBase(reread.rev);
        })
        .catch(() => undefined);
    },
  });

  const reject = useMutation({
    mutationFn: () => deleteGenerateJob(campaign),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
      onDone();
    },
    onError: () => setMessage(t("augment.discard.failed")),
  });

  return (
    <div className="flex min-h-0 flex-col">
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
              onDecide={(take) =>
                setAcceptedFields((prev) => {
                  const next = new Set(prev);
                  if (take) next.add(field.key);
                  else next.delete(field.key);
                  return next;
                })
              }
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
          {(["blocks", "raw"] as const).map((candidate) => (
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
              {t(candidate === "blocks" ? "augment.body.blocks" : "augment.body.raw")}
            </Button>
          ))}
        </div>
      </div>

      {mode === "blocks" ? (
        <>
          {decisions.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{t("augment.body.none")}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {changes
                .filter((change) => showUnchanged || change.kind !== "same")
                .map((change) => (
                  <BlockRow
                    key={change.id}
                    change={change}
                    accepted={acceptedBlocks.has(change.id)}
                    onDecide={(take) =>
                      setAcceptedBlocks((prev) => {
                        const next = new Set(prev);
                        if (take) next.add(change.id);
                        else next.delete(change.id);
                        return next;
                      })
                    }
                    t={t}
                  />
                ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setShowUnchanged((prev) => !prev)}
            className="mt-2.5 self-start rounded-md text-[12px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {t(showUnchanged ? "augment.body.hideUnchanged" : "augment.body.showUnchanged")}
          </button>
        </>
      ) : (
        <RawDiff before={proposal.currentBody} after={proposal.proposedBody} />
      )}

      <p aria-live="polite" className="min-h-[17px] pt-3 text-[12px] text-destructive">
        {message ?? ""}
      </p>
      <div className="flex items-center justify-end gap-2 pt-1">
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
          disabled={!canApply || apply.isPending}
          onClick={() => apply.mutate()}
          className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
        >
          {t(apply.isPending ? "common.saving" : "augment.accept")}
        </Button>
      </div>
    </div>
  );
}

/** „Vorhanden | Vorschlag" for one properties field. */
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
        <DecisionToggle accepted={accepted} onDecide={onDecide} t={t} />
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
        {!quiet && <DecisionToggle accepted={accepted} onDecide={onDecide} t={t} />}
      </div>
      {change.kind === "changed" ? (
        <WordDiffText tokens={change.words ?? []} />
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
 * block's VERBATIM source (blockMarkdown), so the review shows exactly the
 * text the accept would write.
 */
function blockSource(change: BlockChange): string {
  const block = change.kind === "removed" ? change.before : change.after;
  return block === undefined ? "" : blockMarkdown(block);
}

/** Word-level diff: only what moved is highlighted, the rest is neutral. */
function WordDiffText({ tokens }: { tokens: DiffToken[] }) {
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
          {token.text}
        </span>
      ))}
    </p>
  );
}

/** The raw tab: a line diff over the whole body, word diff inside a line. */
function RawDiff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-panel-deep">
      <pre className="min-w-full p-3 font-mono text-[12px] leading-[1.6]">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              "whitespace-pre-wrap",
              line.kind === "added" && "bg-primary/10 text-foreground",
              line.kind === "removed" && "bg-destructive/10 text-muted-foreground",
              line.kind === "same" && "text-body-secondary",
            )}
          >
            <span aria-hidden className="mr-2 inline-block w-2 text-faint">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : line.kind === "changed" ? "~" : " "}
            </span>
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

/** Übernehmen ⇄ Behalten — two real buttons with aria-pressed, no select. */
function DecisionToggle({
  accepted,
  onDecide,
  t,
}: {
  accepted: boolean;
  onDecide: (take: boolean) => void;
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
