// The editing surfaces of a scene's reading view (decisions/resources): the body editor
// over the scene's text, and the dialog over its other fields. Both are
// shared surfaces (BodyEditor, FieldsDialog) over the scene's own form
// (./scene-form.ts) and its own editing session (./use-scene-edit.ts): what a
// surface changed becomes ONE scene PATCH.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { Scene } from "@grimoire/shared/scene";
import { useState } from "react";

import { BodyEditor, useBodyDraft } from "@/components/BodyEditor";
import { FieldsDialog, FieldsDialogAction, useFieldsForm } from "@/components/fields/FieldsDialog";
import { useT } from "@/i18n";

import { SceneFields } from "./SceneFields";
import {
  canSubmitSceneForm,
  sceneFormChange,
  sceneFormDirty,
  sceneFormIssues,
  sceneFormValues,
  withPendingChips,
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

/** The body editor of a scene: its text. */
export function SceneBodyEditor({
  campaign,
  scene,
  onClose,
}: {
  campaign: string;
  /** The scene on screen when the edit started; mount per scene (`key`). */
  scene: Scene;
  onClose: () => void;
}) {
  const draft = useBodyDraft(scene.body);
  const edit = useSceneEdit(campaign, scene, {
    onSaved: onClose,
    onReload: (stored) => draft.reseed(stored.body),
    invalidateOnSuccess: staleAfterWrite(campaign),
  });
  return (
    <BodyEditor
      editorKey={`scene-${scene.id}`}
      label={scene.title === "" ? scene.id : scene.title}
      draft={draft}
      session={{
        ...edit,
        save: (change) => edit.save(change.body === undefined ? {} : { body: change.body }),
      }}
      onClose={onClose}
    />
  );
}

/**
 * The dialog action of a scene — bound to ONE scene: navigating away closes
 * it instead of leaving it standing over another scene's reading view.
 */
export function SceneFieldsAction({
  campaign,
  scene,
  tree,
}: {
  campaign: string;
  scene: Scene;
  /** For the reference fields. */
  tree: CampaignTree | undefined;
}) {
  return (
    <FieldsDialogAction openKey={`${campaign}/${scene.id}`}>
      {(onClose) => (
        <SceneFieldsDialog campaign={campaign} scene={scene} tree={tree} onClose={onClose} />
      )}
    </FieldsDialogAction>
  );
}

function SceneFieldsDialog({
  campaign,
  scene,
  tree,
  onClose,
}: {
  campaign: string;
  scene: Scene;
  tree: CampaignTree | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const form = useFieldsForm(sceneFormValues(scene));
  // Text still standing in a chip input, per list — a save folds it in.
  const [pending, setPending] = useState<ScenePendingChips>({});
  const save = useSceneEdit(campaign, scene, {
    onSaved: onClose,
    // Continue from what is stored: the form is refilled from that scene.
    onReload: (stored) => {
      form.reseed(sceneFormValues(stored));
      setPending({});
    },
    invalidateOnSuccess: staleAfterWrite(campaign),
    errorMessage: "write.properties.failed",
  });
  const effective = withPendingChips(form.values, pending);
  const change = sceneFormChange(form.initial, effective);
  return (
    <FieldsDialog
      title={t("properties.title", { kind: t("kind.scene") })}
      idLabel={scene.id}
      canSubmit={canSubmitSceneForm(form.initial, effective, t) && Object.keys(change).length > 0}
      dirty={sceneFormDirty(form.initial, effective, t)}
      onSubmit={() => save.save(change)}
      session={save}
      onClose={onClose}
    >
      <SceneFields
        values={form.values}
        pending={pending}
        issues={sceneFormIssues(effective, form.initial, t)}
        tree={tree}
        onChange={form.setValues}
        onPendingChange={setPending}
      />
    </FieldsDialog>
  );
}
