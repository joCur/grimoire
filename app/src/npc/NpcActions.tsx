// The editing surfaces of an npc's reading view (ADR #31): the body editor
// with the `motivation` field beside the text, and the dialog over the npc's
// other fields. Both are shared surfaces (BodyEditor, FieldsDialog) over the
// npc's own form (./npc-form.ts) and its own editing session
// (./use-npc-edit.ts): the fields a surface changed become ONE npc PATCH.

import type { CampaignTree, Npc } from "@grimoire/shared/types";

import { BodyEditor, useBodyDraft } from "@/components/EntryBodyEditor";
import { FieldsDialog, FieldsDialogAction, useFieldsForm } from "@/components/fields/FieldsDialog";
import { useT } from "@/i18n";

import { NpcFields, NpcMotivationField } from "./NpcFields";
import {
  canSubmitNpcForm,
  npcFormChange,
  npcFormDirty,
  npcFormIssues,
  npcFormValues,
} from "./npc-form";
import { npcsKey } from "./npc-query";
import { useNpcEdit } from "./use-npc-edit";

/**
 * The queries an npc write makes stale beside the npc itself: the tree (name,
 * role and status in every list), ⌘K, the npc list, and every scene whose
 * aside card reads the npc — those read the npc's own query, which the write
 * seeds.
 */
function staleAfterWrite(campaign: string) {
  return [
    ["tree", campaign],
    ["search", campaign],
    npcsKey(campaign),
  ];
}

/** The body editor of an npc: its text, and its `motivation` beside it. */
export function NpcBodyEditor({
  campaign,
  npc,
  onClose,
}: {
  campaign: string;
  /** The npc on screen when the edit started; mount per npc (`key`). */
  npc: Npc;
  onClose: () => void;
}) {
  const t = useT();
  const draft = useBodyDraft(npc.body);
  const form = useFieldsForm(npcFormValues(npc));
  const edit = useNpcEdit(campaign, npc, {
    onSaved: onClose,
    onReload: (stored) => {
      draft.reseed(stored.body);
      form.reseed(npcFormValues(stored));
    },
    invalidateOnSuccess: staleAfterWrite(campaign),
  });
  return (
    <BodyEditor
      editorKey={`npc-${npc.id}`}
      label={npc.name}
      fields={{
        controls: (
          <NpcMotivationField
            value={form.values.motivation}
            onChange={(motivation) => form.setValues({ ...form.values, motivation })}
          />
        ),
        labels: [t("properties.npc.motivation.label")],
        change: npcFormChange(form.initial, form.values),
      }}
      draft={draft}
      session={{
        ...edit,
        save: (change) =>
          edit.save({
            ...change.fields,
            ...(change.body === undefined ? {} : { body: change.body }),
          }),
      }}
      onClose={onClose}
    />
  );
}

/**
 * The dialog action of an npc — bound to ONE npc: navigating away closes it
 * instead of leaving it standing over another npc's reading view.
 */
export function NpcFieldsAction({
  campaign,
  npc,
  tree,
}: {
  campaign: string;
  npc: Npc;
  /** For the chapter field. */
  tree: CampaignTree | undefined;
}) {
  return (
    <FieldsDialogAction openKey={`${campaign}/${npc.id}`}>
      {(onClose) => (
        <NpcFieldsDialog campaign={campaign} npc={npc} tree={tree} onClose={onClose} />
      )}
    </FieldsDialogAction>
  );
}

function NpcFieldsDialog({
  campaign,
  npc,
  tree,
  onClose,
}: {
  campaign: string;
  npc: Npc;
  tree: CampaignTree | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const form = useFieldsForm(npcFormValues(npc));
  const save = useNpcEdit(campaign, npc, {
    onSaved: onClose,
    // Continue from what is stored: the form is refilled from that npc.
    onReload: (stored) => form.reseed(npcFormValues(stored)),
    invalidateOnSuccess: staleAfterWrite(campaign),
    errorMessage: "write.properties.failed",
  });
  const change = npcFormChange(form.initial, form.values);
  return (
    <FieldsDialog
      title={t("properties.title", { kind: t("kind.npc") })}
      idLabel={npc.id}
      canSubmit={canSubmitNpcForm(form.values, t) && Object.keys(change).length > 0}
      dirty={npcFormDirty(form.initial, form.values, t)}
      onSubmit={() => save.save(change)}
      session={save}
      onClose={onClose}
    >
      <NpcFields
        values={form.values}
        issues={npcFormIssues(form.values, t)}
        tree={tree}
        onChange={form.setValues}
      />
    </FieldsDialog>
  );
}
