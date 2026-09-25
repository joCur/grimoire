// The fields of a chapter as form controls: the ones its dialog edits. Plain
// rendering over the form's values (./chapter-form.ts).

import { fieldId } from "@/components/fields/FieldRow";
import { SelectField } from "@/components/fields/SelectField";
import { TextField } from "@/components/fields/TextField";
import { useT } from "@/i18n";

import type { ChapterFormValues } from "./chapter-form";
import { chapterStatusOptions } from "./chapter-status";

/** The dialog's fields: title and status. */
export function ChapterFields({
  values,
  onChange,
}: {
  values: ChapterFormValues;
  onChange: (values: ChapterFormValues) => void;
}) {
  const t = useT();
  const set = (key: keyof ChapterFormValues) => (text: string) =>
    onChange({ ...values, [key]: text });
  return (
    <>
      <TextField
        id={fieldId("title")}
        label={t("properties.chapter.title.label")}
        required
        value={values.title}
        onChange={set("title")}
      />
      <SelectField
        id={fieldId("status")}
        label={t("properties.chapter.status.label")}
        hint={t("properties.chapter.status.hint")}
        value={values.status}
        // Clearing is a real choice: it deletes the value. The closed list
        // follows — the column admits nothing else (ADR #25) — with the same
        // labels the overview's status control shows.
        options={[{ value: "", label: t("properties.field.unset") }, ...chapterStatusOptions(t)]}
        onChange={set("status")}
      />
    </>
  );
}
