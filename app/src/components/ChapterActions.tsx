// The per-chapter actions of the chapter overview.
//
// A chapter was the one thing the overview listed and could not edit: the
// title stayed whatever „Kapitel anlegen" was given (a slug, for a chapter a
// generator run created), and a goal left out at creation time could never be
// added. So a chapter gets the campaign header's vocabulary, per chapter:
//
//   PROPERTIES   title and status — the SHARED properties dialog
//                (components/PropertiesAction). Its chapter form already has
//                exactly these two fields, its rev is frozen when it opens,
//                and its 409 keeps the typed values. Reusing it is the point:
//                a second chapter form is how the wording and the conflict
//                handling drift apart.
//   EDIT         the chapter entry's TEXT, which is where the goal line the
//                overview shows comes from. Its own dialog (not the reading
//                view's inline editor — the overview is a list, it does not
//                turn into an editing surface), same rev protocol.
//
// Setting the active chapter is NOT a third action here: the status control in
// the chapter's heading row (components/ChapterStatusMenu) already offers
// „Aktiv" and calls the swap endpoint, and two controls for one value is how
// they end up disagreeing about what the chapter's status is.
//
// MOBILE IS READ-ONLY, and it comes for free: below md the route renders the
// mobile start surface instead of the overview, so this whole row is not on
// the phone at all. Nothing here has a `md:` class of its own, because a rule
// enforced in two places is a rule that will disagree with itself.
//
// The chapter ENTRY is what carries the rev, so both dialogs need it. It is
// the query the overview already runs for the goal line, passed in rather than
// fetched twice.

import type { CampaignTree, EntryResponse } from "@grimoire/shared/types";
import { PenLine } from "lucide-react";
import { useState } from "react";

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
import { chapterBodyChanged, chapterMetaPath, writeChapterBody } from "@/lib/chapter-meta";
import { useRevWriteMutation } from "@/lib/use-rev-write";

/** The chapter's display name — its id when the title is missing or empty. */
function chapterLabel(entry: EntryResponse, chapter: string): string {
  const title = entry.properties.title;
  return typeof title === "string" && title.trim() !== "" ? title : chapter;
}

export function ChapterActions({
  campaign,
  chapter,
  entry,
  tree,
}: {
  campaign: string;
  chapter: string;
  /**
   * The chapter's entry. Undefined while the overview's lazy query is still
   * running (or when the chapter has no entry to read): the two actions need
   * its rev, so they simply are not offered yet.
   */
  entry: EntryResponse | undefined;
  /** For the properties dialog's reference fields. */
  tree: CampaignTree | undefined;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {entry !== undefined && (
        <>
          {/* The labels name the chapter instead of saying only „Eigenschaften"
              or „Bearbeiten": the overview header carries its own edit action
              for the campaign and every open chapter carries these, so the
              bare words would be ambiguous — for a screen reader, and for
              anyone counting Tab stops down the list. */}
          <PropertiesAction
            campaign={campaign}
            file={entry}
            tree={tree}
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
 * The edit dialog — the chapter's markdown text, where the goal lives.
 *
 * The rev is frozen at the first render with an entry, for the reason the
 * campaign dialog spells out (lib/campaign-meta.ts `seedCampaignMetaBase`):
 * the 5s version poll refetches this entry while the dialog stands, and
 * following it would turn a concurrent edit into a silent overwrite instead of
 * a 409. It moves only after a conflict, to the version the re-read brought,
 * and the typed text stays.
 *
 * The BASELINE the "nothing changed" check compares against is frozen in the
 * same breath, and for the same reason (the properties dialog's `initial`
 * does it too): it is the text that belongs to the frozen rev. Reading the
 * entry's text live meant the poll could move the baseline under the dialog —
 * a second writer whose text happened to equal what the DM had typed disabled
 * the save button, so the DM's own version was never written and nothing said
 * why; and after a conflict the re-read text became the baseline, which
 * disabled the retry that was supposed to write on top of it.
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
  // Both frozen at open, and moved only by a conflict re-read below — the
  // baseline always belongs to the rev the next save is checked against.
  const [rev, setRev] = useState(entry.rev);
  const [baseline, setBaseline] = useState(entry.body);

  const save = useRevWriteMutation<void>({
    write: () => writeChapterBody(campaign, chapter, body, rev),
    entryKey: ["entry", campaign, chapterMetaPath(chapter)],
    // The goal line lives in the overview's tree, and the text is indexed.
    invalidateOnSuccess: [
      ["tree", campaign],
      ["search", campaign],
    ],
    onSaved: onClose,
    onConflict: (reread) => {
      // The typed text stays; what moves is what the next attempt writes
      // against — rev and baseline together.
      if (reread !== undefined) {
        setRev(reread.rev);
        setBaseline(reread.body);
      }
    },
  });

  const canSubmit = !save.isPending;

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
            save.write();
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
              {save.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
