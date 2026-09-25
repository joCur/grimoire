// The fields of a scene as form controls — the ones its dialog and the editor
// of a proposed scene show. Plain rendering over the form's values
// (./scene-form.ts), each row built from the field building blocks
// (components/fields/).
//
// Keyboard first (quality floor): every control is a native input/select/
// button, chips are added with Enter and removed with their own button, and
// the reference inputs offer the existing ids through a native <datalist>.
// Type and status are selects over their closed lists and nothing else: a
// scene always has both, so there is no empty choice.

import { SCENE_STATUSES, SCENE_TYPES } from "@grimoire/shared/scene";
import type { CampaignTree, SceneType } from "@grimoire/shared/types";

import { ChipsField } from "@/components/fields/ChipsField";
import { fieldId } from "@/components/fields/FieldRow";
import { ReferenceField, ReferenceNote } from "@/components/fields/ReferenceField";
import { SelectField, type FieldOption } from "@/components/fields/SelectField";
import { TextField } from "@/components/fields/TextField";
import { useT, type MessageKey } from "@/i18n";

import {
  locationRef,
  type SceneFormValues,
  type SceneListKey,
  type ScenePendingChips,
} from "./scene-form";
import { sceneStatusOptions } from "./scene-status";

const SCENE_TYPE_LABELS: Record<SceneType, MessageKey> = {
  planned: "properties.scene.type.planned",
  contingency: "properties.scene.type.contingency",
};

/** The dialog's fields, in the order the dialog shows them. */
export function SceneFields({
  values,
  pending,
  issues,
  tree,
  onChange,
  onPendingChange,
}: {
  values: SceneFormValues;
  /** The text still standing in each chip input. */
  pending: ScenePendingChips;
  /** What blocks the save, per field. */
  issues: Partial<Record<keyof SceneFormValues, string>>;
  /** For the reference fields — the ids that already have a row. */
  tree: CampaignTree | undefined;
  onChange: (values: SceneFormValues) => void;
  onPendingChange: (pending: ScenePendingChips) => void;
}) {
  const t = useT();
  const set = <K extends keyof SceneFormValues>(key: K) => (value: SceneFormValues[K]) =>
    onChange({ ...values, [key]: value });
  const issue = (key: keyof SceneFormValues) =>
    issues[key] === undefined ? {} : { issue: issues[key] };
  const chips = (key: SceneListKey) => ({
    id: fieldId(key),
    items: values[key],
    pending: pending[key] ?? "",
    onChange: (items: string[]) => set(key)(items),
    onPendingChange: (text: string) => onPendingChange({ ...pending, [key]: text }),
    ...issue(key),
  });
  const chapters: FieldOption[] = (tree?.chapters ?? []).map((chapter) => ({
    value: chapter.id,
    label: chapter.title,
  }));
  const locations: FieldOption[] = (tree?.locations ?? []).map((location) => ({
    value: location.id,
    label: location.name,
  }));
  const npcs: FieldOption[] = (tree?.npcs ?? []).map((npc) => ({ value: npc.id, label: npc.name }));
  return (
    <>
      <TextField
        id={fieldId("title")}
        label={t("properties.scene.title.label")}
        required
        value={values.title}
        onChange={set("title")}
      />
      <SelectField
        id={fieldId("type")}
        label={t("properties.scene.type.label")}
        value={values.type}
        options={SCENE_TYPES.map((type) => ({ value: type, label: t(SCENE_TYPE_LABELS[type]) }))}
        onChange={(value) => {
          const type = SCENE_TYPES.find((known) => known === value);
          if (type !== undefined) set("type")(type);
        }}
      />
      <TextField
        id={fieldId("trigger")}
        label={t("properties.scene.trigger.label")}
        hint={t("properties.scene.trigger.hint")}
        multiline
        value={values.trigger}
        onChange={set("trigger")}
      />
      <ReferenceField
        id={fieldId("chapter")}
        label={t("properties.scene.chapter.label")}
        {...issue("chapter")}
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
      <ReferenceField
        id={fieldId("location")}
        label={t("properties.scene.location.label")}
        hint={t("properties.scene.location.hint")}
        {...issue("location")}
        value={values.location}
        options={locations}
        onChange={set("location")}
        note={<LocationNote options={locations} value={values.location} />}
      />
      <ChipsField
        label={t("properties.scene.npcs.label")}
        hint={t("properties.scene.npcs.hint")}
        options={npcs}
        {...chips("npcs")}
      />
      <ChipsField
        label={t("properties.scene.handouts.label")}
        hint={t("properties.scene.handouts.hint")}
        {...chips("handouts")}
      />
      <ChipsField
        label={t("properties.scene.tags.label")}
        hint={t("properties.scene.tags.hint")}
        {...chips("tags")}
      />
      <SelectField
        id={fieldId("status")}
        label={t("properties.scene.status.label")}
        value={values.status}
        options={sceneStatusOptions(t)}
        onChange={(value) => {
          const status = SCENE_STATUSES.find((known) => known === value);
          if (status !== undefined) set("status")(status);
        }}
      />
    </>
  );
}

/**
 * What the location field resolves to. The DM types a name and the scene
 * stores the id it slugs to, so the note resolves over the SLUG — typing the
 * name of an existing location shows that location, the one the save would
 * land on.
 */
function LocationNote({ options, value }: { options: readonly FieldOption[]; value: string }) {
  const t = useT();
  const ref = locationRef(value, options);
  switch (ref.kind) {
    // Nothing typed says nothing; for unusable text the save is blocked and
    // the field's issue already says why — one line under the field, not two.
    case "empty":
    case "unusable":
      return null;
    case "known":
      return ref.name === undefined ? null : <p className="text-[11.5px] text-faint">{ref.name}</p>;
    case "unknown":
      return <p className="text-[11.5px] text-faint">{t("properties.ref.unknownLocation")}</p>;
  }
}
