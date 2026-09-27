// The patch round of one finished part of a scene run, in its card's notes
// slot (decisions/generator: an answer to a note patches the proposal instead
// of writing it again):
//
//   answering  every model note on the part gets an answer field, and one
//              action sends every answer of the part — one call per part and
//              round, run on the server while the job is polled. A box under
//              each answer keeps it as campaign knowledge too: the server
//              creates the item as the round opens, so this round's call and
//              every later one has it in its context;
//   running    one quiet line says the model is at it;
//   failed     the round says it brought nothing, the notes stay, and the
//              answers can go again;
//   deciding   what the round changes, field by field and block by block —
//              the value or block as it stands beside the new one — and the
//              DM takes or discards each change. A taken one lands in the
//              job's edits of the proposal, which the accept writes.
//
// The answer form is where the part's notes stand, so it carries the notes'
// test id; the running and deciding states carry the round's. What the
// server noted about the part stands above the model's notes and gets no
// answer field: the model did not write it (PartNotes.tsx).
//
// A note whose answer was worked in is done and gone from the part; what the
// model noted in the round joins the notes. The comparison shows only changes
// the server applied: an operation it could not apply is a finding of the
// part, which the server reports as data and this card says in a sentence.

import { parseBlocks } from "@grimoire/shared/blocks";
import type {
  GeneratorJob,
  GeneratorJobPart,
  PartChange,
  PatchFinding,
} from "@grimoire/shared/generator-job";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleSlash, StickyNote } from "lucide-react";
import { useId, useState } from "react";

import { ApiError } from "@/api";
import { DecisionToggle, StateBadge, WordDiffText } from "@/components/ReviewDiff";
import { Button } from "@/components/ui/button";
import { AutoGrowTextarea } from "@/components/ui/autogrow-textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useT, type Translate } from "@/i18n";
import { formatFieldValue, wordDiff } from "@/lib/augment";
import { blockLabel } from "@/lib/block-labels";
import { cn } from "@/lib/utils";

import { answerPartNotes, decidePartChanges } from "./generator-job-api";
import { generateJobKey } from "./generator-job-query";
import { FIELD_LABEL, ModelNotes, NOTES_FRAME, ServerNoteList } from "./PartNotes";

const FRAME = cn("mb-3 px-3 py-2", NOTES_FRAME);

/**
 * The notes of a finished part with its patch round: answered, sent, and the
 * changes decided. `current` is the part's proposal as the review shows it —
 * the values a change is compared with.
 */
