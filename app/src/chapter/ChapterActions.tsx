// The editing surfaces of a chapter (decisions/resources): the body editor of its reading
// view, the dialog over its other fields, and the two actions the chapter
// overview offers per chapter. All of them are shared surfaces (BodyEditor,
// FieldsDialog, the dialog shell) over the chapter's own form
// (./chapter-form.ts) and its own editing session (./use-chapter-edit.ts):
// what a surface changed becomes ONE chapter PATCH.
//
// In the overview a chapter gets the campaign header's vocabulary, per
// chapter:
//
//   FIELDS   title and status — the same dialog as on the reading view, so
//            the wording and the conflict handling cannot drift apart.
//   EDIT     the chapter's TEXT, which the overview shows under the title.
//            Its own dialog, not the reading view's inline editor: the
//            overview is a list, it does not turn into an editing surface.
//
// Setting the active chapter is NOT a third action: the status control in
// the chapter's heading row (./ChapterStatusMenu) already offers it, and two
// controls for one value is how they end up disagreeing about it.
//
// MOBILE IS READ-ONLY in the overview, and it comes for free: below md the
// route renders the mobile start surface instead of the overview, so these
// actions are not on the phone at all.

import type { Chapter } from "@grimoire/shared/chapter";
import { PenLine } from "lucide-react";
import { useState } from "react";

import { BodyEditor, useBodyDraft } from "@/components/BodyEditor";
import { EditConflict } from "@/components/EditConflict";
import { FieldsDialog, FieldsDialogAction, useFieldsForm } from "@/components/fields/FieldsDialog";
import { HeaderAction } from "@/components/HeaderAction";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

import { ChapterFields } from "./ChapterFields";
import {
  canSubmitChapterForm,
  chapterBodyChanged,
  chapterBodyToWrite,
  chapterFormChange,
  chapterFormDirty,
  chapterFormValues,
} from "./chapter-form";
import { chaptersOf } from "./chapter-query";
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

/** The chapter's display name — its id when the title is empty. */
function chapterName(chapter: Chapter): string {
  return chapter.title.trim() === "" ? chapter.id : chapter.title;
}

