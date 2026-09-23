// "NPC anlegen": the entry needs an id the DM
// chooses — a log line is prose, and ids are the stable reference keys of the
// format (README) — so the review proposes a kebab-case slug derived from the
// text and lets it be edited. Optional display name; the line's text becomes
// the entry's whole text, with no heading around it.
//
// The id that ALREADY has an entry is not an error: the call is
// idempotent, so the review links to what is there instead of making the DM
// correct an id that was right. Only a server that cannot answer is shown
// inline.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { deriveNpcSlug, isNpcSlug, npcNameFromText } from "@/lib/review";
import type { ReviewEntry } from "@/lib/use-review";

interface NpcCreateDialogProps {
  entry: ReviewEntry;
  pending: boolean;
  /** Inline error (a server that did not answer). */
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (values: { id: string; name?: string }) => void;
}

export function NpcCreateDialog({
  entry,
  pending,
  error,
  onClose,
  onSubmit,
}: NpcCreateDialogProps) {
  const t = useT();
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
        <DialogTitle>{t("create.npc.title")}</DialogTitle>
        <DialogDescription>{t("npcCreate.description")}</DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            onSubmit(trimmedName === "" ? { id: trimmedId } : { id: trimmedId, name: trimmedName });
          }}
          className="mt-4 flex flex-col gap-3.5"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-body-secondary">{t("npcCreate.idLabel")}</span>
            <input
              // Radix focuses the first focusable element on open — this input.
              value={id}
              onChange={(e) => setId(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={idInvalid}
              className="w-full rounded-md border border-input bg-panel-deep px-3 py-2 font-mono text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground max-md:text-[16px]"
              // Generic, like every other create hint: the field is normally
              // prefilled from the log line anyway, and a sample-campaign id
              // in an empty field reads like a default.
              placeholder={t("npcCreate.idPlaceholder")}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-body-secondary">{t("npcCreate.nameLabel")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className="w-full rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground max-md:text-[16px]"
              placeholder={t("create.npc.namePlaceholder")}
            />
          </label>

          <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
            {idInvalid ? t("npcCreate.idInvalid") : (error ?? "")}
          </p>

          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
              >
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {t("common.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