export function PartRound({
  campaign,
  job,
  part,
  current,
}: {
  campaign: string;
  job: GeneratorJob;
  part: GeneratorJobPart;
  current: Readonly<Record<string, unknown>>;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const round = part.round;
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries((round?.answers ?? []).map((entry) => [entry.note, entry.answer])),
  );
  /** The notes whose answer the DM keeps as campaign knowledge. */
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState<string | undefined>(undefined);
  /** A 409 means the job moved on elsewhere: re-read it, and say so. */
  const settle = (error: unknown, sentence: string) => {
    if (error instanceof ApiError && error.status === 409) {
      void queryClient.invalidateQueries({ queryKey: generateJobKey(campaign) });
      setProblem(
        error.details.code === "patch_anchor_missing"
          ? t("server.patch_anchor_missing")
          : t("generatorJob.round.conflict"),
      );
      return;
    }
    setProblem(sentence);
  };
  const seed = (updated: GeneratorJob) => {
    setProblem(undefined);
    queryClient.setQueryData(generateJobKey(campaign), updated);
  };

  const send = useMutation({
    mutationFn: () =>
      answerPartNotes(
        campaign,
        job.id,
        part.key,
        job.rev,
        part.warnings
          .map((note) => ({
            note,
            answer: (answers[note] ?? "").trim(),
            ...(kept[note] === true ? { asKnowledge: true } : {}),
          }))
          .filter((entry) => entry.answer !== ""),
      ),
    // The kept answers are campaign knowledge now: a round sent again after
    // a failure must not create them a second time.
    onSuccess: (updated) => {
      setKept({});
      seed(updated);
    },
    onError: (error) => settle(error, t("generatorJob.round.sendFailed")),
  });
  const decide = useMutation({
    mutationFn: (decision: { id: string; take: boolean }) =>
      decidePartChanges(campaign, job.id, part.key, job.rev, {
        [decision.id]: decision.take ? "taken" : "kept",
      }),
    onSuccess: seed,
    onError: (error) => settle(error, t("generatorJob.round.decideFailed")),
  });

  const problemLine =
    problem === undefined ? null : (
      <p role="alert" className="mt-2 text-[12.5px] leading-[1.5] text-destructive">
        {problem}
      </p>
    );

  if (round?.status === "running") {
    return (
      <div data-testid="part-round" data-round="running" className={FRAME}>
        <p role="status" className="text-[13px] leading-[1.55] text-soft">
          {t("generatorJob.round.running")}
        </p>
      </div>
    );
  }

  const serverNotes = part.serverNotes ?? [];
  const findings = <PartFindings kind={part.kind} findings={part.findings ?? []} t={t} />;
  const framedFindings =
    (part.findings ?? []).length === 0 ? null : <div className={FRAME}>{findings}</div>;

  if (round?.status === "done") {
    return (
      <>
        <ModelNotes warnings={part.warnings} serverNotes={serverNotes} title={part.title} />
        {framedFindings}
        <section
          data-testid="part-round"
          data-round="done"
          aria-label={t("generatorJob.round.changes", { count: round.changes.length })}
          className={FRAME}
        >
          <p className="mb-2 text-[12.5px] text-body-secondary">
            {t("generatorJob.round.changes", { count: round.changes.length })}
          </p>
          <ul className="flex flex-col gap-2">
            {round.changes.map((change) => (
              <ChangeRow
                key={change.id}
                kind={part.kind}
                change={change}
                current={current}
                busy={decide.isPending}
                onDecide={(take) => decide.mutate({ id: change.id, take })}
                t={t}
              />
            ))}
          </ul>
          {problemLine}
        </section>
      </>
    );
  }

  if (part.warnings.length === 0) {
    return (
      <>
        <ModelNotes warnings={[]} serverNotes={serverNotes} title={part.title} />
        {framedFindings}
        {problemLine}
      </>
    );
  }
  const ready = part.warnings.some((note) => (answers[note] ?? "").trim() !== "");
  return (
    <form
      data-testid="part-notes"
      data-round={round?.status ?? "open"}
      className={FRAME}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !send.isPending) send.mutate();
      }}
    >
      <ServerNoteList notes={serverNotes} title={part.title} className="mb-2.5" />
      {framedFindings === null ? null : <div className="mb-2.5">{findings}</div>}
      {round?.status === "failed" && (
        <p role="alert" className="mb-2 text-[12.5px] leading-[1.5] text-destructive">
          {t("generatorJob.round.failed")}
        </p>
      )}
      <ul aria-label={t("generatorJob.notes.label")} className="flex flex-col gap-2.5">
        {part.warnings.map((note, index) => (
          <NoteAnswer
            key={`${index}:${note}`}
            note={note}
            answer={answers[note] ?? ""}
            onAnswer={(value) => setAnswers((previous) => ({ ...previous, [note]: value }))}
            kept={kept[note] === true}
            onKept={(value) => setKept((previous) => ({ ...previous, [note]: value }))}
          />
        ))}
      </ul>
      <div className="mt-2.5 flex justify-end">
        <Button
          type="submit"
          size="sm"
          data-testid="part-round-send"
          disabled={!ready || send.isPending}
          className="h-auto px-3 py-1 text-[12.5px]"
        >
          {t(send.isPending ? "generatorJob.round.sending" : "generatorJob.round.send")}
        </Button>
      </div>
      {problemLine}
    </form>
  );
}

/** A block as a finding quotes it: on one line, and not endless. */
function quotedBlock(anchor: string): string {
  const line = anchor.replace(/\s+/g, " ").trim();
  return line.length > 240 ? `${line.slice(0, 240)}…` : line;
}

/** A field as a finding names it: its label, or its name when the entity has no such field. */
function fieldName(kind: GeneratorJobPart["kind"], field: string, t: Translate): string {
  const label = FIELD_LABEL[kind][field];
  return label === undefined ? field : t(label);
}

/** One finding as a whole sentence of the catalog. */
function findingSentence(kind: GeneratorJobPart["kind"], finding: PatchFinding, t: Translate): string {
  switch (finding.kind) {
    case "unreadable":
      return t("generatorJob.finding.unreadable");
    case "anchor_missing":
    case "anchor_ambiguous":
    case "text_empty":
      return t(`generatorJob.finding.${finding.kind}`, { anchor: quotedBlock(finding.anchor) });
    case "callouts_unknown":
      return t("generatorJob.finding.callouts_unknown", {
        anchor: quotedBlock(finding.anchor),
        callouts: finding.callouts.map((callout) => `[!${callout}]`).join(", "),
      });
    case "refs_unknown":
      return t("generatorJob.finding.refs_unknown", {
        anchor: quotedBlock(finding.anchor),
        ids: finding.ids.join(", "),
      });
    case "field_unknown":
      return t("generatorJob.finding.field_unknown", { field: finding.field });
    case "field_empty":
    case "field_invalid":
      return t(`generatorJob.finding.${finding.kind}`, { field: fieldName(kind, finding.field, t) });
    case "chapter_outside":
      return t("generatorJob.finding.chapter_outside", { chapter: finding.chapter });
    case "ids_unknown":
      return t("generatorJob.finding.ids_unknown", {
        field: fieldName(kind, finding.field, t),
        ids: finding.ids.join(", "),
      });
  }
}

