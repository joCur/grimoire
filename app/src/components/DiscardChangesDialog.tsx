// The "discard changes?" question of an editor whose cancel would lose typed
// work: keep editing (the safe choice, also what Esc and the backdrop mean)
// or discard and leave. A real dialog, never window.confirm.

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

export function DiscardChangesDialog({
  onKeep,
  onDiscard,
}: {
  /** The question is answered with "keep editing" — nothing changes. */
  onKeep: () => void;
  /** The typed work is dropped; the caller leaves its editor. */
  onDiscard: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onKeep();
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
            onClick={onDiscard}
            className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
          >
            {t("common.discard")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
