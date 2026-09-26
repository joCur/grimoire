// The edit mode of an npc's reading view: the text is the surface. The
// reading view's own article turns editable in place —
//
//   header   "edit npc" with the status control right beside it; the save
//            actions and the count of changes at the right end on the
//            desktop, in a bar at the bottom of the screen on the phone.
//   name     editable in place, the heading's serif without a box.
//   chips    quick stats, statblock and chapter as one row of chips; a chip
//            opens only its field (components/FieldChips.tsx).
//   profile  role, voice, appearance and motivation — the prose lines too
//            long for a chip — as one collapsible section, a single line
//            while it is closed (components/FieldSection.tsx).
//   text     the body editor surface, taking the rest of the page.
//
// Everything on the page is ONE draft over the npc's one row with its one
// guard (decisions/writes): the form of its fields (./npc-form.ts), the text
// (the body draft) and the status. A save is one PATCH with exactly the fields
// that changed, through the npc's editing session (./use-npc-edit.ts). A
// refused save (409) keeps the whole draft and puts the shared conflict line
// above the name: reload continues from the stored npc, save anyway resends
// the changed fields on top of it, so a field changed elsewhere survives.
//
// Leaving with unsaved work asks first — the cancel action here, and a
// navigation through the page's unsaved-changes guard.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { Npc, NpcChange } from "@grimoire/shared/npc";
import { useState } from "react";

import { BodyEditorSurface, useBodyDraft, useDraftIssues } from "@/components/BodyEditor";
import { DiscardChangesDialog } from "@/components/DiscardChangesDialog";
import { EditConflict } from "@/components/EditConflict";
import { EditModeHeader, EditTitleInput } from "@/components/EditMode";
import { FieldChipRow, type FieldChip } from "@/components/FieldChips";
import { FieldSection, SectionField } from "@/components/FieldSection";
import { fieldId } from "@/components/fields/FieldRow";
import { useFieldsForm } from "@/components/fields/FieldsDialog";
import { PairsField } from "@/components/fields/PairsField";
import { PickList } from "@/components/fields/PickList";
import { TextField } from "@/components/fields/TextField";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { useT } from "@/i18n";

import { NpcStatusMenu } from "./NpcStatusMenu";
import {
  canSubmitNpcForm,
  npcFormChange,
  npcFormDirty,
  npcFormIssues,
  npcFormValues,
  type NpcFormValues,
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
  return [["tree", campaign], ["search", campaign], npcsKey(campaign)];
}

/** The chips in the order the row shows them. */
type ChipKey = "quickstats" | "statblock" | "chapter";

/** The fields of the profile section, in the order it shows them. */
const PROFILE_KEYS = ["role", "voice", "appearance", "motivation"] as const;
type ProfileKey = (typeof PROFILE_KEYS)[number];

