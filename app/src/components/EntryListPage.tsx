// The shell of the two campaign-content pages (PO decision):
// „Kampagnenwissen" (/campaigns/:campaign/knowledge) and „Glossar"
// (/campaigns/:campaign/glossary).
//
// WHY PAGES AND NOT SETTINGS SECTIONS. The first version put both lists inline
// under `/settings`. Two objections, and the second is the one that decides
// the shape: with 30 glossary terms the page is an endless wall of tiny text
// fields, and — more importantly — a glossary IS campaign content, the same
// kind of thing as the NPCs and the locations. It belongs where those live:
// its own list page, reached the way those are reached. `/settings` keeps only
// what is true of the INSTANCE.
//
// SO THIS IS A BROWSE LIST (routes/browse.tsx is the model, deliberately):
// title, one sentence of explanation, a filter field, then compact one-line
// rows. The difference is where a row leads — the npc list opens a read view,
// these open the entry itself for editing, in place.
//
// ONE ROW OPEN AT A TIME, SAVED ON ITS OWN. The old page had one „Speichern"
// over everything, which meant the DM had to remember that a term three
// screens up was also unsaved. A row is opened, edited, saved, closed: the
// unit of work on screen is the unit of work in the head. The WIRE is still a
// whole-list PUT guarded by the list's `rev` (server/src/server.ts) — that is
// the endpoint's contract and this page does not get to change it — so a
// per-entry save is „the stored list with this one entry replaced".
//
// THE FIELDS FIT WHAT GOES IN THEM (PO feedback): a term, an „Alt", a „Neu"
// are single-line and full width; an explanation, a fact, a style rule are
// sentences and get a textarea that grows with them
// (components/ui/autogrow-textarea.tsx). Nothing on the page is a 120px box
// holding a paragraph any more.
//
// THE 409 is the shape ADR #4 prescribes: nothing was written, the list is
// re-read and the DM is told — never a silent overwrite. The open row keeps
// what they typed; what happens next is their decision — reload, or re-aim
// the draft at the list that came back. „Speichern" is OFF in between: the
// list moved, so retrying blindly is the overwrite the 409 just prevented.
//
// WHAT „THIS ENTRY" MEANS while the list moves underneath (PO findings on
// PR #87). The version poller refetches both lists every few seconds
// (lib/use-campaign-version.ts), so the stored array can change while a row
// is open. Two consequences, and they are the load-bearing part of this file:
//
//   * the open row is identified by the CONTENT it had when it was opened
//     (lib/entry-list.ts findEntryIndex), never by a remembered index — an
//     index another tab renumbered addresses a neighbouring entry;
//   * the save sends the `rev` that applied when the row was OPENED, not the
//     one the poller just brought in, so an external write is reliably a
//     conflict instead of a fresh token wrapped around a stale draft.
//
// AND WHILE A DRAFT IS OPEN the page does not let anything else rewrite the
// list under it: deleting or moving another row is disabled, and opening a
// different row asks „Änderungen verwerfen?" first.
//
// UNSAVED-CHANGES GUARD: only the open row can hold unsaved work, so that is
// exactly what the guard asks about (components/UnsavedChangesGuard.tsx).
// Everything else on the page is stored.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { ApiError } from "@/api";
import { MobileBackRow } from "@/components/MobileBackRow";
import { UnsavedChangesGuard, useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { AutoGrowTextarea } from "@/components/ui/autogrow-textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { INPUT_CLASS } from "@/components/ui/field";
import { serverErrorMessage, useT, type MessageKey, type Translate } from "@/i18n";
import {
  appendEntry,
  findEntryIndex,
  focusAfterRemove,
  isEntryDirty,
  moveEntry,
  removeEntry,
  replaceEntry,
  type EntryRow,
} from "@/lib/entry-list";
import { cn } from "@/lib/utils";

export interface EntryListPageProps<T> {
  campaign: string;
  /** react-query key of the list — also what a successful save seeds. */
  queryKey: readonly unknown[];
  load: () => Promise<{ entries: T[]; rev: number }>;
  save: (entries: T[], rev: number) => Promise<{ entries: T[]; rev: number }>;
  /** Page title, the one-sentence lead under it, and the filter's label. */
  title: MessageKey;
  lead: MessageKey;
  filterLabel: MessageKey;
  /** Shown in place of the list: nothing stored yet / nothing matches. */
  emptyMessage: MessageKey;
  noMatchMessage: MessageKey;
  /** The „Neuer Eintrag" action — each list names its own kind of entry. */
  addLabel: MessageKey;
  /** What a row says on one line, and what its delete confirmation names. */
  rowTitle: (entry: T) => string;
  rowLabel: (entry: T, t: Translate) => string;
  renderSummary: (entry: T, t: Translate) => ReactNode;
  /** Which rows the page shows, in which order — sorting and filtering. */
  rowsOf: (entries: readonly T[], filter: string) => Array<EntryRow<T>>;
  /** The open row's form. `patch` replaces the whole value (kind switches). */
  renderForm: (value: T, patch: (next: T) => void, t: Translate) => ReactNode;
  /** Is the open row worth saving? Arms „Speichern". */
  isSendable: (entry: T) => boolean;
  emptyEntry: () => T;
  /**
   * Does the stored ORDER mean something? The knowledge list is the order of
   * the prompt, so it gets up/down; the glossary is alphabetical and has no
   * manual order to offer (PO feedback on PR #87).
   */
  reorderable?: boolean;
}

/**
 * Which entry is open in the editor, what has been typed into it — and the two
 * things the save needs that the list itself can no longer be asked for.
 *
 * `original` is the entry AS IT WAS when the row was opened. The save looks it
 * up again in the list as it stands then (lib/entry-list.ts findEntryIndex)
 * instead of writing to a remembered index: the version poller refetches both
 * lists every few seconds, so a delete in another tab silently renumbers
 * everything below it, and an index-addressed write lands on a neighbour
 * (PO finding on PR #87).
 *
 * `rev` is the list's guard token as of the same moment. Sending the CURRENT
 * one would defeat the guard for exactly the case it exists for: the poller
 * hands the page a fresh token while the draft still describes the old list,
 * and the server would happily accept the overwrite. Sending the token the
 * draft was written against turns that into the 409 it is.
 *
 * `index` is only where the open form is DRAWN while its entry cannot be
 * found — never what a write addresses.
 */
type Editing<T> =
  /** A new entry — no stored position yet; saving appends it. */
  | { at: "new"; value: T; rev: number }
  | { at: "stored"; index: number; original: T; value: T; rev: number };

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  /** A write conflict: nothing was written, the list has been re-read. */
  | { kind: "stale" }
  | { kind: "failed"; message: string };

export function EntryListPage<T>(props: EntryListPageProps<T>) {
  // The guard wraps the page rather than the list: „you have unsaved changes"
  // is a statement about the page, and `useBlocker` is one blocker per router.
  return (
    <UnsavedChangesGuard>
      <EntryListBody {...props} />
    </UnsavedChangesGuard>
  );
}

function EntryListBody<T>({
  campaign,
  queryKey,
  load,
  save,
  title,
  lead,
  filterLabel,
  emptyMessage,
  noMatchMessage,
  addLabel,
  rowTitle,
  rowLabel,
  renderSummary,
  rowsOf,
  renderForm,
  isSendable,
  emptyEntry,
  reorderable = false,
}: EntryListPageProps<T>) {
  const t = useT();
  const queryClient = useQueryClient();
  const filterId = useId();
  const query = useQuery({ queryKey, queryFn: load });

  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Editing<T>>();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  /**
   * Which entry the DM asked to delete — the confirmation. The ENTRY and not
   * just its position, for the same reason the open row carries its original:
   * the poller can bring a renumbered list in while the dialog stands, and a
   * remembered index would then delete a neighbour.
   */
  const [confirmDelete, setConfirmDelete] = useState<{ index: number; entry: T }>();
  // What the keyboard should be on after the next render, and what a screen
  // reader should hear — both only ever set by an action that moves the focus
  // out from under it (a deletion).
  const [pendingFocus, setPendingFocus] = useState<number | "add">();
  /** „Änderungen verwerfen?" — what would happen if the DM says yes. */
  const [confirmDiscard, setConfirmDiscard] = useState<
    { kind: "reload" } | { kind: "open"; target: Editing<T> }
  >();
  const [announced, setAnnounced] = useState<{ nth: number; message: string }>();
  const rowButtons = useRef(new Map<number, HTMLButtonElement | null>());
  const addButton = useRef<HTMLButtonElement | null>(null);

  const entries = query.data?.entries ?? [];
  const rev = query.data?.rev ?? 0;

  // WHERE the open entry sits in the list RIGHT NOW — recomputed every render
  // rather than remembered, so the form follows its entry when the poller
  // brings a reordered list. `-1` means it is gone (or no longer what it was);
  // the form then stays where it was drawn so the typing is not swallowed, and
  // the save refuses (see `onSaveEntry`).
  const storedIndex =
    editing !== undefined && editing.at === "stored" ? findEntryIndex(entries, editing.original) : -1;
  const openIndex =
    editing !== undefined && editing.at === "stored"
      ? storedIndex >= 0
        ? storedIndex
        : editing.index
      : -1;

  // Only the OPEN row can hold unsaved work. A brand-new row counts only once
  // something has been typed into it — opening an empty form and walking away
  // is not a loss worth a dialog.
  const dirty =
    editing !== undefined &&
    (editing.at === "new"
      ? isSendable(editing.value)
      : isEntryDirty(editing.value, storedIndex >= 0 ? entries[storedIndex] : editing.original));
  useUnsavedChanges(dirty);

  useEffect(() => {
    if (pendingFocus === undefined) return;
    const target = pendingFocus === "add" ? addButton.current : (rowButtons.current.get(pendingFocus) ?? null);
    target?.focus();
    setPendingFocus(undefined);
  }, [pendingFocus]);

  /**
   * Write the whole list with `rev` — the endpoint's only shape. Every action
   * on this page (save an entry, delete one, move one) is one of these, so the
   * conflict handling and the status line exist exactly once.
   */
  const commit = useCallback(
    async (next: T[], guard: number): Promise<boolean> => {
      setStatus({ kind: "saving" });
      try {
        const fresh = await save(next, guard);
        queryClient.setQueryData(queryKey, fresh);
        setStatus({ kind: "saved" });
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // Nothing was written. Re-read so the next attempt carries the fresh
          // token, and keep what the DM typed on screen until they have read
          // why (ADR #4 — never a silent overwrite, in either direction).
          const reread = await query.refetch();
          if (reread.data !== undefined) queryClient.setQueryData(queryKey, reread.data);
          setStatus({ kind: "stale" });
          return false;
        }
        setStatus({
          kind: "failed",
          message: serverErrorMessage(error, t, "entryList.saveFailed"),
        });
        return false;
      }
    },
    [save, queryClient, queryKey, query, t],
  );

  const rows = rowsOf(entries, filter);
  const busy = status.kind === "saving";
  const stale = status.kind === "stale";
  // A write that is NOT the open entry — delete, move — rewrites the whole
  // list and would take the draft's row with it. While something is open and
  // unsaved those controls are off; the DM finishes the entry first. That is
  // the same rule the row switch enforces with a dialog, in the one place
  // where a dialog would be about somebody ELSE's row.
  const locked = busy || dirty;

  /**
   * Open something else. With unsaved work on screen this ASKS first — before
   * this, clicking the next row threw the draft away without a word, which is
   * the silent loss ADR #4 forbids (and which the leave-the-page guard already
   * refused to allow).
   */
  const requestOpen = (target: Editing<T>) => {
    if (dirty) {
      setConfirmDiscard({ kind: "open", target });
      return;
    }
    setEditing(target);
    setStatus({ kind: "idle" });
  };

  const openNew = () => requestOpen({ at: "new", value: emptyEntry(), rev });

  const onSaveEntry = async () => {
    if (editing === undefined || stale) return;
    let next: T[];
    if (editing.at === "new") {
      next = appendEntry(entries, editing.value);
    } else {
      const index = findEntryIndex(entries, editing.original);
      // The entry the DM opened is not in the list any more. Nothing is
      // written and nothing is guessed: this is the conflict, told.
      if (index < 0) {
        setStatus({ kind: "stale" });
        return;
      }
      next = replaceEntry(entries, index, editing.value);
    }
    if (await commit(next, editing.rev)) setEditing(undefined);
  };

  const onDelete = async (target: { index: number; entry: T }) => {
    setConfirmDelete(undefined);
    // Where that entry sits NOW — not where it sat when the dialog opened.
    const index = findEntryIndex(entries, target.entry);
    if (index < 0) {
      setStatus({ kind: "stale" });
      return;
    }
    const shown = rows.findIndex((row) => row.index === index);
    const without = removeEntry(entries, index);
    // The focus target is read off the list as it will LOOK afterwards: the
    // glossary is alphabetical and filtered, so a pre-delete index names a
    // different row than the one that takes the gap (PO finding on PR #87).
    const remaining = rowsOf(without, filter);
    if (!(await commit(without, rev))) return;
    if (editing !== undefined && editing.at === "stored" && storedIndex === index) {
      setEditing(undefined);
    }
    const focus = focusAfterRemove(remaining.length, shown);
    setPendingFocus(focus.target === "add" ? "add" : (remaining[focus.index]?.index ?? "add"));
    setAnnounced((prev) => ({ nth: (prev?.nth ?? 0) + 1, message: t("entryList.removed") }));
  };

  const reload = async () => {
    const fresh = await query.refetch();
    if (fresh.data !== undefined) queryClient.setQueryData(queryKey, fresh.data);
    setEditing(undefined);
    setStatus({ kind: "idle" });
  };

  /**
   * After a conflict: keep what was typed and re-aim it at the list that came
   * back. Only offered when the opened entry is STILL THERE, unchanged — then
   * „replace this entry" means the same thing in the new list as it did in the
   * old one. Otherwise the only honest option is reloading.
   */
  const canApplyDraft =
    editing !== undefined && (editing.at === "new" || findEntryIndex(entries, editing.original) >= 0);

  const applyDraft = () => {
    if (editing === undefined || !canApplyDraft) return;
    // Adopt the fresh guard token; the entry is looked up again on save.
    setEditing({ ...editing, rev });
    setStatus({ kind: "idle" });
  };

  return (
    <>
      {/* Below md the topbar is not the chrome — the same „‹ Pool" row every
          other campaign view carries is the way back. */}
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[760px] px-5 pt-5 pb-16 md:px-7 md:pt-10">
        <div className="mb-1.5 flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[24px] leading-[1.25] font-semibold text-foreground">
            {t(title)}
          </h1>
          {/* „Neuer Eintrag" sits in the heading row, where the npc and
              location lists carry theirs (routes/browse.tsx): the page's own
              action, above the list rather than after it, so it does not move
              as the list grows. */}
          <span className="ml-auto">
            <Button
              type="button"
              variant="outline"
              ref={addButton}
              disabled={busy}
              onClick={openNew}
              className="h-auto gap-1.5 px-3 py-1.5 text-[12.5px] [&_svg]:size-[14px]"
            >
              <Plus aria-hidden />
              {t(addLabel)}
            </Button>
          </span>
        </div>
        <p className="mb-5 max-w-[62ch] text-[13px] leading-[1.6] text-body-secondary">
          {t(lead)}
        </p>

        {/* The filter, not a search: it hides rows of the list already on
            screen, so it is instant and client-side. Only worth its line once
            there is something to filter. */}
        {entries.length > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-input bg-panel-deep px-3 py-2">
            <Search aria-hidden size={15} className="flex-none text-muted-foreground" />
            <label htmlFor={filterId} className="sr-only">
              {t(filterLabel)}
            </label>
            <input
              id={filterId}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t(filterLabel)}
              autoComplete="off"
              // 16px below md — anything smaller makes iOS zoom into the input.
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground max-md:text-[16px]"
            />
          </div>
        )}

        {query.isPending && <p className={NOTE}>{t("entryList.loading")}</p>}
        {query.isError && <p className={NOTE}>{t("entryList.loadFailed")}</p>}

        {/* A brand-new entry opens ABOVE the list: it is the thing just asked
            for, and appending it to the bottom of an alphabetical list puts it
            somewhere the DM has to go looking for. */}
        {editing !== undefined && editing.at === "new" && (
          <EntryForm
            heading={t(addLabel)}
            busy={busy}
            canSave={isSendable(editing.value) && !stale}
            onSave={() => void onSaveEntry()}
            onCancel={() => setEditing(undefined)}
            t={t}
          >
            {renderForm(editing.value, (value) => setEditing({ ...editing, value }), t)}
          </EntryForm>
        )}

        {query.isSuccess && entries.length === 0 && <p className={NOTE}>{t(emptyMessage)}</p>}
        {query.isSuccess && entries.length > 0 && rows.length === 0 && (
          <p className={NOTE}>{t(noMatchMessage)}</p>
        )}

        <ul>
          {rows.map((row, shown) => {
            const open = editing !== undefined && editing.at === "stored" && openIndex === row.index;
            return (
              <li key={row.index} className="border-b border-divider">
                {open ? (
                  <EntryForm
                    heading={rowLabel(row.entry, t)}
                    busy={busy}
                    canSave={isSendable(editing.value) && !stale}
                    onSave={() => void onSaveEntry()}
                    onCancel={() => setEditing(undefined)}
                    t={t}
                  >
                    {renderForm(editing.value, (value) => setEditing({ ...editing, value }), t)}
                  </EntryForm>
                ) : (
                  <div className="flex min-h-[52px] items-center gap-2 py-1.5 max-md:flex-wrap">
                    {/* The whole row is the edit affordance — clicking a term
                        to correct it is what the DM came for. A button and
                        not a link: nothing navigates. */}
                    <button
                      type="button"
                      disabled={busy}
                      // Named explicitly rather than by the summary inside it:
                      // the row's text alone announces as a sentence with no
                      // verb, and „was ist das hier, ein Link?" is exactly the
                      // question a screen reader user should not have to ask.
                      aria-label={t("entryList.edit", { name: rowTitle(row.entry) })}
                      onClick={() =>
                        requestOpen({
                          at: "stored",
                          index: row.index,
                          original: row.entry,
                          value: row.entry,
                          rev,
                        })
                      }
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1.5 text-left hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:basis-full"
                    >
                      <Pencil
                        aria-hidden
                        size={14}
                        className="flex-none text-faint md:opacity-0 md:transition-opacity"
                      />
                      <span className="min-w-0 flex-1">{renderSummary(row.entry, t)}</span>
                    </button>
                    <div className="flex flex-none items-center gap-0.5 max-md:ml-auto">
                      {reorderable && (
                        <>
                          <IconButton
                            label={t("entryList.moveUp")}
                            disabled={shown === 0 || locked || filter.trim() !== ""}
                            onClick={() => void commit(moveEntry(entries, row.index, -1), rev)}
                          >
                            <ArrowUp aria-hidden />
                          </IconButton>
                          <IconButton
                            label={t("entryList.moveDown")}
                            disabled={shown === rows.length - 1 || locked || filter.trim() !== ""}
                            onClick={() => void commit(moveEntry(entries, row.index, 1), rev)}
                          >
                            <ArrowDown aria-hidden />
                          </IconButton>
                        </>
                      )}
                      <IconButton
                        label={t("entryList.remove", { name: rowTitle(row.entry) })}
                        disabled={locked}
                        onClick={() => setConfirmDelete({ index: row.index, entry: row.entry })}
                        buttonRef={(node) => {
                          if (node === null) rowButtons.current.delete(row.index);
                          else rowButtons.current.set(row.index, node);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </IconButton>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* One quiet status line, never a toast: the DM is looking right at
            the list they just changed. `role="status"` so a screen reader
            hears the outcome without the focus moving. */}
        <p
          role="status"
          className={cn(
            "mt-3 flex flex-wrap items-center gap-2 text-[12px]",
            status.kind === "stale" || status.kind === "failed"
              ? "text-destructive"
              : "text-faint",
          )}
        >
          {status.kind === "saved" && t("entryList.saved")}
          {status.kind === "stale" && (
            <>
              {t("write.stale")}
              {/* The two honest next steps, as controls rather than as advice.
                  „Speichern" stays OFF until one of them is taken: retrying
                  against a list that moved is how the draft ends up on a
                  neighbouring entry (PO finding on PR #87). */}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (dirty) setConfirmDiscard({ kind: "reload" });
                  else void reload();
                }}
                className={STALE_ACTION}
              >
                {t("entryList.reload")}
              </button>
              {canApplyDraft && (
                <button type="button" disabled={busy} onClick={applyDraft} className={STALE_ACTION}>
                  {t("entryList.applyDraft")}
                </button>
              )}
            </>
          )}
          {status.kind === "failed" && status.message}
        </p>

        {/* Row actions announce themselves separately from the save outcome:
            the two say different things and must not overwrite each other. The
            `key` makes a repeated deletion a NEW node, which is what gets a
            screen reader to read the same sentence twice. */}
        <span role="status" key={announced?.nth ?? 0} className="sr-only">
          {announced?.message ?? ""}
        </span>
      </div>

      {/* „Änderungen verwerfen?" — the same question the way OUT of the page
          asks (components/UnsavedChangesGuard.tsx), for the two ways out of an
          open ROW that stay on it: opening another entry, and reloading the
          list after a conflict. */}
      {confirmDiscard !== undefined && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            // Escape and the backdrop mean „Weiter bearbeiten".
            if (!isOpen) setConfirmDiscard(undefined);
          }}
        >
          <DialogContent className="max-w-[420px]">
            <DialogTitle>{t("properties.discard.title")}</DialogTitle>
            <DialogDescription>{t("unsaved.description")}</DialogDescription>
            <div className="mt-4 flex items-center justify-end gap-2">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
                >
                  {t("properties.discard.keepEditing")}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  const pending = confirmDiscard;
                  setConfirmDiscard(undefined);
                  if (pending.kind === "reload") void reload();
                  else {
                    setEditing(pending.target);
                    setStatus({ kind: "idle" });
                  }
                }}
                className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
              >
                {t("common.discard")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Deleting is the one action on this page with no undo — the entry is
          gone from the stored list the moment it is confirmed. So it asks,
          and it names WHAT it would delete. */}
      {confirmDelete !== undefined && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setConfirmDelete(undefined);
          }}
        >
          <DialogContent aria-describedby={undefined} className="max-w-[420px]">
            <DialogTitle>{t("entryList.confirmDelete.title")}</DialogTitle>
            <DialogDescription>
              {t("entryList.confirmDelete.body", { name: rowTitle(confirmDelete.entry) })}
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
                onClick={() => void onDelete(confirmDelete)}
                className="h-auto px-3 py-1.5 text-[12.5px] font-semibold"
              >
                {t("entryList.confirmDelete.confirm")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

const NOTE = "text-[13px] leading-[1.55] text-muted-foreground";

/** The inline links of the conflict line — a control, drawn as running text. */
const STALE_ACTION =
  "rounded px-0.5 underline decoration-dotted underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * The open entry: its fields, and the two things that can happen to it.
 *
 * A panel inside the list rather than a dialog — the DM is correcting a term
 * against the ones around it, and a modal would hide exactly that context. It
 * carries its own „Speichern": the unit of work is this entry
 * (PO feedback on PR #87).
 */
function EntryForm({
  heading,
  busy,
  canSave,
  onSave,
  onCancel,
  t,
  children,
}: {
  heading: string;
  busy: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  t: Translate;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The first TEXT field takes the focus: the row was clicked to type in it,
  // and on a phone that is also what brings up the keyboard without a second
  // tap. A `<select>` is skipped on the way — the knowledge form leads with
  // „Art", and landing the keyboard on a select means the first arrow key
  // silently changes the kind of the entry the DM came to fix a typo in.
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    (
      node.querySelector<HTMLElement>("input, textarea") ??
      node.querySelector<HTMLElement>("select")
    )?.focus();
  }, []);

  return (
    <div
      ref={ref}
      className="my-2 rounded-lg border border-input bg-card px-3.5 py-3 md:px-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className="mb-2.5 truncate text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
        {heading}
      </p>
      <div className="flex flex-col gap-2.5">{children}</div>
      <div className="mt-3.5 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
          className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          disabled={!canSave || busy}
          onClick={onSave}
          className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
        >
          {t(busy ? "entryList.saving" : "common.save")}
        </Button>
      </div>
    </div>
  );
}

/**
 * A quiet square icon button. Its own thing rather than a Button variant: it
 * is 32px, icon-only and needs an `aria-label` every time — three properties
 * a caller should not be able to forget.
 */
function IconButton({
  label,
  disabled,
  onClick,
  children,
  buttonRef,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Set where the focus has to be able to LAND (the delete buttons). */
  buttonRef?: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-panel-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none [&_svg]:size-[15px]"
    >
      {children}
    </button>
  );
}

/** The one-line row body both lists share: a strong first part, a quiet rest. */
export function SummaryLine({
  lead,
  badge,
  rest,
  placeholder,
}: {
  lead?: string;
  badge?: string;
  rest: string;
  placeholder: string;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-2 max-md:flex-wrap">
      {badge !== undefined && (
        <span className="flex-none rounded-[4px] border border-border px-1.5 py-px text-[10.5px] tracking-[.04em] text-muted-foreground uppercase">
          {badge}
        </span>
      )}
      {lead !== undefined && lead !== "" && (
        <span className="flex-none max-w-[45%] truncate text-[14.5px] font-semibold text-foreground max-md:max-w-full">
          {lead}
        </span>
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          rest === "" ? "text-faint italic" : "text-body-secondary",
        )}
      >
        {rest === "" ? placeholder : rest}
      </span>
    </span>
  );
}

/** The single-line field of these forms: full width, its label above it. */
export function EntryField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11.5px] text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={INPUT_CLASS}
      />
    </div>
  );
}

/**
 * The sentence field of these forms: a textarea that grows with what is typed
 * into it (components/ui/autogrow-textarea.tsx). An explanation, a fact and a
 * style rule are all sentences — this is the field they get.
 */
export function EntryTextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11.5px] text-muted-foreground">
        {label}
      </label>
      <AutoGrowTextarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
