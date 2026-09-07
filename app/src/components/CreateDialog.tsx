// The one create dialog (issue #56) — used for Kapitel, Szene, NPC and Ort.
//
// They are the same conversation four times over: type a name, see the id it
// will get, press „Anlegen". So they are one component; four copies of a form
// is how German wording, focus behaviour and the collision handling drift
// apart. The differences that remain are text plus at most one extra field
// (a chapter's optional goal), which is what the props carry.
//
// Why the id is on screen while typing: it is the format's permanent
// reference key (README: „id … NIE ändern"). Deriving it silently would mean
// the DM meets it for the first time in an address, so the quiet line under
// the name field shows exactly what will be created.
//
// The collision is the one branch worth reading. The server writes nothing and
// answers `409 { code: "slug_taken", suggestion }` — no automatic `-2`,
// because that id would be permanent too. The dialog therefore says what is in
// the way and offers the free proposal as ONE click; taking it re-sends the
// same name with that explicit id. The typed values never disappear.

import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  canCreate,
  createConflict,
  createErrorMessage,
  derivedAddress,
  type CreateConflict,
} from "@/lib/create";

export interface CreateValues {
  /** The typed name/title — always sent. */
  name: string;
  /** The optional second field's text (a chapter goal), when the dialog has one. */
  extra?: string;
  /** Only set when the DM took the collision proposal. */
  id?: string;
}

interface CreateDialogProps {
  /** Dialog heading, e.g. „Kapitel anlegen". */
  title: string;
  /** One sentence saying what is created and what happens next. */
  description: string;
  /** Label of the required field („Titel" for a chapter/scene, „Name" else). */
  nameLabel: string;
  namePlaceholder: string;
  /**
   * What the derived id gets prefixed with for the address preview
   * („npcs/", „locations/", „<kapitel>/"). Empty for a campaign.
   */
  addressPrefix: string;
  /** The optional second field. */
  extra?: { label: string; placeholder: string; multiline?: boolean };
  /** Runs the POST. Rejecting with an ApiError is what the dialog reads. */
  create: (values: CreateValues) => Promise<unknown>;
  onClose: () => void;
}

export function CreateDialog({
  title,
  description,
  nameLabel,
  namePlaceholder,
  addressPrefix,
  extra,
  create,
  onClose,
}: CreateDialogProps) {
  const nameId = useId();
  const extraId = useId();
  const [name, setName] = useState("");
  const [extraText, setExtraText] = useState("");
  const [conflict, setConflict] = useState<CreateConflict>();
  const [message, setMessage] = useState("");

  const run = useMutation({
    mutationFn: (values: CreateValues) => create(values),
    onMutate: () => {
      setConflict(undefined);
      setMessage("");
    },
    onError: (error) => {
      setConflict(createConflict(error));
      setMessage(createErrorMessage(error));
    },
  });

  const trimmed = name.trim();
  const address = derivedAddress(trimmed, addressPrefix);
  const canSubmit = canCreate(trimmed) && !run.isPending;

  const submit = (id?: string) => {
    if (!canCreate(trimmed) || run.isPending) return;
    const values: CreateValues = { name: trimmed };
    if (extra !== undefined && extraText.trim() !== "") values.extra = extraText.trim();
    if (id !== undefined) values.id = id;
    run.mutate(values);
  };

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-[460px]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mt-4 flex flex-col gap-3.5"
        >
          <label htmlFor={nameId} className="flex flex-col gap-1.5">
            <span className="text-[12px] text-body-secondary">{nameLabel}</span>
            <input
              id={nameId}
              // Radix focuses the first focusable element on open — this input.
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              placeholder={namePlaceholder}
              className="w-full rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
            />
            {/* The id that will be created — quiet, but never hidden. */}
            <span className="min-h-[16px] font-mono text-[11.5px] text-muted-foreground">
              {address ?? ""}
            </span>
          </label>

          {extra !== undefined && (
            <label htmlFor={extraId} className="flex flex-col gap-1.5">
              <span className="text-[12px] text-body-secondary">{extra.label}</span>
              {extra.multiline === true ? (
                <textarea
                  id={extraId}
                  rows={3}
                  value={extraText}
                  onChange={(e) => setExtraText(e.target.value)}
                  placeholder={extra.placeholder}
                  className="w-full resize-y rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] leading-[1.55] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
                />
              ) : (
                <input
                  id={extraId}
                  value={extraText}
                  onChange={(e) => setExtraText(e.target.value)}
                  autoComplete="off"
                  placeholder={extra.placeholder}
                  className="w-full rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
                />
              )}
            </label>
          )}

          <div aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
            {message}
            {conflict !== undefined && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => submit(conflict.suggestion)}
                  className="rounded-sm text-body-secondary underline underline-offset-2 hover:text-foreground"
                >
                  „{conflict.suggestion}" verwenden
                </button>
              </>
            )}
          </div>

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
              {run.isPending ? "Lege an …" : "Anlegen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
