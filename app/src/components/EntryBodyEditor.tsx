// Edit mode of the reading view: the edit action in the header of a
// scene/NPC/Ort/Kapitel swaps the rendered text of the entry for the editor.
//
// That editor has TWO surfaces over ONE draft:
//
//   blocks (default)  the block composer — the scene as a list of typed
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
// regler) keeps standing, only the body below it becomes editable. The
// properties is not part of this by design — the status regler and the
// properties dialog own the structured fields.
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
//     seam the properties dialog uses for an unfinished quickstat row.

import type { EntryResponse } from "@grimoire/shared/types";
import { PenLine } from "lucide-react";
import { useMemo, useState } from "react";

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
} from "@/lib/composer";
import { hasBodyChanges } from "@/lib/entry-body";
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
 * A DOM id that survives any path (same rule as the generator cards) — the
 * textarea's id on the raw surface and the prefix of the block forms' ids on
 * the block one.
 */
function textareaIdFor(path: string): string {
  return `entry-body-${path.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

export function EntryBodyEditor({
  campaign,
  file,
  onClose,
}: {
  campaign: string;
  /**
   * The entry on screen when the edit started: its text seeds the editor and
   * its version is what the write is checked against. Mount this component per
   * path (`key`) so a navigation starts a new editing session.
   */
  file: EntryResponse;
  onClose: () => void;
}) {
  const t = useT();
  // The block composer is the default surface (PO decision on #43): the DM
  // maintains prose in forms, the textarea is the fallback.
  const [draft, setDraft] = useState(() => composerDraft(file.body));
  // The text the draft was seeded from — what "is there anything to save?" is
  // measured against. It belongs to the version the session writes against, so
  // it moves only when that version does, i.e. when the DM adopts the stored
  // entry after a conflict.
  const [baseline, setBaseline] = useState(file.body);
  // Textarea (true) or rendered preview (false) — the markdown surface's own
  // toggle, unchanged. The block surface has no preview of its own: every card
  // already shows its content.
  const [editing, setEditing] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const edit = useEntryEdit(campaign, file.path, file.rev, {
    onSaved: onClose,
    onReload: (stored) => {
      // The DM chose the stored text: the draft is replaced by it and there is
      // nothing left to save. The SURFACE stays as it is — reseeding is an
      // answer to a conflict, not a reason to move someone off the textarea
      // they were writing in.
      setDraft((current) => composerDraftIn(stored.body, current.mode));
      setBaseline(stored.body);
    },
    // The text feeds the tree's counts/titles and the search index, so neither
    // the campaign's lists nor the command palette may keep the old text.
    invalidateOnSuccess: [
      ["tree", campaign],
      ["search", campaign],
    ],
  });
  const { isSaving, message } = edit;

  // The one payload of this editor, whichever surface produced it.
  const body = useMemo(() => draftBody(draft), [draft]);
  const dirty = hasBodyChanges(baseline, body);
  // What the block list would break if it were written now, per block — the
  // same seam the properties dialog uses (PropertiesAction): the card
  // says it, the button waits. The raw surface has no such state: its text IS
  // the entry.
  const issues = useMemo(
    () => (draft.mode === "blocks" ? composerIssues(draft.blocks, t) : EMPTY_ISSUES),
    [draft, t],
  );
  const blocked = Object.keys(issues).length > 0;
  const cancel = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const textareaId = textareaIdFor(file.path);

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
              onClick={() => edit.save({ body })}
              disabled={!dirty || blocked || isSaving}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {isSaving ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      >
        {draft.mode === "blocks" ? (
          <BlockComposer
            blocks={draft.blocks}
            onChange={(blocks) => setDraft(withDraftBlocks(blocks))}
            idPrefix={textareaId}
            label={file.path}
            issues={issues}
          />
        ) : (
          <MarkdownEditorSurface
            value={draft.text}
            onChange={(text) => setDraft(withDraftText(text))}
            editing={editing}
            id={textareaId}
            label={t("bodyEditor.markdown.aria", { path: file.path })}
          />
        )}
      </EditorShell>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[12px] text-faint">{t("bodyEditor.hint")}</p>
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
