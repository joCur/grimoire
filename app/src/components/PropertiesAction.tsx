// The properties action of the reading view: the DM
// edits EVERY properties field of a scene, npc or chapter in a
// form — never
// raw YAML, never a text editor detour. `PropertiesDialog` is the dialog
// itself, the same for every kind; a location's reading view opens it over
// the location's fields and writes through the location's own session
// (components/LocationActions.tsx).
//
// The dialog follows the house pattern: mounted only while open,
// one aria-live error line, a cancel and a save button. What it adds is the diff —
// only the fields the DM actually changed are sent, so every key the form does
// not know (and every field it did not touch) keeps its stored value.
//
// Two things are deliberately NOT in the form: the `id` (fixed at creation,
// ADR #21) and the entity kind (derived from the path). Both are shown as
// read-only context so the absence reads as a rule rather than as a gap.
//
// The version the save is checked against is the one the dialog OPENED with,
// held by the editing session (lib/use-entry-edit.ts): the 5s version poll
// keeps refetching the entry behind the dialog, and following that version
// would turn someone else's edit into a silent overwrite instead of the 409
// that asks. On a conflict the typed values stay and the shared conflict line
// offers the two answers — continue from the stored entry, or write the diff
// on top of it.
//
// Because the values and the version belong to one entry, the dialog is bound
// to ONE path (same rule as the body editor): the reading route stays mounted
// across a navigation — the command palette works over the modal, Back reopens
// a cached entry — and a dialog holding entry A's values while `entry` already
// points at B would patch A's diff into B. So the open state IS the entry
// (campaign + path), and the content is keyed by it.

import type { CampaignTree, EntryResponse } from "@grimoire/shared/types";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { EditConflict } from "@/components/EditConflict";
import { PropertiesFieldControl } from "@/components/PropertiesFields";
import { HeaderAction } from "@/components/HeaderAction";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n, useT } from "@/i18n";
import { propString } from "@/lib/properties";
import {
  canSubmitProperties,
  commitPendingText,
  propertiesFieldsFor,
  propertiesFormIssues,
  propertiesFormValues,
  propertiesKindLabel,
  propertiesPatch,
  hasPropertiesChanges,
  type FormValues,
  type PropertiesField,
} from "@/lib/properties-form";
import { useEntryEdit } from "@/lib/use-entry-edit";

/**
 * The quiet header trigger, in the same vocabulary as the edit action next to
 * it. Renders nothing for the one entry kind that has no form: the campaign,
 * whose metadata has its own dialog.
 */
export function PropertiesAction({
  campaign,
  entry,
  tree,
  triggerLabel,
}: {
  campaign: string;
  entry: EntryResponse;
  /** For the reference fields — the ids that already have an entry. */
  tree: CampaignTree | undefined;
  /**
   * What the trigger is CALLED. The plain properties label everywhere the
   * action stands in the header of the one thing on screen. The chapter
   * overview passes the chapter-prefixed label instead: there the overview
   * header's own edit action is on the same page, and two actions with the
   * same name on one surface are ambiguous for a screen reader and for a
   * keyboard user counting Tab stops. The DIALOG is untouched either way —
   * same form, same editing session, same 409.
   */
  triggerLabel?: string;
}) {
  const t = useT();
  // Open-BY-ENTRY, not a boolean: navigating away closes the dialog instead of
  // leaving it standing over another entry's reading view. Campaign AND path,
  // because two campaigns can hold the same relative path (`npcs/jorna`).
  const entryKey = `${campaign}/${entry.path}`;
  const [openEntry, setOpenEntry] = useState<string>();
  const open = openEntry === entryKey;
  // …and the state is dropped as well, so returning to the entry (Back into the
  // react-query cache) does not reopen a dialog nobody asked for.
  useEffect(() => {
    setOpenEntry(undefined);
  }, [entryKey]);
  const fields = propertiesFieldsFor(entry.kind, t);
  const kindLabel = propertiesKindLabel(entry.kind, t);
  if (fields === undefined || kindLabel === undefined) return null;

  return (
    <>
      <HeaderAction
        icon={SlidersHorizontal}
        label={triggerLabel ?? t("properties.action")}
        onClick={() => setOpenEntry(entryKey)}
      />
      {open && (
        <EntryPropertiesDialog
          // Belt and braces next to the open-by-entry rule: a path change
          // remounts the dialog, so no held value can outlive its entry.
          key={entryKey}
          campaign={campaign}
          entry={entry}
          tree={tree}
          fields={fields}
          kindLabel={kindLabel}
          onClose={() => setOpenEntry(undefined)}
        />
      )}
    </>
  );
}

function EntryPropertiesDialog({
  campaign,
  entry,
  tree,
  fields,
  kindLabel,
  onClose,
}: {
  campaign: string;
  entry: EntryResponse;
  tree: CampaignTree | undefined;
  fields: readonly PropertiesField[];
  kindLabel: string;
  onClose: () => void;
}) {
  const form = usePropertiesForm(propertiesFormValues(fields, entry.properties));
  const save = useEntryEdit(campaign, entry.path, entry.rev, {
    onSaved: onClose,
    // Continue from what is stored: the form is refilled from that entry, so
    // the next diff is measured against it and nothing is pending.
    onReload: (stored) => form.reseed(propertiesFormValues(fields, stored.properties)),
    // A properties patch can move almost everything the tree carries —
    // title/name, status, type, location, npcs, tags, the chapter an entry
    // hangs under — and the search index is built from the same values.
    invalidateOnSuccess: [
      // A CHAPTER patch can set the active status, which the server answers by
      // also putting the previously active chapter back to planned — a second
      // entry this dialog never read, whose cached copy would keep the old
      // status. So the whole entry cache goes for that kind, not just the
      // entry the write seeded.
      ...(entry.kind === "chapter" ? [["entry", campaign]] : []),
      ["tree", campaign],
      ["search", campaign],
    ],
    errorMessage: "write.properties.failed",
  });
  return (
    <PropertiesDialog
      idLabel={propString(entry.properties.id) ?? entry.path}
      tree={tree}
      fields={fields}
      kindLabel={kindLabel}
      form={form}
      session={{ ...save, save: (patch) => save.save({ properties: patch }) }}
      onClose={onClose}
    />
  );
}

