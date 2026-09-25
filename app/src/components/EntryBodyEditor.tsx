// Edit mode of the reading view: the edit action in the header swaps the
// rendered text for the editor. `BodyEditor` is the surface, the same on every
// reading view; `EntryBodyEditor` hands it the editing session of a chapter or
// the campaign, and every other reading view hands it its own.
//
// That editor has TWO surfaces over ONE draft:
//
//   blocks (default)  the block composer — the text as a list of typed
//                     forms, the way a phone can edit it.
//   markdown          the raw textarea, with a preview of the whole rendered
//                     text — the fallback for everything a form does not
//                     model.
//
// Switching between them is lossless by construction: the draft is the
// discriminated union of lib/composer.ts, and the switch runs the body through
// serializeBlocks/parseBlocks, which phase 1 proves byte-identical over every
// fixture body. Saving works from either surface — the save path below only
// ever sees `draftBody(draft)`.
//
// What the DM sees stays the same page: the header (title, chips, status
// control) keeps standing, only the body below it becomes editable. Beside
// the text the surface carries the PROSE FIELDS its caller puts there — an
// npc's `motivation`, a location's `atmosphere` (ADR #29): prose the cards
// show, written where prose is written. They share the row's one guard
// (ADR #23), so a save is ONE write of whatever changed, and a forced save
// resends exactly that. Every other field stays with the status control and
// the dialog.
//
// Losing work is the one real risk here, so:
//   * a conflict (409) keeps the draft and puts the shared conflict line under
//     the editor — the DM either continues from the stored text or writes
//     theirs on top of it; nothing is adopted or overwritten on its own,
//   * a failed write keeps the draft as well,
//   * cancelling with unsaved changes asks first (Dialog, never window.confirm),
//   * a block list that would come back DIFFERENT from what it shows (a `##`
//     typed into an If-section's child moves the whole branch on the next
//     parse) blocks the save until the DM decides — composerIssues, the same
//     seam a dialog uses for a field that cannot be written yet.

import type { EntryResponse } from "@grimoire/shared/types";
import { PenLine } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { BlockComposer, ComposerModeToggle } from "@/components/BlockComposer";
import { EditConflict } from "@/components/EditConflict";
import { HeaderAction } from "@/components/HeaderAction";
import {
  EditorShell,
  MarkdownEditorSurface,
  MarkdownEditorToggle,
} from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { bodyEditorChange, hasBodyEditChange, type BodyEditChange } from "@/lib/entry-body";
import { useEntryEdit } from "@/lib/use-entry-edit";

/**
 * The quiet header trigger, in the same vocabulary as the properties action
 * and the campaign metadata action next to it — hence the shared HeaderAction.
 */