/** What the last round could not apply, one sentence each. */
export function PartFindings({
  kind,
  findings,
  t,
}: {
  kind: GeneratorJobPart["kind"];
  findings: readonly PatchFinding[];
  t: Translate;
}) {
  if (findings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {findings.map((finding, index) => (
        <li
          key={index}
          data-testid="part-finding"
          data-finding-kind={finding.kind}
          className="flex items-start gap-2 text-[13px] leading-[1.55] text-soft"
        >
          <CircleSlash aria-hidden size={14} className="mt-[3px] flex-none text-muted-foreground" />
          <span>{findingSentence(kind, finding, t)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One model note with the DM's answer to it, and whether that answer is kept
 * as campaign knowledge — only an answer that says something can be.
 */
function NoteAnswer({
  note,
  answer,
  onAnswer,
  kept,
  onKept,
}: {
  note: string;
  answer: string;
  onAnswer: (value: string) => void;
  kept: boolean;
  onKept: (value: boolean) => void;
}) {
  const t = useT();
  const noteId = useId();
  const keptId = useId();
  const blank = answer.trim() === "";
  return (
    <li className="flex flex-col gap-1.5">
      <span id={noteId} className="flex items-start gap-2 text-[13px] leading-[1.55] text-soft">
        <StickyNote aria-hidden size={14} className="mt-[3px] flex-none text-primary" />
        <span>{note}</span>
      </span>
      <AutoGrowTextarea
        value={answer}
        minRows={1}
        data-testid="part-note-answer"
        aria-label={t("generatorJob.round.answer")}
        aria-describedby={noteId}
        placeholder={t("generatorJob.round.answerPlaceholder")}
        onChange={(event) => onAnswer(event.target.value)}
        className="text-[13px]"
      />
      <label
        htmlFor={keptId}
        className={cn(
          "flex cursor-pointer items-start gap-2 text-[12.5px] leading-[1.5] text-body-secondary",
          blank && "cursor-not-allowed opacity-60",
        )}
      >
        <Checkbox
          id={keptId}
          data-testid="part-note-knowledge"
          checked={kept && !blank}
          disabled={blank}
          onCheckedChange={(state) => onKept(state === true)}
          className="mt-[2px]"
        />
        {t("generatorJob.round.keepAsKnowledge")}
      </label>
    </li>
  );
}

/**
 * One change: what stands there, what would, and take ⇄ discard. `accepted`
 * marks the side the change stands on, where it has one; a round's change
 * has none until it is decided and leaves.
 */
export function ChangeRow({
  kind,
  change,
  current,
  busy,
  accepted,
  onDecide,
  t,
}: {
  kind: GeneratorJobPart["kind"];
  change: PartChange;
  current: Readonly<Record<string, unknown>>;
  busy: boolean;
  accepted?: boolean;
  onDecide: (take: boolean) => void;
  t: Translate;
}) {
  const unit = changeUnit(kind, change, t);
  return (
    <li
      data-testid="part-change"
      data-change-op={change.op}
      className="rounded-md border border-border bg-card px-3 py-2.5"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
          {unit}
        </span>
        <StateBadge state={changeState(change, current)} t={t} />
        <DecisionToggle accepted={accepted} onDecide={onDecide} unit={unit} disabled={busy} t={t} />
      </div>
      <ChangeBody change={change} current={current} t={t} />
    </li>
  );
}

/** What a change is about, in the words of the UI: the field's label or the block's type. */
function changeUnit(kind: GeneratorJobPart["kind"], change: PartChange, t: Translate): string {
  if (change.op === "set") {
    const label = FIELD_LABEL[kind][change.field];
    return label === undefined ? change.field : t(label);
  }
  const block = parseBlocks(change.op === "insertAfter" ? change.text : change.block)[0];
  return block === undefined ? t("composer.blockType.text") : blockLabel(block, t);
}

function changeState(
  change: PartChange,
  current: Readonly<Record<string, unknown>>,
): "new" | "changed" | "removed" {
  if (change.op === "insertAfter") return "new";
  if (change.op === "remove") return "removed";
  if (change.op === "set") return formatFieldValue(current[change.field]) === "" ? "new" : "changed";
  return "changed";
}

function ChangeBody({
  change,
  current,
  t,
}: {
  change: PartChange;
  current: Readonly<Record<string, unknown>>;
  t: Translate;
}) {
  if (change.op === "set") {
    const before = formatFieldValue(current[change.field]);
    const after = formatFieldValue(change.value);
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] leading-[1.5]">
        <dt className="text-[11.5px] text-muted-foreground">{t("augment.field.current")}</dt>
        <dd className={cn("text-body-secondary", before === "" && "text-faint italic")}>
          {before === "" ? t("augment.field.empty") : before}
        </dd>
        <dt className="text-[11.5px] text-muted-foreground">{t("augment.field.proposed")}</dt>
        <dd className={cn("text-foreground", after === "" && "text-faint italic")}>
          {after === "" ? t("augment.field.empty") : after}
        </dd>
      </dl>
    );
  }
  if (change.op === "replace") return <WordDiffText tokens={wordDiff(change.block, change.text)} t={t} />;
  return (
    <pre
      className={cn(
        "font-serif text-[13.5px] leading-[1.6] whitespace-pre-wrap",
        change.op === "remove" ? "text-muted-foreground line-through" : "text-body-secondary",
      )}
    >
      {change.op === "remove" ? change.block : change.text}
    </pre>
  );
}
