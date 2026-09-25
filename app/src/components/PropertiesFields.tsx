// The controls of a chapter's properties form — one row per field, chosen by
// the field's control, each built from the field building blocks (./fields/).
// Plain rendering: every row gets its value and gives back a new one, no
// queries, no writes.

import { fieldId } from "@/components/fields/FieldRow";
import { SelectField } from "@/components/fields/SelectField";
import { TextField } from "@/components/fields/TextField";
import { useT } from "@/i18n";
import type { PropertiesField } from "@/lib/properties-form";

/** One field of the form. */
export function PropertiesFieldControl({
  field,
  value,
  onChange,
}: {
  field: PropertiesField;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const copy = {
    id: fieldId(field.key),
    label: field.label,
    ...(field.hint === undefined ? {} : { hint: field.hint }),
    ...(field.required === true ? { required: true } : {}),
  };
  if (field.control === "select") {
    return (
      <SelectField
        {...copy}
        value={value}
        // Clearing is a real choice: it deletes the value. The closed list
        // itself follows — the column admits nothing else (ADR #25).
        options={[{ value: "", label: t("properties.field.unset") }, ...(field.options ?? [])]}
        onChange={onChange}
      />
    );
  }
  return <TextField {...copy} value={value} onChange={onChange} />;
}
