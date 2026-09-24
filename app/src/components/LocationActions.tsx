// The editing surfaces of a location's reading view (ADR #31): the body
// editor with the `atmosphere` field beside the text, and the dialog over
// the location's other fields. Both are the surfaces every kind shares
// (./EntryBodyEditor.tsx `BodyEditor`, ./PropertiesAction.tsx
// `PropertiesDialog`) over the location's own editing session
// (lib/use-location-edit.ts): the fields a surface changed become ONE
// location PATCH, checked against the location's schema before it is sent.

import { locationChangeSchema } from "@grimoire/shared/location";
import type { CampaignTree, Location, LocationChange } from "@grimoire/shared/types";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BodyEditor, useBodyDraft, type BodyEditSession } from "@/components/EntryBodyEditor";
import { HeaderAction } from "@/components/HeaderAction";
import { PropertiesDialog, usePropertiesForm } from "@/components/PropertiesAction";
import { useT } from "@/i18n";
import type { BodyEditChange } from "@/lib/entry-body";
import {
  propertiesFieldsFor,
  propertiesFormValues,
  propertiesKindLabel,
  type PropertiesField,
} from "@/lib/properties-form";
import { useLocationEdit } from "@/lib/use-location-edit";

/**
 * What a surface changed, as the location's write: the fields beside `body`,
 * checked against the location's schema — a key the location does not have
 * is a bug here, not a request the server has to refuse.
 */
function locationChange(change: BodyEditChange): LocationChange {
  return locationChangeSchema.parse({
    ...change.fields,
    ...(change.body === undefined ? {} : { body: change.body }),
  });
}

/** The queries a location write makes stale beside the location itself. */
function staleAfterWrite(campaign: string) {
  return [
    ["tree", campaign],
    ["search", campaign],
    ["locations", campaign],
  ];
}

/** The fields of a location one surface edits — the dialog, or the text (`atmosphere`). */
function useLocationFields(surface: "dialog" | "text"): readonly PropertiesField[] {
  const t = useT();
  return useMemo(() => propertiesFieldsFor("location", t, surface) ?? [], [t, surface]);
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
  const fields = useLocationFields("text");
  const draft = useBodyDraft(
    { body: location.body, values: propertiesFormValues(fields, location) },
    fields,
  );
  const edit = useLocationEdit(campaign, location, {
    onSaved: onClose,
    onReload: (stored) =>
      draft.reseed({ body: stored.body, values: propertiesFormValues(fields, stored) }),
    invalidateOnSuccess: staleAfterWrite(campaign),
  });
  const session: BodyEditSession = {
    ...edit,
    save: (change) => edit.save(locationChange(change)),
  };
  return (
    <BodyEditor
      editorKey={`location-${location.id}`}
      label={location.name}
      fields={fields}
      draft={draft}
      session={session}
      onClose={onClose}
    />
  );
}

/**
 * The dialog action of a location — the same quiet trigger as every other
 * kind's, bound to ONE location: navigating away closes it instead of
 * leaving it standing over another location's reading view.
 */
export function LocationPropertiesAction({
  campaign,
  location,
  tree,
}: {
  campaign: string;
  location: Location;
  /** For the chapter reference field. */
  tree: CampaignTree | undefined;
}) {
  const t = useT();
  const locationKeyOf = `${campaign}/${location.id}`;
  const [openFor, setOpenFor] = useState<string>();
  useEffect(() => {
    setOpenFor(undefined);
  }, [locationKeyOf]);
  const kindLabel = propertiesKindLabel("location", t) ?? "";
  return (
    <>
      <HeaderAction
        icon={SlidersHorizontal}
        label={t("properties.action")}
        onClick={() => setOpenFor(locationKeyOf)}
      />
      {openFor === locationKeyOf && (
        <LocationPropertiesDialog
          key={locationKeyOf}
          campaign={campaign}
          location={location}
          tree={tree}
          kindLabel={kindLabel}
          onClose={() => setOpenFor(undefined)}
        />
      )}
    </>
  );
}

function LocationPropertiesDialog({
  campaign,
  location,
  tree,
  kindLabel,
  onClose,
}: {
  campaign: string;
  location: Location;
  tree: CampaignTree | undefined;
  kindLabel: string;
  onClose: () => void;
}) {
  const fields = useLocationFields("dialog");
  const form = usePropertiesForm(propertiesFormValues(fields, location));
  const save = useLocationEdit(campaign, location, {
    onSaved: onClose,
    // Continue from what is stored: the form is refilled from that location.
    onReload: (stored) => form.reseed(propertiesFormValues(fields, stored)),
    invalidateOnSuccess: staleAfterWrite(campaign),
    errorMessage: "write.properties.failed",
  });
  return (
    <PropertiesDialog
      idLabel={location.id}
      tree={tree}
      fields={fields}
      kindLabel={kindLabel}
      form={form}
      session={{ ...save, save: (patch) => save.save(locationChange({ fields: patch })) }}
      onClose={onClose}
    />
  );
}
