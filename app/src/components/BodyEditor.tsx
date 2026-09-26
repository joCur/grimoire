// The text surface of every edit mode: an entity's edit mode (scene, npc,
// location, chapter) puts `BodyEditorSurface` into its layout, owns its save
// and cancel elsewhere on the page, and reads what blocks a save from
// `useDraftIssues`. `BodyEditAction` is the quiet header trigger that switches
// a reading view into its edit mode.
//
// The surface has TWO faces over ONE draft:
//
//   blocks (default)  the block composer — the text as a list of typed
//                     forms, the way a phone can edit it.
//   markdown          the raw textarea, with a preview of the whole rendered
//                     text — the fallback for everything a form does not
//                     model.
//
// Switching between them is lossless by construction: the draft is the
// discriminated union of lib/composer.ts, and the switch runs the body through
// serializeBlocks/parseBlocks, which lib/blocks.test.ts proves byte-identical
// over every fixture body. Saving works from either face — the edit mode only
// ever sees `draftBody(draft)`.
//
// A block list that would come back DIFFERENT from what it shows (a `##`
// typed into an If-section's child moves the whole branch on the next parse)
// blocks the save until the DM decides — `useDraftIssues`, shown at the block
// it belongs to.

import { PenLine } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { BlockComposer, ComposerModeToggle } from "@/components/BlockComposer";
import { HeaderAction } from "@/components/HeaderAction";
import {
  EditorShell,
  MarkdownEditorSurface,
  MarkdownEditorToggle,
} from "@/components/MarkdownEditor";
import { useT } from "@/i18n";
import {
  composerDraft,
  composerDraftIn,
  composerIssues,
  draftBody,
  withDraftBlocks,
  withDraftMode,
  withDraftText,
  type ComposerDraft,
} from "@/lib/composer";

/**
 * The quiet header trigger that switches a reading view into its edit mode,
 * in the same vocabulary as the other actions of the header — hence the
 * shared HeaderAction.
 */
export function BodyEditAction({ onEdit }: { onEdit: () => void }) {
  const t = useT();
  return <HeaderAction icon={PenLine} label={t("common.edit")} onClick={onEdit} />;
}

/** One shared empty record — the raw surface has no per-block issues. */
const EMPTY_ISSUES: Record<string, string> = {};

/**
 * A DOM id that survives any key (same rule as the generator cards) — the
 * textarea's id on the raw surface and the prefix of the block forms' ids on
 * the block one.
 */
function textareaIdFor(key: string): string {
  return `body-${key.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

// --- the draft ------------------------------------------------------------------

/** The draft of one edit, and the baseline "is there anything to save?" is measured against. */
export interface BodyDraft {
  draft: ComposerDraft;
  setDraft: (next: ComposerDraft | ((current: ComposerDraft) => ComposerDraft)) => void;
  /** The text the save is measured against. */
  baseline: string;
  /** The text the draft stands for right now. */
  body: string;
  /** Continue from a stored text: the draft and its baseline are replaced by it. */
  reseed: (body: string) => void;
}

/**
 * The draft of the edit surface. The baseline belongs to the version the
 * session writes against, so it moves only when that version does, i.e. when
 * the DM adopts the stored row after a conflict (`reseed`).
 */
export function useBodyDraft(seed: string): BodyDraft {
  // The block composer is the default surface (a PO decision): the DM
  // maintains prose in forms, the textarea is the fallback.
  const [draft, setDraft] = useState(() => composerDraft(seed));
  const [baseline, setBaseline] = useState(seed);
  const body = useMemo(() => draftBody(draft), [draft]);
  return {
    draft,
    setDraft,
    baseline,
    body,
    reseed: (stored) => {
      // The DM chose the stored text: the draft is replaced by it and there is
      // nothing left to save. The SURFACE stays as it is — reseeding is an
      // answer to a conflict, not a reason to move someone off the textarea
      // they were writing in.
      setDraft((current) => composerDraftIn(stored, current.mode));
      setBaseline(stored);
    },
  };
}

/**
 * What the block list would break if it were written now, per block. The raw
 * surface has no such state: its text IS the row's.
 */
export function useDraftIssues(draft: ComposerDraft): Record<string, string> {
  const t = useT();
  return useMemo(
    () => (draft.mode === "blocks" ? composerIssues(draft.blocks, t) : EMPTY_ISSUES),
    [draft, t],
  );
}

// --- the surface --------------------------------------------------------------------

/**
 * The framed text surface: the mode switch, the preview toggle of the raw
 * surface and the caller's toolbar actions, over the block composer or the
 * textarea.
 */
export function BodyEditorSurface({
  editorKey,
  label,
  draft: state,
  issues,
  actions,
}: {
  /** What the DOM ids are built from — unique per edited row. */
  editorKey: string;
  /** How the surface is named for assistive technology. */
  label: string;
  draft: BodyDraft;
  /** From `useDraftIssues` — shown at the block they belong to. */
  issues: Record<string, string>;
  /** The caller's actions at the right end of the toolbar. */
  actions?: ReactNode;
}) {
  const t = useT();
  const { draft, setDraft } = state;
  // Textarea (true) or rendered preview (false) — the markdown surface's own
  // toggle. The block surface has no preview of its own: every card already
  // shows its content.
  const [editing, setEditing] = useState(true);
  const textareaId = textareaIdFor(editorKey);
  return (
    <EditorShell
      controls={
        <>
          <ComposerModeToggle
            mode={draft.mode}
            onModeChange={(mode) => setDraft(withDraftMode(draft, mode))}
          />
          {draft.mode === "markdown" && (
            <MarkdownEditorToggle
              editing={editing}
              onToggleEditing={() => setEditing((wasEditing) => !wasEditing)}
              controlsId={textareaId}
            />
          )}
        </>
      }
      actions={actions}
    >
      {draft.mode === "blocks" ? (
        <BlockComposer
          blocks={draft.blocks}
          onChange={(blocks) => setDraft(withDraftBlocks(blocks))}
          idPrefix={textareaId}
          label={label}
          issues={issues}
        />
      ) : (
        <MarkdownEditorSurface
          value={draft.text}
          onChange={(text) => setDraft(withDraftText(text))}
          editing={editing}
          id={textareaId}
          label={t("bodyEditor.markdown.aria", { path: label })}
        />
      )}
    </EditorShell>
  );
}
