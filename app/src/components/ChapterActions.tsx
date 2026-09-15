// The per-chapter actions of the Kapitelübersicht (issue #115).
//
// A chapter was the one thing the pool listed and could not edit: the title
// stayed whatever „Kapitel anlegen" was given (a slug, for a chapter the boot
// repair created), and a goal left out at creation time could never be added.
// So a chapter gets the campaign header's vocabulary (#34/#56), per chapter:
//
//   „Eigenschaften"    Titel and Status — the SHARED properties dialog
//                      (components/PropertiesAction, issue #42). Its chapter
//                      form already has exactly these two fields, its rev is
//                      frozen when it opens, and its 409 keeps the typed
//                      values. Reusing it is the point: a second chapter form
//                      is how the German wording and the conflict handling
//                      drift apart.
//   „Bearbeiten"       the `_chapter` BODY, which is where the goal line the
//                      pool shows comes from. Its own dialog (not the
//                      reading view's inline editor — the pool is a list, it
//                      does not turn into an editing surface), same rev
//                      protocol.
//   „Als aktiv setzen" ONE call that sets `active` here and clears it on the
//                      chapter that had it. Absent on the chapter that is
//                      already active — there is nothing to set.
//
// MOBILE IS READ-ONLY, and it comes for free: below md the route renders the
// mobile start surface instead of the pool (routes/pool.tsx), so this whole
// row is not on the phone at all. Nothing here has a `md:` class of its own,
// because a rule enforced in two places is a rule that will disagree with
// itself.
//
// The chapter DOCUMENT is what carries the rev, so both dialogs need it. It is
// the query the pool already runs for the goal line, passed in rather than
// fetched twice.

import type { CampaignTree, FileResponse } from "@grimoire/shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PenLine, Play } from "lucide-react";
import { useState } from "react";

import { setChapterActive } from "@/api";
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
function chapterLabel(file: FileResponse, chapter: string): string {
  const title = file.properties.title;
  return typeof title === "string" && title.trim() !== "" ? title : chapter;
}

export function ChapterActions({
  campaign,
  chapter,
  status,
  file,
  tree,
}: {
  campaign: string;
  chapter: string;
  /** The chapter's stored status — decides whether „Als aktiv setzen" shows. */
  status: string | undefined;
  /**
   * The chapter's document. Undefined while the pool's lazy query is still
   * running (or when the chapter has no document to read): the two editing
   * actions need its rev, so they simply are not offered yet.
   */
  file: FileResponse | undefined;
  /** For the properties dialog's reference fields. */
  tree: CampaignTree | undefined;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {status !== "active" && <SetActiveAction campaign={campaign} chapter={chapter} />}
      {file !== undefined && (
        <>
          {/* Named „Kapitel-…" rather than plain „Eigenschaften"/„Bearbeiten":
              the pool header carries its own „Bearbeiten" for the campaign and
              every open chapter carries these, so the bare words would be
              ambiguous — for a screen reader, and for anyone counting Tab
              stops down the list. */}
          <PropertiesAction
            campaign={campaign}
            file={file}
            tree={tree}
            triggerLabel={t("pool.chapter.properties")}
          />
          <HeaderAction
            icon={PenLine}
            label={t("pool.chapter.edit")}
            onClick={() => setEditing(true)}
          />
        </>
      )}
      {editing && file !== undefined && (
        <ChapterBodyDialog
          campaign={campaign}
          chapter={chapter}
          file={file}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/**
 * „Als aktiv setzen". No dialog and no confirmation: it is one reversible
 * value, and the chapter it takes the flag from is visible in the same list.
 * A failure is said inline and quietly — the same register as the status
 * regler, which is the other one-click write in this app.
 */
function SetActiveAction({ campaign, chapter }: { campaign: string; chapter: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const activate = useMutation({
    mutationFn: () => setChapterActive(campaign, chapter),
    onMutate: () => setFailed(false),
    onSuccess: async () => {
      // The TREE carries every chapter's status (the pool's pill and the
      // session view read it), and BOTH chapter documents moved — so the
      // whole tree and the file cache go, not one seeded entry.
      await queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
      await queryClient.invalidateQueries({ queryKey: ["file", campaign] });
      await queryClient.invalidateQueries({ queryKey: ["session", campaign] });
    },
    onError: () => setFailed(true),
  });

  return (
    <>
      <HeaderAction
        icon={Play}
        label={activate.isPending ? t("pool.chapter.activating") : t("pool.chapter.setActive")}
        onClick={() => {
          if (!activate.isPending) activate.mutate();
        }}
      />
      {failed && (
        <span aria-live="polite" className="text-[12px] text-destructive">
          {t("pool.chapter.setActive.failed")}
        </span>
      )}
    </>
  );
}

/**
 * „Bearbeiten" — the chapter's markdown body, where the goal lives.
 *
 * The rev is frozen at the first render with a document, for the reason the
 * campaign dialog spells out (lib/campaign-meta.ts `seedCampaignMetaBase`):
 * the 5s version poll refetches this file while the dialog stands, and
 * following it would turn a concurrent edit into a silent overwrite instead of
 * a 409. It moves only after a conflict, to the version the re-read brought,
 * and the typed text stays.
 *
 * The BASELINE the „nothing changed" check compares against is frozen in the
 * same breath, and for the same reason (the properties dialog's `initial`
 * does it too): it is the body that belongs to the frozen rev. Reading
 * `file.body` live meant the poll could move the baseline under the dialog —
 * a second writer whose text happened to equal what the DM had typed disabled
 * „Speichern", so the DM's own version was never written and nothing said
 * why; and after a conflict the re-read body became the baseline, which
 * disabled the retry that was supposed to write on top of it.
 */
function ChapterBodyDialog({
  campaign,
  chapter,
  file,
  onClose,
}: {
  campaign: string;
  chapter: string;
  file: FileResponse;
  onClose: () => void;
}) {
  const t = useT();
  const [body, setBody] = useState(file.body);
  // Both frozen at open, and moved only by a conflict re-read below — the
  // baseline always belongs to the rev the next save is checked against.
  const [rev, setRev] = useState(file.rev);
  const [baseline, setBaseline] = useState(file.body);

  const save = useRevWriteMutation<void>({
    write: () => writeChapterBody(campaign, chapter, body, rev),
    fileKey: ["file", campaign, chapterMetaPath(chapter)],
    // The goal line lives in the pool's tree view, and the body is indexed.
    invalidateOnSuccess: [["tree", campaign], ["search", campaign]],
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
        <DialogTitle>{t("chapterBody.title", { title: chapterLabel(file, chapter) })}</DialogTitle>
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