export function EntryBodyEditAction({ onEdit }: { onEdit: () => void }) {
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
  return `entry-body-${key.replace(/[^a-zA-Z0-9-]/g, "-")}`;
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

/** The prose fields beside the text: their controls, labels, and what changed in them. */
export interface BodyEditFields<F extends object> {
  controls: ReactNode;
  /** The fields' labels, for the hint under the editor. */
  labels: readonly string[];
  /** The change of the fields that moved — empty when none did. */
  change: F;
}

/** What the surface needs from the editing session behind it. */
export interface BodyEditSession<F extends object = Record<string, unknown>> {
  save: (change: BodyEditChange<F>) => void;
  isSaving: boolean;
  message?: string | undefined;
  /** Present while a write stands refused — the conflict line shows. */
  conflict?: object | undefined;
  reload: () => void;
  forceSave?: (() => void) | undefined;
}

// --- the editor of a chapter and the campaign ---------------------------------------

/**
 * The editor of a chapter or the campaign: its text, written through its
 * editing session.
 */
export function EntryBodyEditor({
  campaign,
  entry,
  onClose,
}: {
  campaign: string;
  /**
   * The row on screen when the edit started: its text seeds the editor and
   * its version is what the write is checked against. Mount this component per
   * path (`key`) so a navigation starts a new editing session.
   */
  entry: EntryResponse;
  onClose: () => void;
}) {
  const draft = useBodyDraft(entry.body);
  const edit = useEntryEdit(campaign, entry.path, entry.rev, {
    onSaved: onClose,
    onReload: (stored) => draft.reseed(stored.body),
    // The text feeds the tree's counts/titles and the search index, so neither
    // the campaign's lists nor the command palette may keep the old text.
    invalidateOnSuccess: [
      ["tree", campaign],
      ["search", campaign],
    ],
  });
  return (
    <BodyEditor
      editorKey={entry.path}
      label={entry.path}
      draft={draft}
      session={{
        ...edit,
        save: (change) => edit.save(change.body === undefined ? {} : { body: change.body }),
      }}
      onClose={onClose}
    />
  );
}

// --- the surface --------------------------------------------------------------------

/**
 * The editing surface itself, the same on every reading view: the text on
 * two surfaces over one draft, the prose fields beside it, the conflict line
 * and the discard guard.
 */
export function BodyEditor<F extends object>({
  editorKey,
  label,
  fields,
  draft: state,
  session: edit,
  onClose,
}: {
  /** What the DOM ids are built from — unique per edited row. */
  editorKey: string;
  /** How the surface is named for assistive technology. */
  label: string;
  /** The prose fields beside the text, when the row has any. */
  fields?: BodyEditFields<F>;
  draft: BodyDraft;
  session: BodyEditSession<F>;
  onClose: () => void;
}) {
  const t = useT();
  const { draft, setDraft } = state;
  const write = bodyEditorChange(state.baseline, state.body, fields?.change);
  // Textarea (true) or rendered preview (false) — the markdown surface's own
  // toggle, unchanged. The block surface has no preview of its own: every card
  // already shows its content.
  const [editing, setEditing] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { isSaving, message } = edit;
  const dirty = hasBodyEditChange(write);
  // What the block list would break if it were written now, per block — the
  // same seam a dialog uses for a field: the card says it, the button waits. The raw surface has no such state: its text IS
  // the row's.
  const issues = useMemo(
    () => (draft.mode === "blocks" ? composerIssues(draft.blocks, t) : EMPTY_ISSUES),
    [draft, t],
  );
  const blocked = Object.keys(issues).length > 0;
  const cancel = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const textareaId = textareaIdFor(editorKey);

  return (
    <div>
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
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={cancel}
              className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              {t("common.cancel")}
            </Button>
            {/* Saving never needs a detour through another surface: the block
                list is the payload just as much as the textarea is. */}
            <Button
              type="button"
              onClick={() => edit.save(write)}
              disabled={!dirty || blocked || isSaving}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {isSaving ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      >
        {fields !== undefined && (
          <div className="mt-3.5 flex flex-col gap-3.5 border-b border-border pb-4">
            {fields.controls}
          </div>
        )}
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
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[12px] text-faint">
          {fields === undefined
            ? t("bodyEditor.hint")
            : t("bodyEditor.hint.withFields", { fields: fields.labels.join(", ") })}
        </p>
        {/* A write error wins the line; without one it says why the save
            button is dead, because a disabled button next to a card-level hint
            is otherwise a dead end. */}
        <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
          {message ?? (blocked ? t("bodyEditor.blocked") : "")}
        </p>
      </div>
      {/* A refused write asks instead of deciding: the draft is untouched and
          both answers stand right under the editor that holds it. */}
      {edit.conflict !== undefined && (
        <div className="mt-1">
          <EditConflict
            onReload={edit.reload}
            onForce={edit.forceSave}
            busy={isSaving}
          />
        </div>
      )}
      {confirmDiscard && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setConfirmDiscard(false);
          }}
        >
          <DialogContent aria-describedby={undefined} className="max-w-[420px]">
            <DialogTitle>{t("bodyEditor.discard.title")}</DialogTitle>
            <DialogDescription>{t("bodyEditor.discard.description")}</DialogDescription>
            <div className="mt-4 flex items-center justify-end gap-2">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
                >
                  {t("properties.discard.keepEditing")}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose();
                }}
                className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
              >
                {t("common.discard")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
