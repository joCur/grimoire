// "NPC-Stub anlegen" (issue #10): a stub needs an id the DM chooses — the
// ids are the stable reference keys of the format (README), so the review
// proposes a kebab-case slug derived from the log text and lets it be
// edited. Optional display name; the entry text becomes the `## Notizen`
// line. A 409 from the server (slug exists) is shown inline — the dialog
// stays open so the id can be corrected.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { deriveNpcSlug, isNpcSlug, npcNameFromText } from "@/lib/review";
import type { ReviewEntry } from "@/lib/use-review";

interface NpcStubDialogProps {
  entry: ReviewEntry;
  pending: boolean;
  /** Inline error (e.g. "npcs/fenn.md existiert schon"). */
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (values: { id: string; name?: string }) => void;
}

export function NpcStubDialog({
  entry,
  pending,
  error,
  onClose,
  onSubmit,
}: NpcStubDialogProps) {
  const [id, setId] = useState(() => deriveNpcSlug(entry.text));
  const [name, setName] = useState(() => npcNameFromText(entry.text) ?? "");

  const trimmedId = id.trim();
  const trimmedName = name.trim();
  const idInvalid = trimmedId !== "" && !isNpcSlug(trimmedId);
  const canSubmit = trimmedId !== "" && !idInvalid && !pending;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>NPC-Stub anlegen</DialogTitle>
        <DialogDescription>
          Legt npcs/&lt;id&gt;.md mit status: unknown an; der Eintrag landet unter ## Notizen.
        </DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            onSubmit(trimmedName === "" ? { id: trimmedId } : { id: trimmedId, name: trimmedName });
          }}
          className="mt-4 flex flex-col gap-3.5"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-body-secondary">id (wird der Dateiname)</span>
            <input
              // Radix focuses the first focusable element on open — this input.
              value={id}
              onChange={(e) => setId(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={idInvalid}
              className="w-full rounded-md border border-input bg-panel-deep px-3 py-2 font-mono text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground max-md:text-[16px]"
              placeholder="alte-fischerin"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-body-secondary">Name (optional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className="w-full rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground max-md:text-[16px]"
              placeholder="Alte Fischerin"
            />
          </label>

          <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
            {idInvalid
              ? "id braucht Kleinbuchstaben, Ziffern und einzelne Bindestriche."
              : (error ?? "")}
          </p>

          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
              >
                Abbrechen
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              Anlegen
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
