// The question before a row goes to the trash (decisions/trash): what happens
// to it, in whole sentences, and two answers — keep it (the safe choice, also
// what Esc and the backdrop mean) or put it in the trash.
//
// A UI building block without knowledge of entities: the caller brings the
// title, the sentences that say what goes to the trash and for how long, and
// whether unsaved work is lost with it. A refusal (something still names the
// row, or it changed elsewhere) keeps the dialog open and stands in it as a
// sentence, so the DM reads why right where they asked.

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

export function TrashDialog({
  title,
  sentences,
  unsaved,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  /** The question, naming the kind of row. */
  title: string;
  /** What happens, one whole sentence each. */
  sentences: readonly string[];
  /** The edit mode holds unsaved changes, which the trash discards. */
  unsaved: boolean;
  /** Why the last attempt wrote nothing, as a sentence. */
  error?: string | undefined;
  busy: boolean;
  onConfirm: () => void;
  /** The question is answered with "keep it" — nothing changes. */
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onCancel();
      }}
    >
      <DialogContent className="max-w-[440px]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-1.5">
            {sentences.map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
            {unsaved && <p className="text-warn">{t("editMode.delete.unsaved")}</p>}
          </div>
        </DialogDescription>
        {error !== undefined && (
          <p role="alert" className="mt-3 text-[12.5px] leading-[1.5] text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
            className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
          >
            {busy ? t("editMode.delete.deleting") : t("editMode.delete.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