export function NpcEditMode({
  campaign,
  npc,
  tree,
  onClose,
}: {
  campaign: string;
  /** The npc on screen when the edit started; mount per npc (`key`). */
  npc: Npc;
  /** For the chapter chip — the chapters that exist. */
  tree: CampaignTree | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const form = useFieldsForm(npcFormValues(npc));
  const draft = useBodyDraft(npc.body);
  const edit = useNpcEdit(campaign, npc, {
    onSaved: onClose,
    // Continue from what is stored: fields and text are refilled from that npc.
    onReload: (stored) => {
      form.reseed(npcFormValues(stored));
      draft.reseed(stored.body);
    },
    invalidateOnSuccess: staleAfterWrite(campaign),
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const values = form.values;
  const fieldChange = npcFormChange(form.initial, values);
  const bodyChanged = draft.body !== draft.baseline;
  const change: NpcChange = { ...fieldChange, ...(bodyChanged ? { body: draft.body } : {}) };
  const changes = Object.keys(change).length;
  const issues = npcFormIssues(values, t);
  const draftIssues = useDraftIssues(draft.draft);
  const textBlocked = Object.keys(draftIssues).length > 0;
  const fieldsBlocked = Object.keys(issues).length > 0;
  const nameBlocked = values.name.trim() === "";
  const canSave = changes > 0 && canSubmitNpcForm(values, t) && !textBlocked;
  const dirty = bodyChanged || npcFormDirty(form.initial, values, t);
  useUnsavedChanges(dirty);

  const set = <K extends keyof NpcFormValues>(key: K, value: NpcFormValues[K]) =>
    form.setValues({ ...values, [key]: value });
  const cancel = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  // A field counts as changed while its editor shows something else than
  // what is stored — also a quick stat row that does not write yet.
  const changed = (key: ChipKey | ProfileKey) =>
    key in fieldChange || (key === "quickstats" && issues.quickstats !== undefined);

  // --- the chips -----------------------------------------------------------------
  const chapters = (tree?.chapters ?? []).map((chapter) => ({
    value: chapter.id,
    label: chapter.title,
  }));
  const chapterId = values.chapter.trim();
  const chapterTitle =
    chapterId === "" ? undefined : (chapters.find((c) => c.value === chapterId)?.label ?? chapterId);
  const stats = values.quickstats
    .filter((pair) => pair.key.trim() !== "")
    .map((pair) => `${pair.key.trim()} ${pair.value.trim()}`.trim())
    .join(", ");
  const statblock = values.statblock.trim();
  const labels = {
    quickstats: t("properties.npc.quickstats.label"),
    statblock: t("properties.npc.statblock.label"),
    chapter: t("properties.npc.chapter.label"),
  } satisfies Record<ChipKey, string>;
  const keyed = (label: string, value: string, mono = false) => (
    <>
      <span className="text-dim">{label}</span>
      <span className={mono ? "truncate font-mono text-[11.5px]" : "truncate"}>{value}</span>
    </>
  );

  const chips: FieldChip[] = [
    {
      key: "quickstats",
      label: labels.quickstats,
      summary: stats,
      empty: stats === "",
      changed: changed("quickstats"),
      invalid: issues.quickstats !== undefined,
      content: stats === "" ? <span>{labels.quickstats}</span> : keyed(labels.quickstats, stats, true),
      editor: (
        <PairsField
          label={labels.quickstats}
          labelHidden
          hint={t("properties.npc.quickstats.hint")}
          {...(issues.quickstats === undefined ? {} : { issue: issues.quickstats })}
          pairs={values.quickstats}
          onChange={(quickstats) => set("quickstats", quickstats)}
        />
      ),
    },
    {
      key: "statblock",
      label: labels.statblock,
      summary: statblock,
      empty: statblock === "",
      changed: changed("statblock"),
      content:
        statblock === "" ? <span>{labels.statblock}</span> : keyed(labels.statblock, statblock),
      editor: (
        <TextField
          id={fieldId("statblock")}
          label={labels.statblock}
          labelHidden
          hint={t("properties.npc.statblock.hint")}
          placeholder={t("properties.npc.statblock.placeholder")}
          value={values.statblock}
          onChange={(value) => set("statblock", value)}
        />
      ),
    },
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
        <>
          <p className="text-[11.5px] text-faint">{t("properties.npc.chapter.hint")}</p>
          <PickList
            label={labels.chapter}
            value={chapterId}
            options={[{ value: "", label: t("npcEdit.chapter.none") }, ...chapters]}
            onChange={(value) => set("chapter", value)}
          />
        </>
      ),
    },
  ];

  // --- the profile -----------------------------------------------------------------
  const profile: Record<ProfileKey, { label: string; hint: string; multiline: boolean }> = {
    role: {
      label: t("properties.npc.role.label"),
      hint: t("properties.npc.role.hint"),
      multiline: false,
    },
    voice: {
      label: t("properties.npc.voice.label"),
      hint: t("properties.npc.voice.hint"),
      multiline: true,
    },
    appearance: {
      label: t("properties.npc.appearance.label"),
      hint: t("properties.npc.appearance.hint"),
      multiline: true,
    },
    motivation: {
      label: t("properties.npc.motivation.label"),
      hint: t("properties.npc.motivation.hint"),
      multiline: true,
    },
  };
  const profileSummary = PROFILE_KEYS.map((key) => values[key].trim())
    .filter((value) => value !== "")
    .join(" · ");
  const profileChanges = PROFILE_KEYS.filter((key) => changed(key)).length;

  // A write error wins the line; without one it says why the save is dead.
  const blockedMessage = textBlocked
    ? t("bodyEditor.blocked")
    : fieldsBlocked
      ? t("editMode.blocked.fields")
      : nameBlocked
        ? t("npcEdit.blocked.name")
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
        heading={t("npcEdit.heading")}
        status={<NpcStatusMenu status={values.status} onSelect={(status) => set("status", status)} />}
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
        label={t("npcEdit.name.aria")}
        placeholder={t("npcEdit.name.aria")}
      />
      <div className="mt-2 border-b border-border pb-4">
        <FieldChipRow fields={chips} />
      </div>
      <FieldSection
        title={t("npcEdit.profile.title")}
        summary={profileSummary === "" ? t("npcEdit.profile.empty") : profileSummary}
        changes={profileChanges}
        testId="npc-profile-toggle"
      >
        {PROFILE_KEYS.map((key) => (
          <SectionField key={key} changed={changed(key)}>
            <TextField
              id={fieldId(key)}
              label={profile[key].label}
              hint={profile[key].hint}
              multiline={profile[key].multiline}
              value={values[key]}
              onChange={(value) => set(key, value)}
            />
          </SectionField>
        ))}
      </FieldSection>
      <p aria-live="polite" className="min-h-[17px] pt-1.5 text-[12px] text-destructive">
        {edit.message ?? blockedMessage}
      </p>
      {/* Full width on the phone: the frame loses its sides there. */}
      <div className="mt-1.5 max-md:-mx-5 max-md:[&>div]:rounded-none max-md:[&>div]:border-x-0">
        <BodyEditorSurface
          editorKey={`npc-${npc.id}`}
          label={npc.name === "" ? npc.id : npc.name}
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