/** The body editor of a chapter's reading view: its text. */
export function ChapterBodyEditor({
  campaign,
  chapter,
  onClose,
}: {
  campaign: string;
  /** The chapter on screen when the edit started; mount per chapter (`key`). */
  chapter: Chapter;
  onClose: () => void;
}) {
  const draft = useBodyDraft(chapter.body);
  const edit = useChapterEdit(campaign, chapter, {
    onSaved: onClose,
    onReload: (stored) => draft.reseed(stored.body),
    invalidateOnSuccess: staleAfterWrite(campaign),
  });
  return (
    <BodyEditor
      editorKey={`chapter-${chapter.id}`}
      label={chapterName(chapter)}
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
 * The dialog action of a chapter — bound to ONE chapter: navigating away
 * closes it instead of leaving it standing over another chapter's reading
 * view. `label` names the trigger where a plain name would be ambiguous (the
 * overview, see ChapterOverviewActions).
 */
export function ChapterFieldsAction({
  campaign,
  chapter,
  label,
}: {
  campaign: string;
  chapter: Chapter;
  label?: string;
}) {
  return (
    <FieldsDialogAction openKey={`${campaign}/${chapter.id}`} label={label}>
      {(onClose) => <ChapterFieldsDialog campaign={campaign} chapter={chapter} onClose={onClose} />}
    </FieldsDialogAction>
  );
}

function ChapterFieldsDialog({
  campaign,
  chapter,
  onClose,
}: {
  campaign: string;
  chapter: Chapter;
  onClose: () => void;
}) {
  const t = useT();
  const form = useFieldsForm(chapterFormValues(chapter));
  const save = useChapterEdit(campaign, chapter, {
    onSaved: onClose,
    // Continue from what is stored: the form is refilled from that chapter.
    onReload: (stored) => form.reseed(chapterFormValues(stored)),
    invalidateOnSuccess: staleAfterWrite(campaign),
    errorMessage: "write.properties.failed",
  });
  const change = chapterFormChange(form.initial, form.values);
  return (
    <FieldsDialog
      title={t("properties.title", { kind: t("kind.chapter") })}
      idLabel={chapter.id}
      canSubmit={canSubmitChapterForm(form.values) && Object.keys(change).length > 0}
      dirty={chapterFormDirty(form.initial, form.values)}
      onSubmit={() => save.save(change)}
      session={save}
      onClose={onClose}
    >
      <ChapterFields values={form.values} onChange={form.setValues} />
    </FieldsDialog>
  );
}

/**
 * The per-chapter actions of the chapter overview. `chapter` is undefined
 * while the overview's lazy read of it is still running: both actions need
 * its rev, so they simply are not offered yet.
 */
export function ChapterOverviewActions({
  campaign,
  chapter,
}: {
  campaign: string;
  chapter: Chapter | undefined;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  if (chapter === undefined) return <div className="mb-3" />;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {/* The labels name the chapter rather than only the kind of action:
          the overview header carries its own edit action for the campaign and
          every open chapter carries these, so the bare words would be
          ambiguous — for a screen reader, and for anyone counting Tab stops
          down the list. */}
      <ChapterFieldsAction
        campaign={campaign}
        chapter={chapter}
        label={t("chapterOverview.chapter.properties")}
      />
      <HeaderAction
        icon={PenLine}
        label={t("chapterOverview.chapter.edit")}
        onClick={() => setEditing(true)}
      />
      {editing && (
        <ChapterTextDialog
          campaign={campaign}
          chapter={chapter}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/**
 * The text dialog of the overview — the chapter's markdown text, the one the
 * overview shows.
 *
 * The version it writes against is the one the dialog opened with, held by
 * the editing session: the 5s version poll refetches this chapter while the
 * dialog stands, and following it would turn a concurrent edit into a silent
 * overwrite instead of the 409 that asks.
 *
 * The BASELINE the "nothing changed" check compares against belongs to that
 * same version, so it moves only when the DM adopts the stored chapter:
 * reading the text live would let the poll move it under the dialog, and a
 * second writer whose text happened to equal what the DM typed would disable
 * the save without a word.
 */
function ChapterTextDialog({
  campaign,
  chapter,
  onClose,
}: {
  campaign: string;
  chapter: Chapter;
  onClose: () => void;
}) {
  const t = useT();
  const [body, setBody] = useState(chapter.body);
  const [baseline, setBaseline] = useState(chapter.body);

  const save = useChapterEdit(campaign, chapter, {
    onSaved: onClose,
    onReload: (stored) => {
      // Continue from what is stored: text and baseline together, so there is
      // nothing left to save until the DM types again.
      setBody(stored.body);
      setBaseline(stored.body);
    },
    invalidateOnSuccess: staleAfterWrite(campaign),
  });

  const canSubmit = !save.isSaving;

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-[560px]">
        <DialogTitle>{t("chapterBody.title", { title: chapterName(chapter) })}</DialogTitle>
        <DialogDescription>{t("chapterBody.description")}</DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            save.save({ body: chapterBodyToWrite(body) });
          }}
          className="mt-4 flex flex-col gap-3.5"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-body-secondary">{t("chapterBody.field.body")}</span>
            <textarea
              // Radix focuses the first focusable element on open — this one.
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("chapterBody.field.body.placeholder")}
              className="w-full resize-y rounded-md border border-input bg-panel-deep px-3 py-2 font-mono text-[13px] leading-[1.6] text-foreground placeholder:text-muted-foreground max-md:text-[16px]"
            />
          </label>

          <p aria-live="polite" className="min-h-[17px] text-[12px] text-destructive">
            {save.message ?? ""}
          </p>

          {/* A refused write asks instead of deciding: the typed text is
              untouched and both answers stand above the buttons. */}
          {save.conflict !== undefined && (
            <EditConflict onReload={save.reload} onForce={save.forceSave} busy={save.isSaving} />
          )}

          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
              >
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!canSubmit || !chapterBodyChanged(body, baseline)}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {save.isSaving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
