// The editing surfaces of an npc's reading view (ADR #31): the body editor
// with the `motivation` field beside the text, and the dialog over the npc's
// other fields. Both are the surfaces every kind shares
// (./EntryBodyEditor.tsx `BodyEditor`, ./PropertiesAction.tsx
// `PropertiesDialog`) over the npc's own editing session
// (lib/use-npc-edit.ts): the fields a surface changed become ONE npc PATCH,
// checked against the npc's schema before it is sent.

import { npcChangeSchema } from "@grimoire/shared/npc";
import type { CampaignTree, Npc, NpcChange } from "@grimoire/shared/types";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BodyEditor, useBodyDraft, type BodyEditSession } from "@/components/EntryBodyEditor";
import { HeaderAction } from "@/components/HeaderAction";
import { PropertiesDialog, usePropertiesForm } from "@/components/PropertiesAction";
import { useT } from "@/i18n";
import type { BodyEditChange } from "@/lib/entry-body";
import {
  propertiesFieldsFor,
  propertiesFormValues,
  propertiesKindLabel,
  type PropertiesField,
} from "@/lib/properties-form";
import { useNpcEdit } from "@/lib/use-npc-edit";

/**
 * What a surface changed, as the npc's write: the fields beside `body`,
 * checked against the npc's schema — a key the npc does not have is a bug
 * here, not a request the server has to refuse.
 */
function npcChange(change: BodyEditChange): NpcChange {
  return npcChangeSchema.parse({
    ...change.fields,
    ...(change.body === undefined ? {} : { body: change.body }),
  });
}

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
    ["npcs", campaign],
  ];
}

/** The fields of an npc one surface edits — the dialog, or the text (`motivation`). */
function useNpcFields(surface: "dialog" | "text"): readonly PropertiesField[] {
  const t = useT();
  return useMemo(() => propertiesFieldsFor("npc", t, surface) ?? [], [t, surface]);
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
  const fields = useNpcFields("text");
  const draft = useBodyDraft({ body: npc.body, values: propertiesFormValues(fields, npc) }, fields);
  const edit = useNpcEdit(campaign, npc, {
    onSaved: onClose,
    onReload: (stored) =>
      draft.reseed({ body: stored.body, values: propertiesFormValues(fields, stored) }),
    invalidateOnSuccess: staleAfterWrite(campaign),
  });
  const session: BodyEditSession = {
    ...edit,
    save: (change) => edit.save(npcChange(change)),
  };
  return (
    <BodyEditor
      editorKey={`npc-${npc.id}`}
      label={npc.name}
      fields={fields}
      draft={draft}
      session={session}
      onClose={onClose}
    />
  );
}

/**
 * The dialog action of an npc — the same quiet trigger as every other kind's,
 * bound to ONE npc: navigating away closes it instead of leaving it standing
 * over another npc's reading view.
 */
export function NpcPropertiesAction({
  campaign,
  npc,
  tree,
}: {
  campaign: string;
  npc: Npc;
  /** For the chapter reference field. */
  tree: CampaignTree | undefined;
}) {
  const t = useT();
  const npcKeyOf = `${campaign}/${npc.id}`;
  const [openFor, setOpenFor] = useState<string>();
  useEffect(() => {
    setOpenFor(undefined);
  }, [npcKeyOf]);
  const kindLabel = propertiesKindLabel("npc", t) ?? "";
  return (
    <>
      <HeaderAction
        icon={SlidersHorizontal}
        label={t("properties.action")}
        onClick={() => setOpenFor(npcKeyOf)}
      />
      {openFor === npcKeyOf && (
        <NpcPropertiesDialog
          key={npcKeyOf}
          campaign={campaign}
          npc={npc}
          tree={tree}
          kindLabel={kindLabel}
          onClose={() => setOpenFor(undefined)}
        />
      )}
    </>
  );
}

function NpcPropertiesDialog({
  campaign,
  npc,
  tree,
  kindLabel,
  onClose,
}: {
  campaign: string;
  npc: Npc;
  tree: CampaignTree | undefined;
  kindLabel: string;
  onClose: () => void;
}) {
  const fields = useNpcFields("dialog");
  const form = usePropertiesForm(propertiesFormValues(fields, npc));
  const save = useNpcEdit(campaign, npc, {
    onSaved: onClose,
    // Continue from what is stored: the form is refilled from that npc.
    onReload: (stored) => form.reseed(propertiesFormValues(fields, stored)),
    invalidateOnSuccess: staleAfterWrite(campaign),
    errorMessage: "write.properties.failed",
  });
  return (
    <PropertiesDialog
      idLabel={npc.id}
      tree={tree}
      fields={fields}
      kindLabel={kindLabel}
      form={form}
      session={{ ...save, save: (patch) => save.save(npcChange({ fields: patch })) }}
      onClose={onClose}
    />
  );
}
