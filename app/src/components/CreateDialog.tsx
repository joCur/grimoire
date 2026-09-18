// The one create dialog — used for a campaign, a chapter, a scene, an NPC and
// a location.
//
// They are the same conversation five times over: type a name, see the id it
// will get, confirm. So they are one component; five copies of a form is how
// wording, focus behaviour and the collision handling drift apart. The
// differences that remain are text plus at most one extra field (a chapter's
// optional goal), which is what the props carry.
//
// Why the id is on screen while typing: it is the format's permanent reference
// key (README — an id never changes). Deriving it silently would mean the DM
// meets it for the first time in an address, so the quiet line under the name
// field shows exactly what will be created — and carries the pencil that makes
// it settable, which ADR #21 puts here and nowhere else (components/IdField.tsx).
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
import { IdField } from "@/components/IdField";
import { useT } from "@/i18n";
import {
  canCreate,
  createConflict,
  createErrorMessage,
  type CreateConflict,
} from "@/lib/create";
import {
  ID_FIELD_START,
  idAllowed,
  resolvedId,
  submittedId,
  takeIdSuggestion,
  toggleIdField,
  typeIdField,
} from "@/lib/id-field";

export interface CreateValues {
  /** The typed name/title — always sent. */
  name: string;
  /** The optional second field's text (a chapter goal), when the dialog has one. */
  extra?: string;
  /**
   * Only set when the DM settled an id themselves — by typing it into the id
   * field, or by taking the collision proposal. A derived id is left out, so
   * the server derives it.
   */
  id?: string;
}

interface CreateDialogProps {
  /** Dialog heading, from the catalog. */
  title: string;
  /**
   * One sentence saying what is created and what happens next. Left out where
   * there is nothing to say beyond the field labels — a filler subtitle is
   * worse than none.
   */
  description?: string;
  /** Label of the required field — a title for a chapter/scene, a name else. */
  nameLabel: string;
  /**
   * Hint inside the empty field. GENERIC by rule — it names the KIND of thing
   * that belongs there (the scene's title, the NPC's name), never a name
   * lifted from the fixtures: a placeholder that reads like real campaign
   * content is taken for a default, and the example campaign's names have no
   * business in a fresh instance.
   */
  namePlaceholder: string;
  /**
   * What the id gets prefixed with in the address preview (`npcs/`,
   * `locations/`, `<chapter>/`, and the empty string for a chapter, whose id
   * IS the address). A campaign has no address to prefix, so it labels the
   * bare id instead.
   */
  addressPrefix: string;
  /** The optional second field — same placeholder rule as above. */
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
  const t = useT();
  const nameId = useId();
  const extraId = useId();
  const [name, setName] = useState("");
  const [extraText, setExtraText] = useState("");
  const [idState, setIdState] = useState(ID_FIELD_START);
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
      setMessage(createErrorMessage(error, t));
    },
  });

  const trimmed = name.trim();
  const id = resolvedId(idState, trimmed);
  // An id of "" only happens while the name yields none, and that case is
  // already the submit's precondition — the rule is not shown for it.
  const idInvalid = id !== "" && !idAllowed(id);
  const canSubmit = canCreate(trimmed) && idAllowed(id) && !run.isPending;

  /** `override` is the 409 proposal; otherwise the id comes from the field. */
  const submit = (override?: string) => {
    if (!canCreate(trimmed) || !idAllowed(override ?? id) || run.isPending) return;
    const values: CreateValues = { name: trimmed };
    if (extra !== undefined && extraText.trim() !== "") values.extra = extraText.trim();
    const sent = override ?? submittedId(idState);
    if (sent !== undefined) values.id = sent;
    run.mutate(values);
  };

  /** The one-click proposal settles the id as a typed one and re-sends. */
  const takeSuggestion = (suggestion: string) => {
    setIdState((state) => takeIdSuggestion(state, suggestion));
    submit(suggestion);
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
        {description === undefined ? null : (
          <DialogDescription>{description}</DialogDescription>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mt-4 flex flex-col gap-3.5"
        >
          {/* The id line is a SIBLING of the name label, not part of it: it
              carries a button and a field of its own, and a label wrapping
              those would hand their clicks to the name input. */}
          <div className="flex flex-col gap-1.5">
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
            </label>
            {/* The id that will be created — quiet, but never hidden, and
                settable by hand (ADR #21). */}
            <IdField
              prefix={addressPrefix}
              id={id}
              editing={idState.editing}
              invalid={idInvalid}
              onToggle={() => setIdState(toggleIdField)}
              onChange={(value) => setIdState((state) => typeIdField(state, value))}
            />
          </div>

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
                  onClick={() => takeSuggestion(conflict.suggestion)}
                  className="rounded-sm text-body-secondary underline underline-offset-2 hover:text-foreground"
                >
                  {t("create.useSuggestion", { id: conflict.suggestion })}
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
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {t(run.isPending ? "common.creating" : "common.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
