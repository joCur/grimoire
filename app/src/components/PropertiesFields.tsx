// The controls of the properties form of a scene and a chapter — one row per
// field, chosen by the field's control, each built from the field building
// blocks (./fields/). Plain rendering: every row gets its value and gives
// back a new one, no queries, no writes.
//
// Keyboard first (quality floor): every control is a native input/select/
// button, chips are added with Enter and removed with their own button, and
// the reference inputs offer the existing ids through a native <datalist>.

import type { CampaignTree } from "@grimoire/shared/types";

import { ChipsField } from "@/components/fields/ChipsField";
import { fieldId } from "@/components/fields/FieldRow";
import { ReferenceField, ReferenceNote } from "@/components/fields/ReferenceField";
import { SelectField, type FieldOption } from "@/components/fields/SelectField";
import { TextField } from "@/components/fields/TextField";
import { useT } from "@/i18n";
import {
  locationRef,
  referenceOptions,
  type FieldValue,
  type PropertiesField,
} from "@/lib/properties-form";

/**
 * One field of the form. `pending` is the text still standing in a chip input
 * — it lives in the dialog so the save can fold it in instead of losing it.
 */
export function PropertiesFieldControl({
  field,
  value,
  tree,
  pending,
  issue,
  onChange,
  onPendingChange,
}: {
  field: PropertiesField;
  value: FieldValue;
  /** Reference options come from the campaign tree; undefined = none yet. */
  tree: CampaignTree | undefined;
  pending: string;
  /** The line that says why the save is blocked in this field. */
  issue?: string;
  onChange: (value: FieldValue) => void;
  onPendingChange: (text: string) => void;
}) {
  const t = useT();
  const options = field.source === undefined ? [] : referenceOptions(tree, field.source);
  const id = fieldId(field.key);
  const copy = {
    label: field.label,
    ...(field.hint === undefined ? {} : { hint: field.hint }),
    ...(field.required === true ? { required: true } : {}),
    ...(issue === undefined ? {} : { issue }),
  };

  if (value.kind === "list") {
    return (
      <ChipsField
        {...copy}
        id={id}
        items={value.items}
        {...(field.control === "references" ? { options } : {})}
        pending={pending}
        onChange={(items) => onChange({ kind: "list", items })}
        onPendingChange={onPendingChange}
      />
    );
  }

  const setText = (text: string) => onChange({ kind: "text", text });

  if (field.control === "select") {
    return (
      <SelectField
        {...copy}
        id={id}
        value={value.text}
        // Clearing is a real choice: it deletes the value. The closed list
        // itself follows — the column admits nothing else (ADR #25).
        options={[{ value: "", label: t("properties.field.unset") }, ...(field.options ?? [])]}
        onChange={setText}
      />
    );
  }

  if (field.control === "reference") {
    return (
      <ReferenceField
        {...copy}
        id={id}
        value={value.text}
        options={options}
        placeholder={field.placeholder}
        onChange={setText}
        note={
          field.source === "locations" ? (
            <LocationNote options={options} value={value.text} />
          ) : (
            <ReferenceNote
              options={options}
              value={value.text}
              unknown={t(
                field.source === "chapters" ? "properties.ref.unknownChapter" : "properties.ref.unknown",
              )}
            />
          )
        }
      />
    );
  }

  return (
    <TextField
      {...copy}
      id={id}
      value={value.text}
      placeholder={field.placeholder}
      multiline={field.control === "textarea"}
      onChange={setText}
    />
  );
}

/**
 * What the scene's location field resolves to. `location` is the one field
 * whose text is not its id: it is the group the scene sits under in its
 * chapter, so it STORES an id while the DM types a name, and the form slugs
 * it. The line therefore resolves over the SLUG — typing the name of an
 * existing location shows that location, the one the save would land on.
 */
function LocationNote({ options, value }: { options: readonly FieldOption[]; value: string }) {
  const t = useT();
  const ref = locationRef(value, options);
  switch (ref.kind) {
    case "empty":
      return null;
    // The save is blocked and `propertiesFormIssues` already says why — one
    // line under the field, not two.
    case "unusable":
      return null;
    case "known":
      return ref.name === undefined ? null : (
        <p className="text-[11.5px] text-faint">{ref.name}</p>
      );
    case "unknown":
      return <p className="text-[11.5px] text-faint">{t("properties.ref.unknownLocation")}</p>;
  }
}
