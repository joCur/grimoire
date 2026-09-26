// The edit mode of a location's reading view: the text is the surface. The
// reading view's own article turns editable in place —
//
//   header      "edit location"; the save actions and the count of changes
//               at the right end on the desktop, in a bar at the bottom of
//               the screen on the phone. A location has no status.
//   name        editable in place, the heading's serif without a box.
//   chips       chapter and Roll20 page as one row of chips; a chip opens
//               only its field (components/FieldChips.tsx).
//   atmosphere  the prose line too long for a chip, as one collapsible
//               section, a single line while it is closed
//               (components/FieldSection.tsx).
//   text        the body editor surface, taking the rest of the page.
//
// Everything on the page is ONE draft over the location's one row with its
// one guard (decisions/writes): the form of its fields (./location-form.ts)
// and the text (the body draft). A save is one PATCH with exactly the fields
// that changed, through the location's editing session
// (./use-location-edit.ts). A refused save (409) keeps the whole draft and
// puts the shared conflict line above the name: reload continues from the
// stored location, save anyway resends the changed fields on top of it, so a
// field changed elsewhere survives.
//
// Leaving with unsaved work asks first — the cancel action here, and a
// navigation through the page's unsaved-changes guard.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { Location, LocationChange } from "@grimoire/shared/location";
import { useState } from "react";

import { BodyEditorSurface, useBodyDraft, useDraftIssues } from "@/components/BodyEditor";
import { DiscardChangesDialog } from "@/components/DiscardChangesDialog";
import { EditConflict } from "@/components/EditConflict";
import { EditModeHeader, EditTitleInput } from "@/components/EditMode";
import { FieldChipRow, type FieldChip } from "@/components/FieldChips";
import { FieldSection, SectionField } from "@/components/FieldSection";
import { fieldId } from "@/components/fields/FieldRow";
import { useFieldsForm } from "@/components/fields/use-fields-form";
import { PickList } from "@/components/fields/PickList";
import { TextField } from "@/components/fields/TextField";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { useT } from "@/i18n";

import {
  canSubmitLocationForm,
  locationFormChange,
  locationFormDirty,
  locationFormValues,
  type LocationFormValues,
} from "./location-form";
import { locationsKey } from "./location-query";
import { useLocationEdit } from "./use-location-edit";

/**
 * The queries a location write makes stale beside the location itself: the
 * tree (the name in every list), ⌘K and the location list.
 */
function staleAfterWrite(campaign: string) {
  return [["tree", campaign], ["search", campaign], locationsKey(campaign)];
}

/** The chips in the order the row shows them. */
type ChipKey = "chapter" | "roll20Page";

