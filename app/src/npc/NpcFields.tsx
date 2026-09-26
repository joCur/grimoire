// The fields of an npc as form controls: the ones its dialog (and the card of
// a proposed npc) edits, and the `motivation` its edit surface writes beside
// the text (ADR #29). Plain rendering over the form's values
// (./npc-form.ts).
//
// The status is a select over the closed list and nothing else: an npc
// always has a status, so there is no empty choice.

import { NPC_STATUSES } from "@grimoire/shared/npc";
import type { CampaignTree } from "@grimoire/shared/campaign-tree";

import { fieldId } from "@/components/fields/FieldRow";
import { PairsField } from "@/components/fields/PairsField";
import { ReferenceField, ReferenceNote } from "@/components/fields/ReferenceField";
import { SelectField } from "@/components/fields/SelectField";
import { TextField } from "@/components/fields/TextField";
import { useT } from "@/i18n";

import type { NpcFormValues } from "./npc-form";
import { npcStatusLabel } from "./npc-status";

/** The dialog's fields, in the order the dialog shows them. */
export function NpcFields({
  values,
  issues,
  tree,
  onChange,
}: {
  values: NpcFormValues;
  /** What blocks the save, per field. */
  issues: Partial<Record<keyof NpcFormValues, string>>;
  /** For the chapter field — the chapters that exist. */
  tree: CampaignTree | undefined;
  onChange: (values: NpcFormValues) => void;
}) {
  const t = useT();
  const set = <K extends keyof NpcFormValues>(key: K) => (value: NpcFormValues[K]) =>
    onChange({ ...values, [key]: value });
  const chapters = (tree?.chapters ?? []).map((chapter) => ({
    value: chapter.id,
    label: chapter.title,
  }));
  return (
    <>
      <TextField
        id={fieldId("name")}
        label={t("properties.npc.name.label")}
        required
        value={values.name}
        onChange={set("name")}
      />
      <TextField
        id={fieldId("role")}
        label={t("properties.npc.role.label")}
        hint={t("properties.npc.role.hint")}
        value={values.role}
        onChange={set("role")}
      />
      <ReferenceField
        id={fieldId("chapter")}
        label={t("properties.npc.chapter.label")}
        hint={t("properties.npc.chapter.hint")}
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
      <SelectField
        id={fieldId("status")}
        label={t("properties.npc.status.label")}
        required
        value={values.status}
        options={NPC_STATUSES.map((status) => ({ value: status, label: npcStatusLabel(status, t) }))}
        onChange={(value) => {
          const status = NPC_STATUSES.find((known) => known === value);
          if (status !== undefined) set("status")(status);
        }}
      />
      <TextField
        id={fieldId("statblock")}
        label={t("properties.npc.statblock.label")}
        hint={t("properties.npc.statblock.hint")}
        placeholder={t("properties.npc.statblock.placeholder")}
        value={values.statblock}
        onChange={set("statblock")}
      />
      <PairsField
        label={t("properties.npc.quickstats.label")}
        hint={t("properties.npc.quickstats.hint")}
        {...(issues.quickstats === undefined ? {} : { issue: issues.quickstats })}
        pairs={values.quickstats}
        onChange={set("quickstats")}
      />
      <TextField
        id={fieldId("voice")}
        label={t("properties.npc.voice.label")}
        hint={t("properties.npc.voice.hint")}
        multiline
        value={values.voice}
        onChange={set("voice")}
      />
      <TextField
        id={fieldId("appearance")}
        label={t("properties.npc.appearance.label")}
        hint={t("properties.npc.appearance.hint")}
        multiline
        value={values.appearance}
        onChange={set("appearance")}
      />
    </>
  );
}

/** The `motivation` field, written beside the text. */
export function NpcMotivationField({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  const t = useT();
  return (
    <TextField
      id={fieldId("motivation")}
      label={t("properties.npc.motivation.label")}
      hint={t("properties.npc.motivation.hint")}
      multiline
      value={value}
      onChange={onChange}
    />
  );
}
