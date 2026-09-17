// Edit mode of the reading view (issue #15): „Bearbeiten" in the header of a
// scene/NPC/Ort/Kapitel swaps the rendered text of the entry for the editor.
//
// Since issue #43 that editor has TWO surfaces over ONE draft:
//
//   „Blöcke" (default)  the block composer — the scene as a list of typed
//                       forms, the way a phone can edit it.
//   „Markdown"          the markdown textarea from issue #39, with its
//                       „Vorschau" of the whole rendered text — the
//                       fallback for everything a form does not model.
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
//   * a conflict (409) keeps the draft and only says „Inzwischen geändert" —
//     the next „Speichern" carries the rev the re-read brought and works,
//   * a failed write keeps the draft as well,
//   * „Abbrechen" with unsaved changes asks first (Dialog, never window.confirm),
//   * a body-neutral new version of the entry (the status regler right next to
//     the editor writes one) is adopted silently instead of turning the DM's
//     own click into a conflict,
//   * a block list that would come back DIFFERENT from what it shows (a `##`
//     typed into an If-section's child moves the whole branch on the next
//     parse) blocks the save until the DM decides — composerIssues, the same
//     seam „Eigenschaften" uses for an unfinished quickstat row.

import type { EntryResponse } from "@grimoire/shared/types";
import { PenLine } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BlockComposer, ComposerModeToggle } from "@/components/BlockComposer";
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
  composerIssues,
  draftBody,
  withDraftBlocks,
  withDraftMode,
  withDraftText,
} from "@/lib/composer";
import { hasBodyChanges, shouldAdvanceBase } from "@/lib/entry-body";
import { useEntryBodyMutation } from "@/lib/use-entry-body";

/**
 * The quiet header trigger, in the same vocabulary as „Eigenschaften" and the
 * campaign metadata action next to it — hence the shared HeaderAction.
 */
export function EntryBodyEditAction({ onEdit }: { onEdit: () => void }) {
  const t = useT();
  return <HeaderAction icon={PenLine} label={t("common.edit")} onClick={onEdit} />;
}

/** One shared empty record — „Markdown" has no per-block issues and needs no object. */
const EMPTY_ISSUES: Record<string, string> = {};

/**
 * A DOM id that survives any path (same rule as the generator cards) — the
 * textarea's id in „Markdown" and the prefix of the block forms' ids in „Blöcke".
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
   * The entry on screen: its `body` seeds the editor once, its rev is what
   * the write is checked against. Later versions are adopted only when they
   * are body-neutral (see `base` below) — mount this component per path
   * (`key`) so a navigation reseeds it.
   */
  file: EntryResponse;
  onClose: () => void;
}) {
  const t = useT();
  // The version this editor is working against — seeded once and deliberately
  // NOT following the entry query: the 5s version poll refetches while the
  // editor is open, and inheriting its rev would turn a foreign edit into a
  // silent overwrite instead of a 409. It moves for exactly two reasons: after
  // a conflict, to the entry the re-read brought, and for a BODY-NEUTRAL new
  // version (shouldAdvanceBase — the status regler next to the editor is the
  // one that produces those).
  const [base, setBase] = useState(file);
  // The block composer is the default surface (PO decision on #43): the DM
  // maintains prose in forms, the textarea is the fallback.
  const [draft, setDraft] = useState(() => composerDraft(file.body));
  // `file` is the ["entry", campaign, path] query data, so this sees every
  // refetch and every write that seeds the cache — the status patch included.
  useEffect(() => {
    if (shouldAdvanceBase(base, file)) setBase(file);
  }, [base, file]);
  // Textarea (true) or rendered preview (false) — the „Markdown" surface's own
  // toggle from issue #39, unchanged. „Blöcke" has no preview of its own: every
  // card already shows its content.
  const [editing, setEditing] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { save, isSaving, message } = useEntryBodyMutation(campaign, base.path, base.rev, {
    onSaved: onClose,
    onConflict: (reread) => {
      // The draft stays — only the version underneath it moves on, so the
      // next „Speichern" writes on top of what is stored now.
      if (reread !== undefined) setBase(reread);
    },
  });

  // The one payload of this editor, whichever surface produced it.
  const body = useMemo(() => draftBody(draft), [draft]);
  const dirty = hasBodyChanges(base.body, body);
  // What the block list would break if it were written now, per block — the
  // same seam „Eigenschaften" uses (PropertiesAction, issue #42): the card
  // says it, the button waits. „Markdown" has no such state: its text IS the entry.
  const issues = useMemo(
    () => (draft.mode === "blocks" ? composerIssues(draft.blocks, t) : EMPTY_ISSUES),
    [draft, t],
  );
  const blocked = Object.keys(issues).length > 0;
  const cancel = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const textareaId = textareaIdFor(base.path);

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
              onClick={() => save(body)}
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
            label={base.path}
            issues={issues}
          />
        ) : (
          <MarkdownEditorSurface
            value={draft.text}
            onChange={(text) => setDraft(withDraftText(text))}
            editing={editing}
            id={textareaId}
            label={t("bodyEditor.markdown.aria", { path: base.path })}
          />
        )}
      </EditorShell>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[12px] text-faint">{t("bodyEditor.hint")}</p>
        {/* A write error wins the line; without one it says why „Speichern"
            is dead, because a disabled button next to a card-level hint is
            otherwise a dead end. */}
        <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
          {/* Why „Speichern" is dead; the block itself carries the details. */}
          {message ?? (blocked ? t("bodyEditor.blocked") : "")}
        </p>
      </div>
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
