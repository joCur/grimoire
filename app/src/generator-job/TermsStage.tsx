// The terms stage of a scene run (decisions/generator): the outline named the
// material's own terms whose rendering is a real choice, and the run waits on
// the DM before any scene, npc or location is written. The stage groups the
// terms by kind; each shows its wording, what it is and an editable
// rendering (blank keeps the wording), and a tick that keeps it in the
// glossary, set by default. One action accepts every term as it stands and
// sets the run going again — the confirmation is ONE write of the job, under
// its guard. Until then the renderings are a form of this view, like any
// edit mode before it is saved.

import {
  RUN_TERM_KINDS,
  type GeneratorJob,
  type RunTerm,
  type RunTermKind,
} from "@grimoire/shared/generator-job";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { ApiError } from "@/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { INPUT_CLASS } from "@/components/ui/field";
import { useT } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";

import { confirmJobTerms } from "./generator-job-api";
import { generateJobKey } from "./generator-job-query";

const OVERLINE = "text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground";

const KIND_LABEL: Record<RunTermKind, MessageKey> = {
  place: "generate.terms.kind.place",
  person: "generate.terms.kind.person",
  group: "generate.terms.kind.group",
  "game-term": "generate.terms.kind.game-term",
};

/**
 * The terms stage of a run whose terms are open. `onConfirmed` is told once
 * the confirmation is written — the page that composes this view refreshes
 * what the kept terms changed. Discarding the run is the page's, as in every
 * stage of the review.
 */
export function TermsStage({
  campaign,
  job,
  terms,
  onConfirmed,
  discard,
}: {
  campaign: string;
  job: GeneratorJob;
  terms: readonly RunTerm[];
  onConfirmed: () => void;
  discard: { pending: boolean; failed: boolean; onDiscard: () => void };
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [renderings, setRenderings] = useState<Record<string, string>>(() =>
    Object.fromEntries(terms.map((term) => [term.wording, term.rendering])),
  );
  /** The terms the DM does NOT keep in the glossary — every one is kept by default. */
  const [dropped, setDropped] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState<MessageKey | undefined>(undefined);

  const confirm = useMutation({
    mutationFn: () =>
      confirmJobTerms(
        campaign,
        job.id,
        job.rev,
        Object.fromEntries(
          terms.map((term) => [
            term.wording,
            {
              rendering: renderings[term.wording] ?? term.rendering,
              glossary: dropped[term.wording] !== true,
            },
          ]),
        ),
      ),
    onSuccess: (updated) => {
      setProblem(undefined);
      queryClient.setQueryData(generateJobKey(campaign), updated);
      onConfirmed();
    },
    onError: (error) => {
      // A 409 means the job moved on elsewhere and nothing was written: the
      // job is read again, and the stage says so.
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
        setProblem("generate.terms.conflict");
        return;
      }
      setProblem("generate.terms.failed");
    },
  });

  const groups = RUN_TERM_KINDS.map((kind) => ({
    kind,
    terms: terms.filter((term) => term.kind === kind),
  })).filter((group) => group.terms.length > 0);

  return (
    <section data-testid="terms-stage" aria-labelledby="terms-stage-title">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-3">
        <h1
          id="terms-stage-title"
          className="font-serif text-[26px] leading-[1.25] font-semibold text-foreground"
        >
          {t("generate.terms.title")}
        </h1>
        <span className="text-[13px] text-muted-foreground">
          {t("generate.terms.count", { count: terms.length })}
        </span>
      </div>
      <p className="mb-2 text-[14px] leading-[1.6] text-body-secondary">{t("generate.terms.lead")}</p>
      <p className="mb-[22px] text-[12.5px] leading-[1.55] text-muted-foreground">
        {t("generate.terms.hint")}
      </p>

      {groups.map((group) => (
        <section
          key={group.kind}
          data-testid={`terms-group:${group.kind}`}
          aria-labelledby={`terms-group-${group.kind}`}
          className="mb-[22px]"
        >
          <h2 id={`terms-group-${group.kind}`} className={cn(OVERLINE, "mb-2.5")}>
            {t(KIND_LABEL[group.kind])}
          </h2>
          <ul className="flex flex-col gap-2.5">
            {group.terms.map((term) => (
              <TermRow
                key={term.wording}
                term={term}
                rendering={renderings[term.wording] ?? term.rendering}
                kept={dropped[term.wording] !== true}
                disabled={confirm.isPending}
                onRendering={(value) =>
                  setRenderings((previous) => ({ ...previous, [term.wording]: value }))
                }
                onKept={(kept) => setDropped((previous) => ({ ...previous, [term.wording]: !kept }))}
              />
            ))}
          </ul>
        </section>
      ))}

      {problem !== undefined && (
        <p role="alert" className="mb-3 text-[13px] text-destructive">
          {t(problem)}
        </p>
      )}
      {discard.failed && (
        <p aria-live="polite" className="mb-3 text-[13px] text-destructive">
          {t("generate.review.discardFailed")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-[18px]">
        <Button
          type="button"
          data-testid="terms-accept"
          disabled={confirm.isPending || discard.pending}
          onClick={() => confirm.mutate()}
          className="h-auto px-[18px] py-2.5 text-[13.5px] font-semibold"
        >
          {confirm.isPending
            ? t("generate.terms.accepting")
            : t("generate.terms.accept", { count: terms.length })}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={confirm.isPending || discard.pending}
          onClick={discard.onDiscard}
          className="h-auto border-input bg-transparent px-3.5 py-2 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
        >
          {t("common.discard")}
        </Button>
      </div>
    </section>
  );
}

/** One term: its wording and what it is, its rendering, and the glossary tick. */
function TermRow({
  term,
  rendering,
  kept,
  disabled,
  onRendering,
  onKept,
}: {
  term: RunTerm;
  rendering: string;
  kept: boolean;
  disabled: boolean;
  onRendering: (value: string) => void;
  onKept: (kept: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  return (
    <li
      data-testid={`term:${term.wording}`}
      className="rounded-lg border border-border bg-card px-3.5 py-3"
    >
      <p className="text-[14px] leading-[1.45] font-semibold break-words text-foreground">
        {term.wording}
      </p>
      {term.description !== "" && (
        <p className="mt-0.5 text-[13px] leading-[1.5] break-words text-body-secondary">
          {term.description}
        </p>
      )}
      <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
        <label htmlFor={`${id}-rendering`} className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[12px] text-muted-foreground">{t("generate.terms.rendering")}</span>
          <input
            id={`${id}-rendering`}
            data-testid="term-rendering"
            type="text"
            value={rendering}
            disabled={disabled}
            placeholder={term.wording}
            aria-label={t("generate.terms.renderingOf", { wording: term.wording })}
            onChange={(event) => onRendering(event.target.value)}
            className={cn(
              INPUT_CLASS,
              "outline-none focus-visible:border-border-hover focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
        </label>
        <label
          htmlFor={`${id}-glossary`}
          className="flex flex-none cursor-pointer items-center gap-2 text-[13px] text-body-secondary sm:pt-5"
        >
          <Checkbox
            id={`${id}-glossary`}
            data-testid="term-glossary"
            checked={kept}
            disabled={disabled}
            onCheckedChange={(state) => onKept(state === true)}
          />
          {t("generate.terms.glossary")}
        </label>
      </div>
    </li>
  );
}
