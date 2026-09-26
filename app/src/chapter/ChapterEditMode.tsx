// The edit mode of a chapter's reading view: the text is the surface. The
// reading view's own article turns editable in place —
//
//   header   "edit chapter" with the status control right beside it; the
//            save actions and the count of changes at the right end on the
//            desktop, in a bar at the bottom of the screen on the phone.
//   title    editable in place, the heading's serif without a box.
//   text     the body editor surface, taking the rest of the page.
//
// A chapter has no further fields, so there are no chips and no collapsible
// section.
//
// Everything on the page is ONE draft over the chapter's one row with its
// one guard (decisions/writes): the form of its fields (./chapter-form.ts)
// and the text (the body draft). A save is one PATCH with exactly the fields
// that changed, through the chapter's editing session
// (./use-chapter-edit.ts). Picking `active` is part of that save: the server
// puts the chapter that held the status back to `planned` in the same write,
// and every chapter of the campaign is refetched after it. A refused save
// (409) keeps the whole draft and puts the shared conflict line above the
// title: reload continues from the stored chapter, save anyway resends the
// changed fields on top of it, so a field changed elsewhere survives.
//
// Leaving with unsaved work asks first — the cancel action here, and a
// navigation through the page's unsaved-changes guard.

import type { Chapter, ChapterChange } from "@grimoire/shared/chapter";
import { useState } from "react";

import { BodyEditorSurface, useBodyDraft, useDraftIssues } from "@/components/BodyEditor";
import { DiscardChangesDialog } from "@/components/DiscardChangesDialog";
import { EditConflict } from "@/components/EditConflict";
import { EditModeHeader, EditTitleInput } from "@/components/EditMode";
import { useFieldsForm } from "@/components/fields/use-fields-form";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { useT } from "@/i18n";

import {
  canSubmitChapterForm,
  chapterFormChange,
  chapterFormDirty,
  chapterFormValues,
} from "./chapter-form";
import { chaptersOf } from "./chapter-query";
import { chapterStatusValue, isChapterStatus } from "./chapter-status";
import { ChapterStatusMenu } from "./ChapterStatusMenu";
import { useChapterEdit } from "./use-chapter-edit";

/**
 * The queries a chapter write makes stale beside the chapter itself: every
 * other chapter (making one active puts the one that held it back to
 * `planned`), the tree (title and status in every list), the session view
 * (it opens the active chapter) and ⌘K.
 */
function staleAfterWrite(campaign: string) {
  return [chaptersOf(campaign), ["tree", campaign], ["session", campaign], ["search", campaign]];
}

export function ChapterEditMode({
  campaign,
  chapter,
  onClose,
}: {
  campaign: string;
  /** The chapter on screen when the edit started; mount per chapter (`key`). */
  chapter: Chapter;
  onClose: () => void;
}) {
  const t = useT();
  const form = useFieldsForm(chapterFormValues(chapter));
  const draft = useBodyDraft(chapter.body);
  const edit = useChapterEdit(campaign, chapter, {
    onSaved: onClose,
    // Continue from what is stored: fields and text are refilled from that chapter.
    onReload: (stored) => {
      form.reseed(chapterFormValues(stored));
      draft.reseed(stored.body);
    },
    invalidateOnSuccess: staleAfterWrite(campaign),
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const values = form.values;
  const fieldChange = chapterFormChange(form.initial, values);
  const bodyChanged = draft.body !== draft.baseline;
  const change: ChapterChange = { ...fieldChange, ...(bodyChanged ? { body: draft.body } : {}) };
  const changes = Object.keys(change).length;
  const draftIssues = useDraftIssues(draft.draft);
  const textBlocked = Object.keys(draftIssues).length > 0;
  const titleBlocked = !canSubmitChapterForm(values);
  const canSave = changes > 0 && !titleBlocked && !textBlocked;
  const dirty = bodyChanged || chapterFormDirty(form.initial, values);
  useUnsavedChanges(dirty);

  const cancel = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const status = chapterStatusValue(isChapterStatus(values.status) ? values.status : undefined);
  // Activating moves a second chapter; the edit mode says so before the save.
  const activates = fieldChange.status === "active";

  // A write error wins the line; without one it says why the save is dead.
  const blockedMessage = textBlocked
    ? t("bodyEditor.blocked")
    : titleBlocked
      ? t("chapterEdit.blocked.title")
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
        heading={t("chapterEdit.heading")}
        status={
          <ChapterStatusMenu
            status={status}
            onSelect={(next) => form.setValues({ ...values, status: next })}
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
        onChange={(title) => form.setValues({ ...values, title })}
        label={t("chapterEdit.title.aria")}
        placeholder={t("chapterEdit.title.aria")}
      />
      {activates && (
        <p className="mt-1 text-[12px] text-faint">{t("chapterEdit.activate.hint")}</p>
      )}
      <p aria-live="polite" className="min-h-[17px] pt-1.5 text-[12px] text-destructive">
        {edit.message ?? blockedMessage}
      </p>
      {/* Full width on the phone: the frame loses its sides there. */}
      <div className="mt-1.5 max-md:-mx-5 max-md:[&>div]:rounded-none max-md:[&>div]:border-x-0">
        <BodyEditorSurface
          editorKey={`chapter-${chapter.id}`}
          label={chapter.title.trim() === "" ? chapter.id : chapter.title}
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
