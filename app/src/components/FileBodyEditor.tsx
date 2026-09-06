// Edit mode of the reading view (issue #15): „Bearbeiten" in the header of a
// scene/NPC/Ort/Kapitel swaps the rendered body for the editor.
//
// Since issue #43 that editor has TWO surfaces over ONE draft:
//
//   „Blöcke" (default)  the block composer — the scene as a list of typed
//                       forms, the way a phone can edit it.
//   „Roh"               the markdown textarea from issue #39, with its
//                       „Vorschau" of the whole rendered document — the
//                       fallback for everything a form does not model.
//
// Switching between them is lossless by construction: the draft is the
// discriminated union of lib/composer.ts, and the switch runs the body through
// serializeBlocks/parseBlocks, which phase 1 of #43 proves byte-identical over
// all of examples/. Saving works from either surface — the save path below only
// ever sees `draftBody(draft)`.
//
// What the DM sees stays the same page: the header (title, chips, status
// regler) keeps standing, only the body below it becomes editable. The
// frontmatter is not part of this by design — the status regler and the rename
// action own the structured fields.
//
// Losing work is the one real risk here, so:
//   * a conflict (409) keeps the draft and only says „Inzwischen geändert" —
//     the next „Speichern" carries the mtime the re-read brought and works,
//   * a failed write keeps the draft as well,
//   * „Abbrechen" with unsaved changes asks first (Dialog, never window.confirm),
//   * a body-neutral new version of the file (the status regler right next to
//     the editor writes one) is adopted silently instead of turning the DM's
//     own click into a conflict,
//   * a block list that would come back DIFFERENT from what it shows (a `##`
//     typed into an If-section's child moves the whole branch on the next
//     parse) blocks the save until the DM decides — composerIssues, the same
//     seam „Eigenschaften" uses for an unfinished quickstat row.

import type { FileResponse } from "@grimoire/shared/types";
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
import {
  composerDraft,
  composerIssues,
  draftBody,
  withDraftBlocks,
  withDraftMode,
  withDraftText,
} from "@/lib/composer";
import { hasBodyChanges, shouldAdvanceBase } from "@/lib/file-body";
import { useFileBodyMutation } from "@/lib/use-file-body";

/**
 * The quiet header trigger, in the same vocabulary as „Umbenennen" and the
 * campaign metadata action next to it — hence the shared HeaderAction.
 */
export function FileBodyEditAction({ onEdit }: { onEdit: () => void }) {
  return <HeaderAction icon={PenLine} label="Bearbeiten" onClick={onEdit} />;
}

/** One shared empty record — „Roh" has no per-block issues and needs no object. */
const EMPTY_ISSUES: Record<string, string> = {};

/** Why „Speichern" is dead; the block itself carries the details. */
const BLOCKED_NOTE = "Ein Block muss noch geklärt werden — siehe Hinweis am Block.";

/**
 * A DOM id that survives any path (same rule as the generator cards) — the
 * textarea's id in „Roh" and the prefix of the block forms' ids in „Blöcke".
 */
function textareaIdFor(path: string): string {
  return `file-body-${path.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

export function FileBodyEditor({
  campaign,
  file,
  onClose,
}: {
  campaign: string;
  /**
   * The file on screen: its `body` seeds the editor once, its mtime is what
   * the write is checked against. Later versions are adopted only when they
   * are body-neutral (see `base` below) — mount this component per path
   * (`key`) so a navigation reseeds it.
   */
  file: FileResponse;
  onClose: () => void;
}) {
  // The version this editor is working against — seeded once and deliberately
  // NOT following the file query: the 5s version poll refetches while the
  // editor is open, and inheriting its mtime would turn a foreign edit into a
  // silent overwrite instead of a 409. It moves for exactly two reasons: after
  // a conflict, to the file the re-read brought, and for a BODY-NEUTRAL new
  // version (shouldAdvanceBase — the status regler next to the editor is the
  // one that produces those).
  const [base, setBase] = useState(file);
  // The block composer is the default surface (PO decision on #43): the DM
  // maintains prose in forms, the textarea is the fallback.
  const [draft, setDraft] = useState(() => composerDraft(file.body));
  // `file` is the ["file", campaign, path] query data, so this sees every
  // refetch and every write that seeds the cache — the status patch included.
  useEffect(() => {
    if (shouldAdvanceBase(base, file)) setBase(file);
  }, [base, file]);
  // Textarea (true) or rendered preview (false) — the „Roh" surface's own
  // toggle from issue #39, unchanged. „Blöcke" has no preview of its own: every
  // card already shows its content.
  const [editing, setEditing] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { save, isSaving, message } = useFileBodyMutation(campaign, base.path, base.mtimeMs, {
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
  // same seam „Eigenschaften" uses (FrontmatterAction, issue #42): the card
  // says it, the button waits. „Roh" has no such state: its text IS the file.
  const issues = useMemo(
    () => (draft.mode === "blocks" ? composerIssues(draft.blocks) : EMPTY_ISSUES),
    [draft],
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
            {draft.mode === "raw" && (
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
              Abbrechen
            </Button>
            {/* Saving never needs a detour through another surface: the block
                list is the payload just as much as the textarea is. */}
            <Button
              type="button"
              onClick={() => save(body)}
              disabled={!dirty || blocked || isSaving}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {isSaving ? "Speichere …" : "Speichern"}
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
            label={`Markdown-Text von ${base.path}`}
          />
        )}
      </EditorShell>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[12px] text-faint">
          Nur der Textkörper — Frontmatter bleibt unverändert.
        </p>
        {/* A write error wins the line; without one it says why „Speichern"
            is dead, because a disabled button next to a card-level hint is
            otherwise a dead end. */}
        <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
          {message ?? (blocked ? BLOCKED_NOTE : "")}
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
            <DialogTitle>Änderungen verwerfen?</DialogTitle>
            <DialogDescription>
              Die Änderungen sind nicht gespeichert. Verwerfen schließt den Editor und zeigt den
              Eintrag wieder so, wie er gespeichert ist.
            </DialogDescription>
            <div className="mt-4 flex items-center justify-end gap-2">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
                >
                  Weiter bearbeiten
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
                Verwerfen
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
