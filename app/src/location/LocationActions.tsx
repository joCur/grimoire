// The editing surfaces of a location's reading view (ADR #31): the body
// editor with the `atmosphere` field beside the text, and the dialog over the
// location's other fields. Both are shared surfaces (BodyEditor,
// FieldsDialog) over the location's own form (./location-form.ts) and its
// own editing session (./use-location-edit.ts): the fields a surface changed
// become ONE location PATCH.

import type { CampaignTree, Location } from "@grimoire/shared/types";

import { BodyEditor, useBodyDraft } from "@/components/BodyEditor";
import { FieldsDialog, FieldsDialogAction, useFieldsForm } from "@/components/fields/FieldsDialog";
import { useT } from "@/i18n";

import { LocationAtmosphereField, LocationFields } from "./LocationFields";
import {
  canSubmitLocationForm,
  locationFormChange,
  locationFormDirty,
  locationFormValues,
} from "./location-form";
import { locationsKey } from "./location-query";
import { useLocationEdit } from "./use-location-edit";

/** The queries a location write makes stale beside the location itself. */
function staleAfterWrite(campaign: string) {
  return [
    ["tree", campaign],
    ["search", campaign],
    locationsKey(campaign),
  ];
}

/** The body editor of a location: its text, and its `atmosphere` beside it. */
export function LocationBodyEditor({
  campaign,
  location,
  onClose,
}: {
  campaign: string;
  /** The location on screen when the edit started; mount per location (`key`). */
  location: Location;
  onClose: () => void;
}) {
  const t = useT();
  const draft = useBodyDraft(location.body);
  const form = useFieldsForm(locationFormValues(location));
  const edit = useLocationEdit(campaign, location, {
    onSaved: onClose,
    onReload: (stored) => {
      draft.reseed(stored.body);
      form.reseed(locationFormValues(stored));
    },
    invalidateOnSuccess: staleAfterWrite(campaign),
  });
  return (
    <BodyEditor
      editorKey={`location-${location.id}`}
      label={location.name}
      fields={{
        controls: (
          <LocationAtmosphereField
            value={form.values.atmosphere}
            onChange={(atmosphere) => form.setValues({ ...form.values, atmosphere })}
          />
        ),
        labels: [t("properties.location.atmosphere.label")],
        change: locationFormChange(form.initial, form.values),
      }}
      draft={draft}
      session={{
        ...edit,
        save: (change) =>
          edit.save({
            ...change.fields,
            ...(change.body === undefined ? {} : { body: change.body }),
          }),
      }}
      onClose={onClose}
    />
  );
}

/**
 * The dialog action of a location — bound to ONE location: navigating away
 * closes it instead of leaving it standing over another location's reading
 * view.
 */
export function LocationFieldsAction({
  campaign,
  location,
  tree,
}: {
  campaign: string;
  location: Location;
  /** For the chapter field. */
  tree: CampaignTree | undefined;
}) {
  return (
    <FieldsDialogAction openKey={`${campaign}/${location.id}`}>
      {(onClose) => (
        <LocationFieldsDialog
          campaign={campaign}
          location={location}
          tree={tree}
          onClose={onClose}
        />
      )}
    </FieldsDialogAction>
  );
}

function LocationFieldsDialog({
  campaign,
  location,
  tree,
  onClose,
}: {
  campaign: string;
  location: Location;
  tree: CampaignTree | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const form = useFieldsForm(locationFormValues(location));
  const save = useLocationEdit(campaign, location, {
    onSaved: onClose,
    // Continue from what is stored: the form is refilled from that location.
    onReload: (stored) => form.reseed(locationFormValues(stored)),
    invalidateOnSuccess: staleAfterWrite(campaign),
    errorMessage: "write.properties.failed",
  });
  const change = locationFormChange(form.initial, form.values);
  return (
    <FieldsDialog
      title={t("properties.title", { kind: t("kind.location") })}
      idLabel={location.id}
      canSubmit={canSubmitLocationForm(form.values) && Object.keys(change).length > 0}
      dirty={locationFormDirty(form.initial, form.values)}
      onSubmit={() => save.save(change)}
      session={save}
      onClose={onClose}
    >
      <LocationFields values={form.values} tree={tree} onChange={form.setValues} />
    </FieldsDialog>
  );
}
