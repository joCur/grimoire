// The notes of a generator run, where the review shows them
// (decisions/generator):
//
//   model notes   what the model noted about ONE proposal stand under its
//                 card's header; what it noted about the whole run stands
//                 above the stages as one compact block. From three on a list
//                 starts folded, and its summary counts.
//   naming hints  the naming check's findings stand at the field they name or
//                 at the block of the body their line sits in, handed to the
//                 card as place notes (components/place-notes.tsx) and bound
//                 to that place with `aria-describedby`. A card that shows
//                 neither its fields nor its body lists them, naming where
//                 each one sits.
//
// None of it is a live region: the notes do not change while they are there,
// and the review announces its progress in one place only.

import type { NamingHint } from "@grimoire/shared/generator-job";
import { SpellCheck, StickyNote } from "lucide-react";

import type { PlaceNote, PlaceNotes } from "@/components/place-notes";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";

import { hintRef, type ProposalRef } from "./generator-job-state";

/** From this many notes on, a list starts folded. */
const FOLD_FROM = 3;

const SUMMARY =
  "cursor-pointer rounded text-[12.5px] text-body-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function NoteList({ warnings, className }: { warnings: readonly string[]; className?: string }) {
  const t = useT();
  return (
    <ul aria-label={t("generatorJob.notes.label")} className={cn("flex flex-col gap-1.5", className)}>
      {warnings.map((warning, index) => (
        <li key={`${index}:${warning}`} className="flex items-start gap-2 text-[13px] leading-[1.55] text-soft">
          <StickyNote aria-hidden size={14} className="mt-[3px] flex-none text-primary" />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  );
}

/** What the model noted about one proposal, under its card's header. */
export function ModelNotes({ warnings }: { warnings: readonly string[] }) {
  const t = useT();
  if (warnings.length === 0) return null;
  const frame =
    "mb-3 rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-3 py-2";
  if (warnings.length < FOLD_FROM) {
    return (
      <div data-testid="part-notes" className={frame}>
        <NoteList warnings={warnings} />
      </div>
    );
  }
  return (
    <details data-testid="part-notes" className={frame}>
      <summary className={SUMMARY}>
        {t("generatorJob.notes.summary", { count: warnings.length })}
      </summary>
      <NoteList warnings={warnings} className="mt-2" />
    </details>
  );
}

/** What the model noted about the whole run, above the stages. */
export function RunNotes({ warnings }: { warnings: readonly string[] }) {
  const t = useT();
  if (warnings.length === 0) return null;
  return (
    <details
      data-testid="run-notes"
      open={warnings.length < FOLD_FROM}
      className="mb-[22px] rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-3.5 py-2.5"
    >
      <summary className={SUMMARY}>
        {t("generatorJob.runNotes.summary", { count: warnings.length })}
      </summary>
      <NoteList warnings={warnings} className="mt-2" />
    </details>
  );
}

/** Where a naming hint stands, which is what its sentence says about the place. */
type HintPlace = "field" | "block" | "text";

/** The label of each field a naming hint can name, per kind of proposal. */
const FIELD_LABEL: Record<ProposalRef["kind"], Readonly<Record<string, MessageKey>>> = {
  scene: {
    title: "properties.scene.title.label",
    trigger: "properties.scene.trigger.label",
  },
  npc: {
    name: "properties.npc.name.label",
    role: "properties.npc.role.label",
    voice: "properties.npc.voice.label",
    appearance: "properties.npc.appearance.label",
    motivation: "properties.npc.motivation.label",
    statblock: "properties.npc.statblock.label",
  },
  location: {
    name: "properties.location.name.label",
    atmosphere: "properties.location.atmosphere.label",
  },
};

/** One naming hint as a sentence at its place. */
function NamingHintNote({
  id,
  hint,
  place,
  fieldLabel,
}: {
  id: string;
  hint: NamingHint;
  place: HintPlace;
  fieldLabel: MessageKey | undefined;
}) {
  const t = useT();
  const words = { from: hint.from, to: hint.to };
  const sentence =
    hint.line !== undefined
      ? t(place === "block" ? "generatorJob.hint.block" : "generatorJob.hint.text", words)
      : fieldLabel === undefined
        ? t("generatorJob.hint.proposal", words)
        : t("generatorJob.hint.field", { ...words, field: t(fieldLabel) });
  return (
    <p
      id={id}
      data-testid="naming-hint"
      data-field={hint.field}
      className="flex items-start gap-1.5 text-[12px] leading-[1.5] text-muted-foreground"
    >
      <SpellCheck aria-hidden size={13} className="mt-[2px] flex-none" />
      <span className="flex flex-col">
        <span>{sentence}</span>
        {/* Where the hint does not stand at the very text, the text comes with it. */}
        {place !== "field" && <span className="text-faint">{hint.excerpt}</span>}
      </span>
    </p>
  );
}

/**
 * The naming hints of one proposal as notes at their places: a field's at the
 * field, a body line's at its block. `listed` is for a card that shows
 * neither — each hint then says where it sits.
 */
export function hintPlaceNotes(hints: readonly NamingHint[], listed = false): PlaceNotes {
  const fields: Record<string, PlaceNote[]> = {};
  const lines: Array<{ line: number; note: PlaceNote }> = [];
  hints.forEach((hint, index) => {
    const proposal = hintRef(hint);
    const id = `naming-hint-${proposal.kind}-${proposal.id}-${index}`;
    const fieldLabel = FIELD_LABEL[proposal.kind][hint.field];
    if (hint.line === undefined) {
      const note: PlaceNote = {
        id,
        node: (
          <NamingHintNote
            id={id}
            hint={hint}
            place={listed ? "text" : "field"}
            fieldLabel={fieldLabel}
          />
        ),
      };
      (fields[hint.field] ??= []).push(note);
      return;
    }
    lines.push({
      line: hint.line,
      note: {
        id,
        node: (
          <NamingHintNote
            id={id}
            hint={hint}
            place={listed ? "text" : "block"}
            fieldLabel={fieldLabel}
          />
        ),
      },
    });
  });
  return { fields, lines };
}
