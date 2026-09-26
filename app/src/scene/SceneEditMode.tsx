// The edit mode of a scene's reading view: the text is the surface. The
// reading view's own article turns editable in place —
//
//   header   "edit scene" with the status control right beside it; the save
//            actions and the count of changes at the right end on the
//            desktop, in a bar at the bottom of the screen on the phone.
//   title    editable in place, the heading's serif without a box.
//   trigger  a line of its own under the title, for a contingency scene only;
//            a planned scene offers it as a dashed chip that turns the scene
//            into a contingency one.
//   chips    type, location, npcs, tags, handouts and chapter as one row of
//            chips; a chip opens only its field (components/FieldChips.tsx).
//   text     the body editor surface, taking the rest of the page.
//
// Everything on the page is ONE draft over the scene's one row with its one
// guard (decisions/writes): the form of its fields (./scene-form.ts), the text
// (the body draft) and the status. A save is one PATCH with exactly the fields
// that changed, through the scene's editing session (./use-scene-edit.ts). A
// refused save (409) keeps the whole draft and puts the shared conflict line
// above the title: reload continues from the stored scene, save anyway resends
// the changed fields on top of it, so a field changed elsewhere survives.
//
// Leaving with unsaved work asks first — the cancel action here, and a
// navigation through the page's unsaved-changes guard.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import { SCENE_TYPES, type Scene, type SceneChange, type SceneType } from "@grimoire/shared/scene";
import { Bookmark, GitFork, MapPin, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { BodyEditorSurface, useBodyDraft, useDraftIssues } from "@/components/BodyEditor";
import { DiscardChangesDialog } from "@/components/DiscardChangesDialog";
import { EditConflict } from "@/components/EditConflict";
import { EditLineInput, EditModeHeader, EditTitleInput } from "@/components/EditMode";
import { ChipAction, FieldChipRow, type FieldChip } from "@/components/FieldChips";
import { ChipsField } from "@/components/fields/ChipsField";
import { fieldId } from "@/components/fields/FieldRow";
import { useFieldsForm } from "@/components/fields/FieldsDialog";
import { PickList } from "@/components/fields/PickList";
import type { FieldOption } from "@/components/fields/SelectField";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { useT, type MessageKey } from "@/i18n";
import { locationName } from "@/lib/campaign";

import { SceneStatusMenu } from "./SceneStatusMenu";
import {
  canSubmitSceneForm,
  sceneFormChange,
  sceneFormDirty,
  sceneFormIssues,
  sceneFormValues,
  withPendingChips,
  type SceneFormValues,
  type SceneListKey,
  type ScenePendingChips,
} from "./scene-form";
import { useSceneEdit } from "./use-scene-edit";

/**
 * The queries a scene write makes stale beside the scene itself: the tree
 * (title, type, status, location and chapter in every list — a new chapter
 * moves the scene to the end of that chapter) and ⌘K.
 */
function staleAfterWrite(campaign: string) {
  return [
    ["tree", campaign],
    ["search", campaign],
  ];
}

const TYPE_LABELS: Record<SceneType, { label: MessageKey; hint: MessageKey }> = {
  planned: { label: "sceneArticle.type.planned", hint: "sceneEdit.type.planned.hint" },
  contingency: { label: "sceneArticle.type.contingency", hint: "sceneEdit.type.contingency.hint" },
};

/** The chips in the order the row shows them; the phone shows the first three. */
type ChipKey = "type" | "location" | "npcs" | "tags" | "handouts" | "chapter";

export function SceneEditMode({
  campaign,
  scene,
  tree,
  onClose,
}: {
  campaign: string;
  /** The scene on screen when the edit started; mount per scene (`key`). */
  scene: Scene;
  /** For the chips that name other rows — chapters, locations, npcs. */
  tree: CampaignTree | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const form = useFieldsForm(sceneFormValues(scene));
  // Text still standing in a chip input, per list — a save folds it in.
  const [pending, setPending] = useState<ScenePendingChips>({});
  const draft = useBodyDraft(scene.body);
  const edit = useSceneEdit(campaign, scene, {
    onSaved: onClose,
    // Continue from what is stored: fields, chips and text are refilled
    // from that scene.
    onReload: (stored) => {
      form.reseed(sceneFormValues(stored));
      setPending({});
      draft.reseed(stored.body);
    },
    invalidateOnSuccess: staleAfterWrite(campaign),
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The trigger line appears when the scene turns into a contingency one
  // through its dashed chip, and the cursor goes there with it.
  const [focusTrigger, setFocusTrigger] = useState(false);
  useEffect(() => {
    if (!focusTrigger) return;
    document.getElementById(fieldId("trigger"))?.focus();
    setFocusTrigger(false);
  }, [focusTrigger]);

  const values = form.values;
  const effective = withPendingChips(values, pending);
  const fieldChange = sceneFormChange(form.initial, effective);
  const bodyChanged = draft.body !== draft.baseline;
  const change: SceneChange = { ...fieldChange, ...(bodyChanged ? { body: draft.body } : {}) };
  const changes = Object.keys(change).length;
  const issues = sceneFormIssues(effective, form.initial, t);
  const draftIssues = useDraftIssues(draft.draft);
  const textBlocked = Object.keys(draftIssues).length > 0;
  const fieldsBlocked = Object.keys(issues).length > 0;
  const titleBlocked = values.title.trim() === "";
  const canSave =
    changes > 0 && canSubmitSceneForm(form.initial, effective, t) && !textBlocked;
  const dirty = bodyChanged || sceneFormDirty(form.initial, effective, t);
  useUnsavedChanges(dirty);

  const set = <K extends keyof SceneFormValues>(key: K, value: SceneFormValues[K]) =>
    form.setValues({ ...values, [key]: value });
  const cancel = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  // --- the chips -----------------------------------------------------------------
  const chapters: FieldOption[] = (tree?.chapters ?? []).map((chapter) => ({
    value: chapter.id,
    label: chapter.title,
  }));
  const locations: FieldOption[] = (tree?.locations ?? []).map((location) => ({
    value: location.id,
    label: location.name,
  }));
  const npcs: FieldOption[] = (tree?.npcs ?? []).map((npc) => ({ value: npc.id, label: npc.name }));
  const npcName = (id: string) => npcs.find((npc) => npc.value === id)?.label ?? id;
  const chapterTitle = (id: string) =>
    chapters.find((chapter) => chapter.value === id)?.label ?? id;

  const list = (key: SceneListKey, title: string) => (
    <ChipsField
      id={fieldId(key)}
      label={title}
      labelHidden
      items={values[key]}
      pending={pending[key] ?? ""}
      onChange={(items) => set(key, items)}
      onPendingChange={(text) => setPending({ ...pending, [key]: text })}
      {...(key === "npcs" ? { options: npcs } : {})}
      {...(issues[key] === undefined ? {} : { issue: issues[key] })}
    />
  );
  const keyed = (label: string, value: string) => (
    <>
      <span className="text-dim">{label}</span>
      <span className="truncate">{value}</span>
    </>
  );
  const typeLabel = t(TYPE_LABELS[values.type].label);
  const location = locationName(tree, values.location.trim() === "" ? undefined : values.location);
  const shownList = (key: SceneListKey, name: (item: string) => string = (item) => item) =>
    effective[key].map(name).join(", ");
  const changed = (key: ChipKey) => key in fieldChange;
  const labels = {
    type: t("properties.scene.type.label"),
    location: t("properties.scene.location.label"),
    npcs: t("properties.scene.npcs.label"),
    tags: t("properties.scene.tags.label"),
    handouts: t("properties.scene.handouts.label"),
    chapter: t("properties.scene.chapter.label"),
  } satisfies Record<ChipKey, string>;

  const chips: FieldChip[] = [
    {
      key: "type",
      label: labels.type,
      summary: typeLabel,
      empty: false,
      changed: changed("type"),
      content: (
        <>
          {values.type === "contingency" ? (
            <GitFork aria-hidden size={13} className="flex-none text-muted-foreground" />
          ) : (
            <Bookmark aria-hidden size={13} className="flex-none text-muted-foreground" />
          )}
          <span className="truncate">{typeLabel}</span>
        </>
      ),
      editor: (
        <PickList
          label={labels.type}
          value={values.type}
          options={SCENE_TYPES.map((type) => ({
            value: type,
            label: t(TYPE_LABELS[type].label),
            hint: t(TYPE_LABELS[type].hint),
          }))}
          onChange={(value) => {
            const type = SCENE_TYPES.find((known) => known === value);
            if (type !== undefined) set("type", type);
          }}
        />
      ),
    },
    {
      key: "location",
      label: labels.location,
      summary: location ?? "",
      empty: location === undefined,
      changed: changed("location"),
      invalid: issues.location !== undefined,
      content:
        location === undefined ? (
          <span>{labels.location}</span>
        ) : (
          <>
            <MapPin aria-hidden size={13} className="flex-none text-muted-foreground" />
            <span className="truncate">{location}</span>
          </>
        ),
      editor: (
        <PickList
          label={labels.location}
          value={values.location.trim()}
          options={[{ value: "", label: t("sceneEdit.location.none") }, ...locations]}
          onChange={(value) => set("location", value)}
          search={{
            placeholder: t("sceneEdit.location.search"),
            noMatch: t("sceneEdit.location.noMatch"),
          }}
        />
      ),
    },
    {
      key: "npcs",
      label: labels.npcs,
      title: t("sceneEdit.npcs.title"),
      summary: shownList("npcs", npcName),
      empty: effective.npcs.length === 0,
      changed: changed("npcs"),
      invalid: issues.npcs !== undefined,
      content:
        effective.npcs.length === 0 ? (
          <span>{labels.npcs}</span>
        ) : (
          keyed(labels.npcs, shownList("npcs", npcName))
        ),
      editor: list("npcs", t("sceneEdit.npcs.title")),
    },
    {
      key: "tags",
      label: labels.tags,
      summary: shownList("tags"),
      empty: effective.tags.length === 0,
      changed: changed("tags"),
      content:
        effective.tags.length === 0 ? (
          <span>{labels.tags}</span>
        ) : (
          keyed(labels.tags, shownList("tags"))
        ),
      editor: list("tags", labels.tags),
    },
    {
      key: "handouts",
      label: labels.handouts,
      title: t("sceneEdit.handouts.title"),
      summary: shownList("handouts"),
      empty: effective.handouts.length === 0,
      changed: changed("handouts"),
      content:
        effective.handouts.length === 0 ? (
          <span>{labels.handouts}</span>
        ) : (
          keyed(labels.handouts, shownList("handouts"))
        ),
      editor: list("handouts", t("sceneEdit.handouts.title")),
    },
    {
      key: "chapter",
      label: labels.chapter,
      summary: chapterTitle(values.chapter),
      empty: false,
      changed: changed("chapter"),
      invalid: issues.chapter !== undefined,
      content: keyed(labels.chapter, chapterTitle(values.chapter)),
      editor: (
        <PickList
          label={labels.chapter}
          value={values.chapter}
          options={chapters}
          onChange={(value) => set("chapter", value)}
        />
      ),
    },
  ];

  // A write error wins the line; without one it says why the save is dead.
  const blockedMessage = textBlocked
    ? t("bodyEditor.blocked")
    : fieldsBlocked
      ? t("editMode.blocked.fields")
      : titleBlocked
        ? t("sceneEdit.blocked.title")
        : "";

  return (
    <article className="w-full min-w-0">
      {/* A refused write asks instead of deciding — above the title, where
          the DM looks first; the draft is untouched below it. */}
      {edit.conflict !== undefined && (
        <div className="mb-3 rounded-lg border border-warn bg-warn/10 px-3 py-2">
          <EditConflict onReload={edit.reload} onForce={edit.forceSave} busy={edit.isSaving} />
        </div>
      )}
      <EditModeHeader
        heading={t("sceneEdit.heading")}
        status={
          <SceneStatusMenu
            status={values.status}
            variant="pill"
            onSelect={(status) => set("status", status)}
          />
        }
        save={{
          changes,
          canSave,
          isSaving: edit.isSaving,
          onSave: () => edit.save(change),
          onCancel: cancel,
        }}
      />
      <EditTitleInput
        value={values.title}
        onChange={(title) => set("title", title)}
        label={t("sceneEdit.title.aria")}
        placeholder={t("sceneEdit.title.aria")}
      />
      {values.type === "contingency" && (
        <EditLineInput
          id={fieldId("trigger")}
          label={t("sceneArticle.trigger.label")}
          value={values.trigger}
          onChange={(trigger) => set("trigger", trigger)}
          placeholder={t("sceneEdit.trigger.placeholder")}
        />
      )}
      <div className="mt-3 border-b border-border pb-4">
        <FieldChipRow
          fields={chips}
          after={
            values.type === "planned" ? (
              <ChipAction
                onClick={() => {
                  set("type", "contingency");
                  setFocusTrigger(true);
                }}
              >
                <Plus aria-hidden size={12} className="flex-none" />
                {t("sceneEdit.trigger.add")}
              </ChipAction>
            ) : undefined
          }
        />
      </div>
      <p aria-live="polite" className="min-h-[17px] pt-1.5 text-[12px] text-destructive">
        {edit.message ?? blockedMessage}
      </p>
      {/* Full width on the phone: the frame loses its sides there. */}
      <div className="mt-1.5 max-md:-mx-5 max-md:[&>div]:rounded-none max-md:[&>div]:border-x-0">
        <BodyEditorSurface
          editorKey={`scene-${scene.id}`}
          label={scene.title === "" ? scene.id : scene.title}
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
