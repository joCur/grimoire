// Edit mode of the reading view (issue #15): „Bearbeiten" in the header of a
// scene/NPC/Ort/Kapitel swaps the rendered body for the raw markdown editor —
// same component the generator review uses, so the surface is familiar.
//
// What the DM sees stays the same page: the header (title, chips, status
// regler) keeps standing, only the body below it becomes editable. The
// frontmatter is not part of this by design — the status regler and the rename
// action own the structured fields.
//
// Losing work is the one real risk here, so:
//   * a conflict (409) keeps the text and only says „Datei extern geändert" —
//     the next „Speichern" carries the mtime the re-read brought and works,
//   * a failed write keeps the text as well,
//   * „Abbrechen" with unsaved changes asks first (Dialog, never window.confirm),
//   * a body-neutral new version of the file (the status regler right next to
//     the editor writes one) is adopted silently instead of turning the DM's
//     own click into a conflict.

import type { FileResponse } from "@grimoire/shared/types";
import { PenLine } from "lucide-react";
import { useEffect, useState } from "react";

import { HeaderAction } from "@/components/HeaderAction";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { hasBodyChanges, shouldAdvanceBase } from "@/lib/file-body";
import { useFileBodyMutation } from "@/lib/use-file-body";

/**
 * The quiet header trigger, in the same vocabulary as „Umbenennen" and the
 * campaign metadata action next to it — hence the shared HeaderAction.
 */
export function FileBodyEditAction({ onEdit }: { onEdit: () => void }) {
  return <HeaderAction icon={PenLine} label="Bearbeiten" onClick={onEdit} />;
}

/** A textarea id that survives any path (same rule as the generator cards). */
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
  const [draft, setDraft] = useState(file.body);
  // `file` is the ["file", campaign, path] query data, so this sees every
  // refetch and every write that seeds the cache — the status patch included.
  useEffect(() => {
    if (shouldAdvanceBase(base, file)) setBase(file);
  }, [base, file]);
  const [editing, setEditing] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { save, isSaving, message } = useFileBodyMutation(campaign, base.path, base.mtimeMs, {
    onSaved: onClose,
    onConflict: (reread) => {
      // The draft stays — only the version underneath it moves on, so the
      // next „Speichern" writes on top of what is on disk now.
      if (reread !== undefined) setBase(reread);
    },
  });

  const dirty = hasBodyChanges(base.body, draft);
  const cancel = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  return (
    <div>
      <MarkdownEditor
        value={draft}
        onChange={setDraft}
        editing={editing}
        onToggleEditing={() => setEditing((wasEditing) => !wasEditing)}
        id={textareaIdFor(base.path)}
        label={`Markdown-Text der Datei ${base.path}`}
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
            <Button
              type="button"
              onClick={() => save(draft)}
              disabled={!dirty || isSaving}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {isSaving ? "Speichere …" : "Speichern"}
            </Button>
          </>
        }
      />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[12px] text-faint">
          Nur der Textkörper — Frontmatter bleibt unverändert.
        </p>
        <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
          {message ?? ""}
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
              Der bearbeitete Text ist nicht gespeichert. Verwerfen schließt den Editor und zeigt
              die Datei wieder so, wie sie auf der Platte steht.
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
