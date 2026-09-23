// The open threads of one chapter, in the chapter overview.
//
// Where the design reference puts them: under the chapter's text, above
// its scenes — the storylines the DM is carrying through the chapter, one
// quiet line each. Here the list is also where it is kept: tick a thread off,
// reword it, delete it, add one by hand. The review adds them too
// („Handlungsstrang übernehmen"); a thread adopted in this sitting carries the
// same „neu" note the review shows.
//
// The list is its own resource (lib/use-threads.ts): rows with ids and the
// list's guard token, so nothing here touches the chapter's text or the
// chapter entry's `rev`. The row controls stay out of the way until the row
// is the one in hand (hover or keyboard focus), like the scene rows' up/down.
//
// Desktop only, and that comes for free: below md the route shows the mobile
// start surface instead of the overview.

import type { ThreadEntry } from "@grimoire/shared/types";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { HeaderAction } from "@/components/HeaderAction";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { INPUT_CLASS } from "@/components/ui/field";
import { useT } from "@/i18n";
import { useReviewMemory } from "@/lib/review-memory";
import { cn } from "@/lib/utils";
import { useThreads, useThreadWrites } from "@/lib/use-threads";

/** What is open for typing: the add line, or one row's text. */
type Draft =
  | { kind: "add"; text: string }
  | { kind: "edit"; id: string; text: string; rev: number };

