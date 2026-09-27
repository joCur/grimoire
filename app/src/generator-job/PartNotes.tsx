// The notes of a generator run, where the review shows them
// (decisions/generator):
//
//   model notes   what the model noted about ONE proposal stand under its
//                 card's header; what it noted about the whole run stands
//                 above the stages as one compact block. From three on a list
//                 starts folded, and its summary counts. On a finished
//                 part whose proposal is still open, the notes stand with
//                 their answer fields instead (PartRound.tsx).
//   server notes  what the server itself noted about a reply — it had to be
//                 repaired, a scene lacked its source passage — is data, and
//                 its sentence is the catalog's. It stands with the model's
//                 notes, first and marked apart, and nobody answers it.
//   naming hints  the naming check's findings stand at the field they name or
//                 at the block of the body their line sits in, handed to the
//                 card as place notes (components/place-notes.tsx) and bound
//                 to that place with `aria-describedby`. A card that shows
//                 neither its fields nor its body lists them, naming where
//                 each one sits.
//
// None of it is a live region: the notes do not change while they are there,
// and the review announces its progress in one place only.

import type { NamingHint, ServerNote } from "@grimoire/shared/generator-job";
import { Info, SpellCheck, StickyNote } from "lucide-react";

import type { PlaceNote, PlaceNotes } from "@/components/place-notes";
import { useT, type MessageKey, type Translate } from "@/i18n";
import { cn } from "@/lib/utils";

import { hintRef, type ProposalRef } from "./generator-job-state";

/** From this many notes on, a list starts folded. */
const FOLD_FROM = 3;

const SUMMARY =
  "cursor-pointer rounded text-[12.5px] text-body-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function NoteList({ warnings, className }: { warnings: readonly string[]; className?: string }) {
  const t = useT();
  if (warnings.length === 0) return null;
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

/** Where a server note stands: on one proposal, or on the whole run. */
type ServerNoteScope = "proposal" | "run";

/** One server note as a whole sentence of the catalog; `title` names the scene it is about. */
function serverNoteSentence(note: ServerNote, scope: ServerNoteScope, title: string, t: Translate): string {
  switch (note) {
    case "reply_repaired":
      return t(
        scope === "run"
          ? "generatorJob.runServerNote.reply_repaired"
          : "generatorJob.serverNote.reply_repaired",
      );
    case "source_excerpt_unmatched":
      return t("generatorJob.serverNote.source_excerpt_unmatched", { title });
  }
}

/**
 * What the server noted about a reply, one sentence each — marked apart from
 * the model's notes by its icon, and never answered.
 */
export function ServerNoteList({
  notes,
  scope = "proposal",
  title = "",
  className,
}: {
  notes: readonly ServerNote[];
  scope?: ServerNoteScope;
  /** The title of the proposal the notes are about. */
  title?: string;
  className?: string;
}) {
  const t = useT();
  if (notes.length === 0) return null;
  return (
    <ul
      aria-label={t("generatorJob.serverNotes.label")}
      className={cn("flex flex-col gap-1.5", className)}
    >
      {notes.map((note) => (
        <li
          key={note}
          data-testid="server-note"
          data-note-kind={note}
          className="flex items-start gap-2 text-[13px] leading-[1.55] text-soft"
        >
          <Info aria-hidden size={14} className="mt-[3px] flex-none text-muted-foreground" />
          <span>{serverNoteSentence(note, scope, title, t)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The frame the notes of a card and of the run stand in. */
export const NOTES_FRAME =
  "rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]";

/**
 * What the model and the server noted about one proposal, under its card's
 * header — the server's first. `title` is the proposal's, for a server note
 * that names it.
 */
export function ModelNotes({
  warnings,
  serverNotes = [],
  title = "",
}: {
  warnings: readonly string[];
  serverNotes?: readonly ServerNote[];
  title?: string;
}) {
  const t = useT();
  const count = warnings.length + serverNotes.length;
  if (count === 0) return null;
  const frame = cn("mb-3 px-3 py-2", NOTES_FRAME);
  const lists = (
    <>
      <ServerNoteList notes={serverNotes} title={title} />
      <NoteList warnings={warnings} className={serverNotes.length === 0 ? undefined : "mt-1.5"} />
    </>
  );
  if (count < FOLD_FROM) {
    return (
      <div data-testid="part-notes" className={frame}>
        {lists}
      </div>
    );
  }
  return (
    <details data-testid="part-notes" className={frame}>
      <summary className={SUMMARY}>{t("generatorJob.notes.summary", { count })}</summary>
      <div className="mt-2">{lists}</div>
    </details>
  );
}

/** What the model and the server noted about the whole run, above the stages. */
export function RunNotes({
  warnings,
  serverNotes = [],
}: {
  warnings: readonly string[];
  serverNotes?: readonly ServerNote[];
}) {
  const t = useT();
  const count = warnings.length + serverNotes.length;
  if (count === 0) return null;
  return (
    <details
      data-testid="run-notes"
      open={count < FOLD_FROM}
      className={cn("mb-[22px] px-3.5 py-2.5", NOTES_FRAME)}
    >
      <summary className={SUMMARY}>{t("generatorJob.runNotes.summary", { count })}</summary>
      <ServerNoteList notes={serverNotes} scope="run" className="mt-2" />
      <NoteList warnings={warnings} className={serverNotes.length === 0 ? "mt-2" : "mt-1.5"} />
    </details>
  );
}

/** Where a naming hint stands, which is what its sentence says about the place. */
type HintPlace = "field" | "block" | "text";

/**
 * The label of each field of a proposal but its id and its text, per kind —
 * where a naming hint or a change of a patch round names a field.
 */
export const FIELD_LABEL: Record<ProposalRef["kind"], Readonly<Record<string, MessageKey>>> = {
  scene: {
    title: "properties.scene.title.label",
    type: "properties.scene.type.label",
    trigger: "properties.scene.trigger.label",
    chapter: "properties.scene.chapter.label",
    location: "properties.scene.location.label",
    npcs: "properties.scene.npcs.label",
    handouts: "properties.scene.handouts.label",
    tags: "properties.scene.tags.label",
    status: "properties.scene.status.label",
  },
  npc: {
    name: "properties.npc.name.label",
    role: "properties.npc.role.label",
    chapter: "properties.npc.chapter.label",
    status: "properties.npc.status.label",
    statblock: "properties.npc.statblock.label",
    quickstats: "properties.npc.quickstats.label",
    voice: "properties.npc.voice.label",
    appearance: "properties.npc.appearance.label",
    motivation: "properties.npc.motivation.label",
  },
  location: {
    name: "properties.location.name.label",
    chapter: "properties.location.chapter.label",
    roll20Page: "properties.location.roll20.label",
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
