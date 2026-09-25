// The properties action of a chapter's reading view: the DM edits EVERY field
// in a form — never raw YAML, never a text editor detour.
// The dialog is the shared one (./fields/FieldsDialog.tsx); what this module
// adds is the diff — only the fields the DM actually changed are sent, so
// every key the form does not know (and every field it did not touch) keeps
// its stored value.
//
// The `id` is deliberately NOT in the form (fixed at creation, ADR #21); it is
// shown as read-only context so the absence reads as a rule rather than as a
// gap.
//
// The version the save is checked against is the one the dialog OPENED with,
// held by the editing session (lib/use-entry-edit.ts): the 5s version poll
// keeps refetching the row behind the dialog, and following that version
// would turn someone else's edit into a silent overwrite instead of the 409
// that asks. On a conflict the typed values stay and the shared conflict line
// offers the two answers — continue from the stored row, or write the diff
// on top of it.
//
// Because the values and the version belong to one row, the dialog is bound
// to ONE path (FieldsDialogAction): the open state IS the row (campaign +
// path), and the content is keyed by it.

import type { EntryResponse } from "@grimoire/shared/types";
import { useState } from "react";

import { FieldsDialog, FieldsDialogAction } from "@/components/fields/FieldsDialog";
import { PropertiesFieldControl } from "@/components/PropertiesFields";
import { useT } from "@/i18n";
import { propString } from "@/lib/properties";
import {
  canSubmitProperties,
  propertiesFieldsFor,
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
 * it. Renders nothing for a row that has no form: the campaign, whose
 * metadata has its own dialog.
 */
export function PropertiesAction({
  campaign,
  entry,
  triggerLabel,
}: {
  campaign: string;
  entry: EntryResponse;
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
  const fields = propertiesFieldsFor(entry.kind, t);
  const kindLabel = propertiesKindLabel(entry.kind, t);
  if (fields === undefined || kindLabel === undefined) return null;

  return (
    // Campaign AND path, because two campaigns can hold the same relative
    // path (`01-salzhafen`).
    <FieldsDialogAction openKey={`${campaign}/${entry.path}`} label={triggerLabel}>
      {(onClose) => (
        <EntryPropertiesDialog
          campaign={campaign}
          entry={entry}
          fields={fields}
          kindLabel={kindLabel}
          onClose={onClose}
        />
      )}
    </FieldsDialogAction>
  );
}

function EntryPropertiesDialog({
  campaign,
  entry,
  fields,
  kindLabel,
  onClose,
}: {
  campaign: string;
  entry: EntryResponse;
  fields: readonly PropertiesField[];
  kindLabel: string;
  onClose: () => void;
}) {
  const t = useT();
  const seed = propertiesFormValues(fields, entry.properties);
  // What the diff is measured against, taken when the dialog opened — NOT the
  // row behind it. It moves only when the DM adopts the stored row after a
  // conflict, together with the session's version.
  const [initial, setInitial] = useState<FormValues>(seed);
  const [values, setValues] = useState<FormValues>(seed);
  const save = useEntryEdit(campaign, entry.path, entry.rev, {
    onSaved: onClose,
    // Continue from what is stored: the form is refilled from that row, so
    // the next diff is measured against it and nothing is pending.
    onReload: (stored) => {
      const refilled = propertiesFormValues(fields, stored.properties);
      setInitial(refilled);
      setValues(refilled);
    },
    // Title and status are in the tree and the search index. A status patch
    // can set `active`, which the server answers by also putting the
    // previously active chapter back to planned — a second row this dialog
    // never read, whose cached copy would keep the old status. So the whole
    // cache of that kind goes, not just the row the write seeded.
    invalidateOnSuccess: [
      ["entry", campaign],
      ["tree", campaign],
      ["search", campaign],
    ],
    errorMessage: "write.properties.failed",
  });

  const patch = propertiesPatch(fields, initial, values);

  return (
    <FieldsDialog
      title={t("properties.title", { kind: kindLabel })}
      idLabel={propString(entry.properties.id) ?? entry.path}
      canSubmit={canSubmitProperties(fields, values) && Object.keys(patch).length > 0}
      dirty={hasPropertiesChanges(fields, initial, values)}
      onSubmit={() => save.save({ properties: patch })}
      session={save}
      onClose={onClose}
    >
      {fields.map((field) => {
        return (
          <PropertiesFieldControl
            key={field.key}
            field={field}
            value={values[field.key] ?? ""}
            onChange={(next) => setValues((previous) => ({ ...previous, [field.key]: next }))}
          />
        );
      })}
    </FieldsDialog>
  );
}