export function ChapterThreads({
  campaign,
  chapter,
  enabled,
}: {
  campaign: string;
  chapter: string;
  /** The accordion is open — the list is read lazily, like the chapter's text. */
  enabled: boolean;
}) {
  const t = useT();
  const threads = useThreads(campaign, chapter, enabled);
  const writes = useThreadWrites(campaign, chapter);
  const { adopted } = useReviewMemory();
  const adoptedHere = adopted[campaign] ?? [];
  const [draft, setDraft] = useState<Draft>();
  const [confirmDelete, setConfirmDelete] = useState<{ row: ThreadEntry; rev: number }>();
  // The box the DM just clicked shows its new state at once; the list the
  // write answers takes over when it lands, and a refused tick falls back to
  // what is stored.
  const [ticking, setTicking] = useState<{ id: string; done: boolean }>();

  const list = threads.data;
  if (list === undefined) return null;
  // Every write waits for the one on the wire, and none goes out against a
  // list that moved until the DM has reloaded it.
  const locked = writes.isPending || writes.stale;
  // While a row is being reworded nothing else rewrites the list under it:
  // the save carries the token the row was opened with, and a tick next to it
  // would turn that save into a conflict with the DM's own click.
  const editing = draft?.kind === "edit";

  const submitDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (draft === undefined) return;
    const text = draft.text.trim();
    if (text === "") return;
    if (draft.kind === "add") {
      // The add line stays open and empties itself: threads tend to come in
      // twos and threes when the DM sits down to note them.
      if (await writes.write({ kind: "add", text })) setDraft({ kind: "add", text: "" });
      return;
    }
    // The rev the row was OPENED with, not the one a poll brought in since:
    // a text changed elsewhere meanwhile is a conflict, not a silent overwrite.
    if (await writes.write({ kind: "edit", id: draft.id, text, rev: draft.rev })) {
      setDraft(undefined);
    }
  };

  return (
    <div className="mb-5">
      {list.entries.length > 0 && (
        <ul aria-label={t("chapterOverview.threads.label")} className="flex flex-col">
          {list.entries.map((row) =>
            draft?.kind === "edit" && draft.id === row.id ? (
              <li key={row.id}>
                <ThreadInput
                  label={t("chapterOverview.threads.edit.aria", { text: row.text })}
                  value={draft.text}
                  busy={locked}
                  onChange={(text) => setDraft({ ...draft, text })}
                  onSubmit={(event) => void submitDraft(event)}
                  onCancel={() => setDraft(undefined)}
                  submitLabel={t("common.save")}
                />
              </li>
            ) : (
              <ThreadRow
                key={row.id}
                row={ticking?.id === row.id ? { ...row, done: ticking.done } : row}
                isNew={adoptedHere.includes(row.id)}
                locked={locked || editing}
                onTick={(done) => {
                  setTicking({ id: row.id, done });
                  void writes
                    .write({ kind: "tick", id: row.id, done, rev: list.rev })
                    .finally(() => setTicking(undefined));
                }}
                onEdit={() => setDraft({ kind: "edit", id: row.id, text: row.text, rev: list.rev })}
                onDelete={() => setConfirmDelete({ row, rev: list.rev })}
              />
            ),
          )}
        </ul>
      )}

      {editing ? null : draft?.kind === "add" ? (
        <ThreadInput
          label={t("chapterOverview.threads.input")}
          value={draft.text}
          busy={locked}
          onChange={(text) => setDraft({ kind: "add", text })}
          onSubmit={(event) => void submitDraft(event)}
          onCancel={() => setDraft(undefined)}
          submitLabel={t("chapterOverview.threads.addSubmit")}
        />
      ) : (
        <HeaderAction
          icon={Plus}
          label={t("chapterOverview.threads.add")}
          onClick={() => setDraft({ kind: "add", text: "" })}
          className="mt-1"
        />
      )}

      {/* One quiet line at the list, never a toast — the DM is looking at the
          row they just changed. The conflict has one honest answer on a list:
          take the stored state (the open text is dropped with it). */}
      {(writes.stale || writes.failed !== undefined) && (
        <p role="status" className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-destructive">
          {writes.stale ? (
            <>
              {t("editConflict.line")}
              <button
                type="button"
                onClick={() => {
                  setDraft(undefined);
                  void writes.reload();
                }}
                className="rounded px-0.5 underline decoration-dotted underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {t("editConflict.reload")}
              </button>
            </>
          ) : (
            writes.failed
          )}
        </p>
      )}

      {/* Deleting has no undo, so it asks — and names what it would delete. */}
      {confirmDelete !== undefined && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setConfirmDelete(undefined);
          }}
        >
          <DialogContent aria-describedby={undefined} className="max-w-[420px]">
            <DialogTitle>{t("chapterOverview.threads.confirmDelete.title")}</DialogTitle>
            <DialogDescription>
              {t("chapterOverview.threads.confirmDelete.body", { text: confirmDelete.row.text })}
            </DialogDescription>
            <div className="mt-4 flex items-center justify-end gap-2">
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
                type="button"
                variant="destructive"
                disabled={locked}
                onClick={() => {
                  const { row, rev } = confirmDelete;
                  setConfirmDelete(undefined);
                  void writes.write({ kind: "remove", id: row.id, rev });
                }}
                className="h-auto px-3 py-1.5 text-[12.5px] font-semibold"
              >
                {t("chapterOverview.threads.confirmDelete.confirm")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * One thread: the tick, the text, and the two quiet row controls. Exported
 * for the render test.
 */
export function ThreadRow({
  row,
  isNew,
  locked,
  onTick,
  onEdit,
  onDelete,
}: {
  row: ThreadEntry;
  isNew: boolean;
  locked: boolean;
  onTick: (done: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <li className="group flex min-h-8 items-center gap-2.5 rounded-md px-1 hover:bg-card">
      <input
        type="checkbox"
        checked={row.done}
        disabled={locked}
        onChange={(event) => onTick(event.target.checked)}
        aria-label={t("chapterOverview.threads.done.aria", { text: row.text })}
        className="size-3.5 flex-none cursor-pointer accent-primary disabled:cursor-default"
      />
      <span
        className={cn(
          "min-w-0 text-[13.5px] leading-[1.5]",
          row.done ? "text-muted-foreground" : "text-body-secondary",
        )}
      >
        {row.text}
      </span>
      {isNew && (
        <span className="flex-none rounded-[4px] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-[7px] py-px text-[11px] text-primary-hover">
          {t("chapterOverview.threads.new")}
        </span>
      )}
      {/* The note stands with the text; the controls keep to the right edge. */}
      <span className="ml-auto flex flex-none items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
        <RowButton label={t("chapterOverview.threads.edit.aria", { text: row.text })} disabled={locked} onClick={onEdit}>
          <Pencil aria-hidden />
        </RowButton>
        <RowButton label={t("chapterOverview.threads.remove.aria", { text: row.text })} disabled={locked} onClick={onDelete}>
          <Trash2 aria-hidden />
        </RowButton>
      </span>
    </li>
  );
}

/** Icon-only control of a thread row — named for screen readers by its thread. */
function RowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-panel-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none [&_svg]:size-[14px]"
    >
      {children}
    </button>
  );
}

/** The one-line field of the add line and of a row being reworded. */
function ThreadInput({
  label,
  value,
  busy,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  label: string;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const t = useT();
  const id = useId();
  return (
    <form onSubmit={onSubmit} className="my-1 flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        value={value}
        autoFocus
        autoComplete="off"
        placeholder={t("chapterOverview.threads.input")}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className={cn(INPUT_CLASS, "min-w-0 flex-1 py-1.5")}
      />
      <Button
        type="submit"
        disabled={busy || value.trim() === ""}
        className="h-auto px-3 py-1.5 text-[12.5px] font-semibold"
      >
        {submitLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
      >
        {t("common.cancel")}
      </Button>
    </form>
  );
}
