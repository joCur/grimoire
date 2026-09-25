// The dialog a reading view edits its fields in, and the quiet header action
// that opens it. Knows no fields of its own: the caller renders them as the
// dialog's children and says whether there is something to save.
//
// The house pattern: mounted only while open, one aria-live error line, a
// cancel and a save button. A refused write (409) keeps the typed values and
// shows the shared conflict line with its two answers; closing with unsaved
// work asks first.
//
// The action is open BY ROW, not a boolean: the reading route stays mounted
// across a navigation — the command palette works over the modal, Back
// reopens a cached row — and a dialog holding row A's values while the page
// already shows B would write A's change into B. So navigating away closes
// it, and the dialog is keyed by the row.

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { EditConflict } from "@/components/EditConflict";
import { HeaderAction } from "@/components/HeaderAction";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

/** What the dialog needs from the editing session behind it. */
export interface FieldsSession {
  isSaving: boolean;
  message?: string | undefined;
  /** Present while a write stands refused — the conflict line shows. */
  conflict?: object | undefined;
  reload: () => void;
  forceSave?: (() => void) | undefined;
}

/** The form's state: the values it opened with and the typed ones. */
export interface FieldsForm<T> {
  /**
   * What the change is measured against, taken when the form opened — NOT
   * the row behind it, or a write landing in the cache would silently swallow
   * the DM's change. It moves only when the DM adopts the stored row after a
   * conflict.
   */
  initial: T;
  values: T;
  setValues: (next: T) => void;
  /** Refill the form from a stored row: nothing typed any more. */
  reseed: (values: T) => void;
}

export function useFieldsForm<T>(seed: T): FieldsForm<T> {
  const [initial, setInitial] = useState<T>(seed);
  const [values, setValues] = useState<T>(initial);
  return {
    initial,
    values,
    setValues,
    reseed: (refilled) => {
      setInitial(refilled);
      setValues(refilled);
    },
  };
}

/**
 * The header action and its open state. `openKey` names the row the dialog
 * is for; `label` replaces the plain action label where two actions of the
 * same name would stand on one surface.
 */
export function FieldsDialogAction({
  openKey,
  label,
  children,
}: {
  openKey: string;
  label?: string;
  children: (onClose: () => void) => ReactNode;
}) {
  const t = useT();
  const [openFor, setOpenFor] = useState<string>();
  // …and the state is dropped as well, so returning to the row (Back into
  // the react-query cache) does not reopen a dialog nobody asked for.
  useEffect(() => {
    setOpenFor(undefined);
  }, [openKey]);
  return (
    <>
      <HeaderAction
        icon={SlidersHorizontal}
        label={label ?? t("properties.action")}
        onClick={() => setOpenFor(openKey)}
      />
      {openFor === openKey && <Keyed key={openKey}>{children(() => setOpenFor(undefined))}</Keyed>}
    </>
  );
}

/** A plain wrapper, so the dialog below the action can be keyed by its row. */
function Keyed({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** The dialog itself: the fields, the conflict line and the discard guard. */
export function FieldsDialog({
  title,
  idLabel,
  canSubmit,
  dirty,
  onSubmit,
  session,
  onClose,
  children,
}: {
  title: string;
  /** The id shown as read-only context — fixed at creation (ADR #21). */
  idLabel: string;
  /** The save action is live: something changed and nothing blocks it. */
  canSubmit: boolean;
  /** Closing would lose typed work — the close asks first. */
  dirty: boolean;
  onSubmit: () => void;
  session: FieldsSession;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  // Is a discard confirmation standing over the form?
  const [discardPending, setDiscardPending] = useState(false);
  const submittable = canSubmit && !session.isSaving;

  // Esc, the overlay, the cancel button and the X all come through here: with
  // something typed they ask first, an untouched form just closes.
  const requestClose = () => {
    if (dirty) setDiscardPending(true);
    else onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) requestClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-32px)] max-w-[520px] flex-col"
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{t("properties.description")}</DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!submittable) return;
            onSubmit();
          }}
          className="mt-4 flex min-h-0 flex-1 flex-col"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5">
            {/* The value the form does not own — shown, not editable. */}
            <p className="text-[12px] text-body-secondary">
              {t("properties.id")}{" "}
              <span className="font-mono text-[12px] text-soft">{idLabel}</span>
            </p>
            {children}
          </div>

          <p aria-live="polite" className="min-h-[17px] pt-2 text-[12px] text-destructive">
            {session.message ?? ""}
          </p>

          {/* A refused write asks instead of deciding: the typed values are
              untouched and both answers stand above the buttons. */}
          {session.conflict !== undefined && (
            <div className="pb-2">
              <EditConflict
                onReload={session.reload}
                onForce={session.forceSave}
                busy={session.isSaving}
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={requestClose}
                className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!submittable}
                className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
              >
                {t(session.isSaving ? "common.saving" : "common.save")}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
      {discardPending && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setDiscardPending(false);
          }}
        >
          <DialogContent aria-describedby={undefined} className="max-w-[420px]">
            <DialogTitle>{t("properties.discard.title")}</DialogTitle>
            <DialogDescription>{t("properties.discard.close")}</DialogDescription>
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
                  setDiscardPending(false);
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
    </Dialog>
  );
}