/** The form's state: the values the dialog opened with, the typed ones, the pending chip text. */
export interface PropertiesForm {
  /**
   * What the diff is measured against, taken when the dialog opened — NOT the
   * row behind it, or a write landing in the cache would silently swallow the
   * DM's change. It moves only when the DM adopts the stored row after a
   * conflict, together with the session's version.
   */
  initial: FormValues;
  values: FormValues;
  setValues: (update: (previous: FormValues) => FormValues) => void;
  /** Text still standing in a chip input, per field key — a save folds it into its list. */
  pending: Record<string, string>;
  setPending: (update: (previous: Record<string, string>) => Record<string, string>) => void;
  /** Refill the form from a stored row: nothing typed, nothing pending. */
  reseed: (values: FormValues) => void;
}

export function usePropertiesForm(seed: FormValues): PropertiesForm {
  const [initial, setInitial] = useState<FormValues>(seed);
  const [values, setValues] = useState<FormValues>(initial);
  const [pending, setPending] = useState<Record<string, string>>({});
  return {
    initial,
    values,
    setValues,
    pending,
    setPending,
    reseed: (refilled) => {
      setInitial(refilled);
      setValues(refilled);
      setPending({});
    },
  };
}

/** What the dialog needs from the editing session of its kind. */
export interface PropertiesSession {
  /** Write the patch of the fields that changed. */
  save: (patch: Record<string, unknown>) => void;
  isSaving: boolean;
  message?: string | undefined;
  /** Present while a write stands refused — the conflict line shows. */
  conflict?: object | undefined;
  reload: () => void;
  forceSave?: (() => void) | undefined;
}

/**
 * The dialog itself, the same for every kind: the fields as a form, the diff
 * of what changed, the conflict line and the discard guard. The kind's
 * editing session writes the diff.
 */
export function PropertiesDialog({
  idLabel,
  tree,
  fields,
  kindLabel,
  form,
  session: save,
  onClose,
}: {
  /** The id shown as read-only context — fixed at creation (ADR #21). */
  idLabel: string;
  tree: CampaignTree | undefined;
  fields: readonly PropertiesField[];
  kindLabel: string;
  form: PropertiesForm;
  session: PropertiesSession;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { initial, values, setValues, pending, setPending } = form;
  // Is a discard confirmation standing over the form?
  const [discardPending, setDiscardPending] = useState(false);

  // What a save would send: the values plus the pending chip text.
  const effective = commitPendingText(fields, values, pending);
  const patch = propertiesPatch(fields, initial, effective);
  // What is unfinished, per field — an unnamed or a doubled quickstat row.
  // Saving over one of those would lose what the DM typed, so it blocks the
  // save and says why under the field itself.
  // `initial` exempts what the entry already holds, so whatever a campaign
  // carries in `npcs` today cannot block a save of another field.
  const issues = propertiesFormIssues(fields, effective, initial, t);
  const canSubmit =
    canSubmitProperties(fields, effective) &&
    Object.keys(issues).length === 0 &&
    Object.keys(patch).length > 0 &&
    !save.isSaving;

  // Esc, the overlay, the cancel button and the X all come through here: with
  // something typed they ask first (house pattern of EntryBodyEditor), an
  // untouched form just closes.
  const dirty = hasPropertiesChanges(fields, initial, effective, t);
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
        <DialogTitle>{t("properties.title", { kind: kindLabel })}</DialogTitle>
        <DialogDescription>{t("properties.description")}</DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            save.save(patch);
          }}
          className="mt-4 flex min-h-0 flex-1 flex-col"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5">
            {/* The two values the form does not own — shown, not editable. */}
            <p className="text-[12px] text-body-secondary">
              {t("properties.id")}{" "}
              <span className="font-mono text-[12px] text-soft">{idLabel}</span>
            </p>
            {fields.map((field) => {
              const value = values[field.key];
              if (value === undefined) return null;
              return (
                <PropertiesFieldControl
                  key={field.key}
                  field={field}
                  value={value}
                  tree={tree}
                  pending={pending[field.key] ?? ""}
                  issue={issues[field.key]}
                  onChange={(next) =>
                    setValues((previous) => ({ ...previous, [field.key]: next }))
                  }
                  onPendingChange={(text) =>
                    setPending((previous) => ({ ...previous, [field.key]: text }))
                  }
                />
              );
            })}
          </div>

          <p aria-live="polite" className="min-h-[17px] pt-2 text-[12px] text-destructive">
            {save.message ?? ""}
          </p>

          {/* A refused write asks instead of deciding: the typed values are
              untouched and both answers stand above the buttons. */}
          {save.conflict !== undefined && (
            <div className="pb-2">
              <EditConflict
                onReload={save.reload}
                onForce={save.forceSave}
                busy={save.isSaving}
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
              disabled={!canSubmit}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {t(save.isSaving ? "common.saving" : "common.save")}
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
