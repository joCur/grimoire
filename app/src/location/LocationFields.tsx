// The fields of a location as form controls: the ones its dialog edits, and
// the `atmosphere` its edit surface writes beside the text (ADR #29). Plain
// rendering over the form's values (./location-form.ts).

import type { CampaignTree } from "@grimoire/shared/types";

import { fieldId } from "@/components/fields/FieldRow";
import { ReferenceField, ReferenceNote } from "@/components/fields/ReferenceField";
import { TextField } from "@/components/fields/TextField";
import { useT } from "@/i18n";

import type { LocationFormValues } from "./location-form";

/** The dialog's fields: name, chapter, Roll20 page. */
export function LocationFields({
  values,
  tree,
  onChange,
}: {
  values: LocationFormValues;
  /** For the chapter field — the chapters that exist. */
  tree: CampaignTree | undefined;
  onChange: (values: LocationFormValues) => void;
}) {
  const t = useT();
  const set = (key: keyof LocationFormValues) => (text: string) =>
    onChange({ ...values, [key]: text });
  const chapters = (tree?.chapters ?? []).map((chapter) => ({
    value: chapter.id,
    label: chapter.title,
  }));
  return (
    <>
      <TextField
        id={fieldId("name")}
        label={t("properties.location.name.label")}
        required
        value={values.name}
        onChange={set("name")}
      />
      <ReferenceField
        id={fieldId("chapter")}
        label={t("properties.location.chapter.label")}
        value={values.chapter}
        options={chapters}
        onChange={set("chapter")}
        note={
          <ReferenceNote
            options={chapters}
            value={values.chapter}
            unknown={t("properties.ref.unknownChapter")}
          />
        }
      />
      <TextField
        id={fieldId("roll20Page")}
        label={t("properties.location.roll20.label")}
        hint={t("properties.location.roll20.hint")}
        value={values.roll20Page}
        onChange={set("roll20Page")}
      />
    </>
  );
}

/** The `atmosphere` field, written beside the text. */
export function LocationAtmosphereField({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  const t = useT();
  return (
    <TextField
      id={fieldId("atmosphere")}
      label={t("properties.location.atmosphere.label")}
      hint={t("properties.location.atmosphere.hint")}
      multiline
      value={value}
      onChange={onChange}
    />
  );
}
