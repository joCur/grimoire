// The two sections a generator review edits a proposal in: its fields, in
// the form of its dialog, and its text, on the surfaces of the body editor.
// Each proposal builds its editor from them with its own fields
// (scene/SceneProposalCard.tsx, npc/NpcProposalCard.tsx).
//
// A proposal is not written yet, so nothing here brings the write plumbing
// along — no version guard, no save action, no conflict line. The sections
// report every change upwards and the review keeps it on the job, debounced
// (lib/use-job-review.ts). What they DO bring is the vocabulary:
//
//   fields  the heading and the proposal's label as the read-only id beside
//           the controls its caller renders — the id is fixed there and here
//           (ADR #21).
//   text    the mode toggle of the block composer over the same two surfaces
//           the body editor offers: the block cards, or the raw textarea with
//           its preview.
//
// The text is seeded ONCE, so a section is mounted per proposal: re-reading
// it out of the props would fight the keystroke that produced it.

import type { ReactNode } from "react";
import { useState } from "react";

import { BlockComposer, ComposerModeToggle } from "@/components/BlockComposer";
import { MarkdownEditorSurface, MarkdownEditorToggle } from "@/components/MarkdownEditor";
import { useT } from "@/i18n";
import {
  composerDraft,
  draftBody,
  withDraftBlocks,
  withDraftMode,
  withDraftText,
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
export function DraftFieldsSection({ label, children }: { label: string; children: ReactNode }) {
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
 * The body of a proposal on the two surfaces, and — above them, as on the
 * body editor — the prose fields its caller edits beside the text.
 */
export function DraftBodySection({
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
  const [draft, setDraft] = useState(() => composerDraft(body));
  // Textarea (true) or rendered preview (false) — the raw surface's own
  // toggle. The block surface needs none: every card shows its content.
  const [editing, setEditing] = useState(true);
  const id = idFor(label);
  return (
    <section aria-label={t("generate.review.bodyHeading")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className={OVERLINE}>{t("generate.review.bodyHeading")}</div>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <ComposerModeToggle
            mode={draft.mode}
            onModeChange={(mode) => setDraft(withDraftMode(draft, mode))}
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
        />
      ) : (
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
          onBlur={onFlush}
        />
      )}
    </section>
  );
}
