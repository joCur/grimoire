// The per-chapter actions of the chapter overview.
//
// A chapter is the one thing the overview lists and would otherwise not be
// able to edit: the title would stay whatever the create action was given (a
// slug, for a chapter a generator run created), and a description left out at
// creation time could never be added. So a chapter gets the campaign header's
// vocabulary, per chapter:
//
//   PROPERTIES   title and status — the SHARED properties dialog
//                (components/PropertiesAction). Its chapter form already has
//                exactly these two fields, it runs the same editing session,
//                and its 409 keeps the typed values. Reusing it is the point:
//                a second chapter form is how the wording and the conflict
//                handling drift apart.
//   EDIT         the chapter entry's TEXT, which the overview shows under
//                the chapter's title. Its own dialog (not the reading
//                view's inline editor — the overview is a list, it does not
//                turn into an editing surface), same editing session.
//
// Setting the active chapter is NOT a third action here: the status control in
// the chapter's heading row (components/ChapterStatusMenu) already offers the
// active state and calls the swap endpoint, and two controls for one value is
// how they end up disagreeing about what the chapter's status is.
//
// MOBILE IS READ-ONLY, and it comes for free: below md the route renders the
// mobile start surface instead of the overview, so this whole row is not on
// the phone at all. Nothing here has a `md:` class of its own, because a rule
// enforced in two places is a rule that will disagree with itself.
//
// The chapter ENTRY is what carries the rev, so both dialogs need it. It is
// the query the overview already runs for the chapter's text, passed in rather
// than fetched twice.

import type { EntryResponse } from "@grimoire/shared/types";
import { PenLine } from "lucide-react";
import { useState } from "react";

import { EditConflict } from "@/components/EditConflict";
import { HeaderAction } from "@/components/HeaderAction";
import { PropertiesAction } from "@/components/PropertiesAction";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";
import {
  chapterBodyChanged,
  chapterBodyToWrite,
  chapterMetaPath,
} from "@/lib/chapter-meta";
import { useEntryEdit } from "@/lib/use-entry-edit";

/** The chapter's display name — its id when the title is missing or empty. */
function chapterLabel(entry: EntryResponse, chapter: string): string {
  const title = entry.properties.title;
  return typeof title === "string" && title.trim() !== "" ? title : chapter;
}

export function ChapterActions({
  campaign,
  chapter,
  entry,
}: {
  campaign: string;
  chapter: string;
  /**
   * The chapter's entry. Undefined while the overview's lazy query is still
   * running (or when the chapter has no entry to read): the two actions need
   * its rev, so they simply are not offered yet.
   */
  entry: EntryResponse | undefined;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {entry !== undefined && (
        <>
          {/* The labels name the chapter rather than only the kind of action:
              the overview header carries its own edit action for the campaign
              and every open chapter carries these, so the bare words would be
              ambiguous — for a screen reader, and for anyone counting Tab
              stops down the list. */}
          <PropertiesAction
            campaign={campaign}
            entry={entry}
            triggerLabel={t("chapterOverview.chapter.properties")}
          />
          <HeaderAction
            icon={PenLine}
            label={t("chapterOverview.chapter.edit")}
            onClick={() => setEditing(true)}
          />
        </>
      )}
      {editing && entry !== undefined && (
        <ChapterBodyDialog
          campaign={campaign}
          chapter={chapter}
          entry={entry}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/**
 * The edit dialog — the chapter's markdown text, the one the overview shows.
 *
 * The version it writes against is the one the dialog opened with, held by the
 * editing session: the 5s version poll refetches this entry while the dialog
 * stands, and following it would turn a concurrent edit into a silent
 * overwrite instead of the 409 that asks.
 *
 * The BASELINE the "nothing changed" check compares against belongs to that
 * same version, so it moves only when the DM adopts the stored entry. Reading
 * the entry's text live meant the poll could move the baseline under the
 * dialog — a second writer whose text happened to equal what the DM had typed
 * disabled the save button, so the DM's own version was never written and
 * nothing said why.
 */
function ChapterBodyDialog({
  campaign,
  chapter,
  entry,
  onClose,
}: {
  campaign: string;
  chapter: string;
  entry: EntryResponse;
  onClose: () => void;
}) {
  const t = useT();
  const [body, setBody] = useState(entry.body);
  // The text the draft was seeded from — it always belongs to the version the
  // next save is checked against, so it moves with it and only with it.
  const [baseline, setBaseline] = useState(entry.body);

  const save = useEntryEdit(campaign, chapterMetaPath(chapter), entry.rev, {
    onSaved: onClose,
    onReload: (stored) => {
      // Continue from what is stored: text and baseline together, so there is
      // nothing left to save until the DM types again.
      setBody(stored.body);
      setBaseline(stored.body);
    },
    // The overview reads the text through the entry query the save already
    // refreshes; the tree carries the chapter's title, and the text is
    // indexed.
    invalidateOnSuccess: [
      ["tree", campaign],
      ["search", campaign],
    ],
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
        <DialogTitle>{t("chapterBody.title", { title: chapterLabel(entry, chapter) })}</DialogTitle>
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
