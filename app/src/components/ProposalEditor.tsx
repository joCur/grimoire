// The two sections a generator review edits a proposal in: its fields, in
// the form of its dialog, and its text, on the surfaces of the body editor.
// Each proposal builds its editor from them with its own fields
// (scene/SceneProposalCard.tsx, npc/NpcProposalCard.tsx).
//
// A proposal is not written yet, so nothing here brings the write plumbing
// along — no version guard, no save action, no conflict line. The sections
// report every change upwards and the review keeps it on the job, debounced
// (generator-job/use-job-review.ts). What they DO bring is the vocabulary:
//
//   fields  the heading and the proposal's label as the read-only id beside
//           the controls its caller renders — the id is fixed there and here
//           (decisions/constraints).
//   text    the mode toggle of the block composer over the same two surfaces
//           the body editor offers: the block cards, or the raw textarea with
//           its preview.
//
// The text is seeded ONCE, so a section is mounted per proposal: re-reading
// it out of the props would fight the keystroke that produced it.

import { blockAtLine, blockLines, type SceneBlock } from "@grimoire/shared/blocks";
import type { ReactNode } from "react";
import { useState } from "react";

import { BlockComposer, ComposerModeToggle } from "@/components/BlockComposer";
import { MarkdownEditorSurface, MarkdownEditorToggle } from "@/components/MarkdownEditor";
import {
  describedBy,
  PlaceNoteList,
  usePlaceNotes,
  type PlaceNote,
  type PlaceNotes,
} from "@/components/place-notes";
import { useT } from "@/i18n";
import {
  composerDraft,
  draftBody,
  withDraftBlocks,
  withDraftMode,
  withDraftText,
  type ComposerDraft,
} from "@/lib/composer";

const OVERLINE = "text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground";

/** No block of the list can block a save here — there is no save. */
const NO_BLOCK_NOTES: Record<string, string> = {};

/**
 * A DOM id that survives any label (same rule as the body editor): the
 * textarea's id on the raw surface, the prefix of the block forms' ids on the
 * block one.
 */
function idFor(label: string): string {
  return `gen-draft-${label.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

/** The fields of a proposal: the heading, its label as read-only id, the controls. */
export function ProposalFieldsSection({ label, children }: { label: string; children: ReactNode }) {
  const t = useT();
  return (
    <section aria-label={t("generate.review.propertiesHeading")}>
      <div className={OVERLINE}>{t("generate.review.propertiesHeading")}</div>
      {/* The value the form does not own — shown, not editable, exactly as
          in the dialog. */}
      <p className="mt-1.5 text-[12px] text-body-secondary">
        {t("properties.id")} <span className="font-mono text-[12px] text-soft">{label}</span>
      </p>
      <div className="mt-2.5 flex flex-col gap-3.5">{children}</div>
    </section>
  );
}

/**
 * The page's notes on lines of the body, per top-level block of `blocks` —
 * read off the blocks as they were parsed from the text, so a note stays with
 * its block while the DM edits and moves it. A note on a line no block holds
 * is in `rest`.
 */
function notesPerBlock(
  blocks: readonly SceneBlock[],
  lines: PlaceNotes["lines"],
): { byBlock: Record<string, PlaceNote[]>; rest: PlaceNote[] } {
  const spans = blockLines(blocks);
  const byBlock: Record<string, PlaceNote[]> = {};
  const rest: PlaceNote[] = [];
  for (const { line, note } of lines) {
    const index = blockAtLine(spans, line);
    const id = index === undefined ? undefined : blocks[index]?.id;
    if (id === undefined) rest.push(note);
    else (byBlock[id] ??= []).push(note);
  }
  return { byBlock, rest };
}

/** The notes per block of a draft on the block surface; nothing for the text surface. */
function draftNotes(draft: ComposerDraft, lines: PlaceNotes["lines"]) {
  return draft.mode === "blocks" ? notesPerBlock(draft.blocks, lines) : undefined;
}

/**
 * The body of a proposal on the two surfaces, and — above them, as on the
 * body editor — the prose fields its caller edits beside the text. The page's
 * notes on lines of the body stand at their block on the block surface, and
 * under the text on the markdown surface, which has no blocks.
 */
export function ProposalBodySection({
  label,
  body,
  beside,
  onBodyChange,
  onFlush,
}: {
  /** How the proposal names itself — its resource segment and id. */
  label: string;
  /** The body as the review holds it when the editor opens. */
  body: string;
  beside?: ReactNode;
  onBodyChange: (body: string) => void;
  /** Send what is pending now — the text surface calls it on blur. */
  onFlush: () => void;
}) {
  const t = useT();
  const { lines } = usePlaceNotes();
  const [draft, setDraft] = useState(() => composerDraft(body));
  // Where the notes stand is read ONCE per parse: block ids survive every edit
  // of the block list, the lines of an edited block do not.
  const [notes, setNotes] = useState(() => draftNotes(draft, lines));
  // Textarea (true) or rendered preview (false) — the raw surface's own
  // toggle. The block surface needs none: every card shows its content.
  const [editing, setEditing] = useState(true);
  const id = idFor(label);
  const allNotes = lines.map((entry) => entry.note);
  return (
    <section aria-label={t("generate.review.bodyHeading")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className={OVERLINE}>{t("generate.review.bodyHeading")}</div>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <ComposerModeToggle
            mode={draft.mode}
            onModeChange={(mode) => {
              const next = withDraftMode(draft, mode);
              setDraft(next);
              if (next !== draft) setNotes(draftNotes(next, lines));
            }}
          />
          {draft.mode === "markdown" && (
            <MarkdownEditorToggle
              editing={editing}
              onToggleEditing={() => setEditing((wasEditing) => !wasEditing)}
              controlsId={id}
            />
          )}
        </span>
      </div>
      {beside !== undefined && <div className="mt-2.5 flex flex-col gap-3.5">{beside}</div>}
      {draft.mode === "blocks" ? (
        <>
          <BlockComposer
            blocks={draft.blocks}
            onChange={(blocks) => {
              const next = withDraftBlocks(blocks);
              setDraft(next);
              onBodyChange(draftBody(next));
            }}
            idPrefix={id}
            label={label}
            issues={NO_BLOCK_NOTES}
            {...(notes === undefined ? {} : { notes: notes.byBlock })}
          />
          <PlaceNoteList notes={notes?.rest ?? []} className="mt-2" />
        </>
      ) : (
        <>
          <MarkdownEditorSurface
            value={draft.text}
            onChange={(text) => {
              const next = withDraftText(text);
              setDraft(next);
              onBodyChange(draftBody(next));
            }}
            editing={editing}
            id={id}
            label={t("generate.review.bodyLabel", { path: label })}
            describedBy={describedBy(allNotes)}
            onBlur={onFlush}
          />
          <PlaceNoteList notes={allNotes} className="mt-2" />
        </>
      )}
    </section>
  );
}