export function LocationEditMode({
  campaign,
  location,
  tree,
  onClose,
}: {
  campaign: string;
  /** The location on screen when the edit started; mount per location (`key`). */
  location: Location;
  /** For the chapter chip — the chapters that exist. */
  tree: CampaignTree | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const form = useFieldsForm(locationFormValues(location));
  const draft = useBodyDraft(location.body);
  const edit = useLocationEdit(campaign, location, {
    onSaved: onClose,
    // Continue from what is stored: fields and text are refilled from that location.
    onReload: (stored) => {
      form.reseed(locationFormValues(stored));
      draft.reseed(stored.body);
    },
    invalidateOnSuccess: staleAfterWrite(campaign),
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const values = form.values;
  const fieldChange = locationFormChange(form.initial, values);
  const bodyChanged = draft.body !== draft.baseline;
  const change: LocationChange = { ...fieldChange, ...(bodyChanged ? { body: draft.body } : {}) };
  const changes = Object.keys(change).length;
  const draftIssues = useDraftIssues(draft.draft);
  const textBlocked = Object.keys(draftIssues).length > 0;
  const nameBlocked = !canSubmitLocationForm(values);
  const canSave = changes > 0 && !nameBlocked && !textBlocked;
  const dirty = bodyChanged || locationFormDirty(form.initial, values);
  useUnsavedChanges(dirty);

  const set = <K extends keyof LocationFormValues>(key: K, value: LocationFormValues[K]) =>
    form.setValues({ ...values, [key]: value });
  const cancel = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const changed = (key: keyof LocationFormValues) => key in fieldChange;

  // --- the chips -----------------------------------------------------------------
  const chapters = (tree?.chapters ?? []).map((chapter) => ({
    value: chapter.id,
    label: chapter.title,
  }));
  const chapterId = values.chapter.trim();
  const chapterTitle =
    chapterId === "" ? undefined : (chapters.find((c) => c.value === chapterId)?.label ?? chapterId);
  const roll20Page = values.roll20Page.trim();
  const labels = {
    chapter: t("properties.location.chapter.label"),
    roll20Page: t("properties.location.roll20.label"),
  } satisfies Record<ChipKey, string>;
  const keyed = (label: string, value: string) => (
    <>
      <span className="text-dim">{label}</span>
      <span className="truncate">{value}</span>
    </>
  );

  const chips: FieldChip[] = [
    {
      key: "chapter",
      label: labels.chapter,
      summary: chapterTitle ?? "",
      empty: chapterTitle === undefined,
      changed: changed("chapter"),
      content:
        chapterTitle === undefined ? (
          <span>{labels.chapter}</span>
        ) : (
          keyed(labels.chapter, chapterTitle)
        ),
      editor: (
        <PickList
          label={labels.chapter}
          value={chapterId}
          options={[{ value: "", label: t("locationEdit.chapter.none") }, ...chapters]}
          onChange={(value) => set("chapter", value)}
        />
      ),
    },
    {
      key: "roll20Page",
      label: labels.roll20Page,
      summary: roll20Page,
      empty: roll20Page === "",
      changed: changed("roll20Page"),
      content:
        roll20Page === "" ? <span>{labels.roll20Page}</span> : keyed(labels.roll20Page, roll20Page),
      editor: (
        <TextField
          id={fieldId("roll20Page")}
          label={labels.roll20Page}
          labelHidden
          hint={t("properties.location.roll20.hint")}
          value={values.roll20Page}
          onChange={(value) => set("roll20Page", value)}
        />
      ),
    },
  ];

  // --- the atmosphere ------------------------------------------------------------
  const atmosphereLabel = t("properties.location.atmosphere.label");
  const atmosphere = values.atmosphere.trim();

  // A write error wins the line; without one it says why the save is dead.
  const blockedMessage = textBlocked
    ? t("bodyEditor.blocked")
    : nameBlocked
      ? t("locationEdit.blocked.name")
      : "";

  return (
    <article className="w-full min-w-0">
      {/* A refused write asks instead of deciding — above the name, where
          the DM looks first; the draft is untouched below it. */}
      {edit.conflict !== undefined && (
        <div className="mb-3 rounded-lg border border-warn bg-warn/10 px-3 py-2">
          <EditConflict onReload={edit.reload} onForce={edit.forceSave} busy={edit.isSaving} />
        </div>
      )}
      <EditModeHeader
        heading={t("locationEdit.heading")}
        save={{
          changes,
          canSave,
          isSaving: edit.isSaving,
          onSave: () => edit.save(change),
          onCancel: cancel,
        }}
      />
      <EditTitleInput
        value={values.name}
        onChange={(name) => set("name", name)}
        label={t("locationEdit.name.aria")}
        placeholder={t("locationEdit.name.aria")}
      />
      <div className="mt-2 border-b border-border pb-4">
        <FieldChipRow fields={chips} />
      </div>
      <FieldSection
        title={atmosphereLabel}
        summary={atmosphere === "" ? t("locationEdit.atmosphere.empty") : atmosphere}
        changes={changed("atmosphere") ? 1 : 0}
        testId="location-atmosphere-toggle"
      >
        <SectionField changed={changed("atmosphere")}>
          <TextField
            id={fieldId("atmosphere")}
            label={atmosphereLabel}
            labelHidden
            hint={t("properties.location.atmosphere.hint")}
            multiline
            value={values.atmosphere}
            onChange={(value) => set("atmosphere", value)}
          />
        </SectionField>
      </FieldSection>
      <p aria-live="polite" className="min-h-[17px] pt-1.5 text-[12px] text-destructive">
        {edit.message ?? blockedMessage}
      </p>
      {/* Full width on the phone: the frame loses its sides there. */}
      <div className="mt-1.5 max-md:-mx-5 max-md:[&>div]:rounded-none max-md:[&>div]:border-x-0">
        <BodyEditorSurface
          editorKey={`location-${location.id}`}
          label={location.name === "" ? location.id : location.name}
          draft={draft}
          issues={draftIssues}
        />
      </div>
      {confirmDiscard && (
        <DiscardChangesDialog
          onKeep={() => setConfirmDiscard(false)}
          onDiscard={() => {
            setConfirmDiscard(false);
            onClose();
          }}
        />
      )}
    </article>
  );
}
