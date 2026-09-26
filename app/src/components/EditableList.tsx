// A page that lists rows and edits them in place: title, one sentence of
// explanation, a filter field, then compact one-line rows — one of them open
// at a time as a form. Knows no entity: the rows are anything with a stable
// `id` and a guard `rev`, and the page that uses it hands in how a row is
// shown, what its form holds and how it is written.
//
// SO THIS IS A BROWSE LIST (routes/browse.tsx is the model, deliberately).
// The difference is where a row leads — the npc list opens a read view,
// these open the row itself for editing, in place.
//
// ONE ROW OPEN AT A TIME, SAVED ON ITS OWN. One save action over everything
// would mean the DM has to remember that a row three screens up is also
// unsaved. A row is opened, edited, saved, closed: the unit of work on screen
// is the unit of work in the head — and on the wire, where every row is
// written on its own against its own `rev`.
//
// THE 409 is the shape decisions/writes prescribes: nothing was written, the list is
// re-read and the DM is told — never a silent overwrite. The open row keeps
// what they typed, and saving is off until they decide: reload, or — when it
// was their open row that moved — write it anyway, only the fields they
// changed. A delete or a move that meets a changed list only offers the
// reload.
//
// WHILE A ROW IS OPEN the version poller (lib/use-campaign-version.ts) keeps
// refetching the list under it. The open row is named by its id, and the
// save carries the `rev` it was opened with, so a write from another tab to
// that very row is a conflict instead of a fresh token wrapped around a stale
// draft. Opening a different row with unsaved changes asks first, and so
// does leaving the page (components/UnsavedChangesGuard.tsx).

import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

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
import { focusAfterRemove, inOrder, isChanged, moveId, withoutRow, withRow } from "@/lib/editable-list";
import { cn } from "@/lib/utils";

/** What every row of the list carries: its stable key and its guard. */
export interface EditableRow {
  id: string;
  rev: number;
}

export interface EditableListProps<T extends EditableRow, V> {
  campaign: string;
  /** The list's query — writes land in its cache in place. */
  query: { queryKey: QueryKey; queryFn: () => Promise<T[]> };
  /** The page's copy: title, lead, filter, the two empty states and the add action. */
  copy: {
    title: MessageKey;
    lead: MessageKey;
    filter: MessageKey;
    empty: MessageKey;
    noMatch: MessageKey;
    add: MessageKey;
  };
  /** Which rows the page shows, in which order — sorting and filtering. */
  visible: (rows: readonly T[], filter: string) => T[];
  /** What a row is called in its edit and delete labels. */
  rowTitle: (row: T) => string;
  /** The heading of an open row's form. */
  formHeading: (row: T, t: Translate) => string;
  renderSummary: (row: T, t: Translate) => ReactNode;
  /** The open row's form. `patch` replaces the whole value. */
  renderForm: (value: V, patch: (next: V) => void, t: Translate) => ReactNode;
  /** The form value of a stored row, and of a new one. */
  valueOf: (row: T) => V;
  emptyValue: () => V;
  /** Is the open row worth saving? Arms the save action. */
  isSendable: (value: V) => boolean;
  create: (value: V) => Promise<T>;
  /** Write what changed between `original` and `value` against `row.rev` — or on top of it. */
  write: (row: T, original: V, value: V, force: boolean) => Promise<T>;
  remove: (row: T) => Promise<void>;
  /**
   * Write a new ORDER of all rows. Present for a list whose order means
   * something (it gets up/down); absent where the page sorts by itself.
   */
  reorder?: (ids: string[]) => Promise<void>;
  /** Re-read everything the list depends on — after a conflict. */
  reload: () => Promise<void>;
}

/**
 * Which row is open in the editor and what has been typed into it. `row` is
 * the row AS IT WAS when it was opened: its id names it and its `rev` is the
 * guard the save sends.
 */
type Editing<T, V> =
  /** A new row — nothing stored yet; saving creates it. */
  | { at: "new"; value: V }
  | { at: "stored"; row: T; original: V; value: V };

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  /** A write conflict: nothing was written. `force` when the open row can be written anyway. */
  | { kind: "stale"; force: boolean }
  | { kind: "failed"; message: string };

export function EditableList<T extends EditableRow, V>(props: EditableListProps<T, V>) {
  // The guard wraps the page rather than the list: unsaved changes are a
  // statement about the page, and `useBlocker` is one blocker per router.
  return (
    <UnsavedChangesGuard>
      <EditableListBody {...props} />
    </UnsavedChangesGuard>
  );
}

function EditableListBody<T extends EditableRow, V>({
  campaign,
  query: queryOptions,
  copy,
  visible,
  rowTitle,
  formHeading,
  renderSummary,
  renderForm,
  valueOf,
  emptyValue,
  isSendable,
  create,
  write,
  remove,
  reorder,
  reload,
}: EditableListProps<T, V>) {
  const t = useT();
  const queryClient = useQueryClient();
  const filterId = useId();
  const query = useQuery(queryOptions);
  const key = queryOptions.queryKey;

  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Editing<T, V>>();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  /** Which row the DM asked to delete — the confirmation. */
  const [confirmDelete, setConfirmDelete] = useState<T>();
  // What the keyboard should be on after the next render, and what a screen
  // reader should hear — both only ever set by a deletion.
  const [pendingFocus, setPendingFocus] = useState<string>();
  /** The discard confirmation — what would happen if the DM says yes. */
  const [confirmDiscard, setConfirmDiscard] = useState<
    { kind: "reload" } | { kind: "open"; target: Editing<T, V> }
  >();
  const [announced, setAnnounced] = useState<{ nth: number; message: string }>();
  const rowButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const addButton = useRef<HTMLButtonElement | null>(null);

  const rows = query.data ?? [];
  const shown = visible(rows, filter);
  const busy = status.kind === "saving";
  const stale = status.kind === "stale";

  // Only the OPEN row can hold unsaved work. A brand-new row counts only once
  // something has been typed into it — opening an empty form and walking away
  // is not a loss worth a dialog.
  const dirty =
    editing !== undefined &&
    (editing.at === "new" ? isSendable(editing.value) : isChanged(editing.original, editing.value));
  useUnsavedChanges(dirty);

  useEffect(() => {
    if (pendingFocus === undefined) return;
    const target =
      pendingFocus === "" ? addButton.current : (rowButtons.current.get(pendingFocus) ?? null);
    target?.focus();
    setPendingFocus(undefined);
  }, [pendingFocus]);

  /**
   * Run one write. Every action on this page (save, delete, move) is one of
   * these, so the conflict handling and the status line exist exactly once.
   * `force` is whether the DM may write the open row anyway after a conflict.
   */
  const run = async (action: () => Promise<void>, force = false): Promise<boolean> => {
    setStatus({ kind: "saving" });
    try {
      await action();
      setStatus({ kind: "saved" });
      return true;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
        const conflict = error.status === 409 && error.details.code === "rev_conflict";
        if (conflict || error.status === 404) {
          // Nothing was written. Re-read, and keep what the DM typed on
          // screen until they have read why (decisions/writes).
          await queryClient.invalidateQueries({ queryKey: key });
          setStatus({ kind: "stale", force: force && conflict });
          return false;
        }
      }
      setStatus({ kind: "failed", message: serverErrorMessage(error, t, "editableList.saveFailed") });
      return false;
    }
  };

  /**
   * Open something else. With unsaved work on screen this ASKS first —
   * without the question, clicking the next row throws the draft away without
   * a word, which is the silent loss decisions/writes forbids.
   */
  const requestOpen = (target: Editing<T, V>) => {
    if (dirty) {
      setConfirmDiscard({ kind: "open", target });
      return;
    }
    setEditing(target);
    setStatus({ kind: "idle" });
  };

  const openNew = () => requestOpen({ at: "new", value: emptyValue() });

  const onSave = async (force = false) => {
    if (editing === undefined) return;
    const open = editing;
    // An open row nobody changed has nothing to write: it just closes.
    if (open.at === "stored" && !isChanged(open.original, open.value)) {
      setEditing(undefined);
      return;
    }
    const saved = await run(async () => {
      const row =
        open.at === "new" ? await create(open.value) : await write(open.row, open.original, open.value, force);
      queryClient.setQueryData<T[]>(key, (list) => withRow(list, row));
    }, open.at === "stored");
    if (saved) setEditing(undefined);
  };

  const onDelete = async (row: T) => {
    setConfirmDelete(undefined);
    const at = shown.findIndex((candidate) => candidate.id === row.id);
    // The focus target is read off the list as it will LOOK afterwards: a
    // sorted or filtered list names a different row by a pre-delete index.
    const remaining = visible(withoutRow(rows, row.id), filter);
    const removed = await run(async () => {
      await remove(row);
      queryClient.setQueryData<T[]>(key, (list) => withoutRow(list, row.id));
    });
    if (!removed) return;
    const focus = focusAfterRemove(remaining.length, at);
    setPendingFocus(focus.target === "add" ? "" : (remaining[focus.index]?.id ?? ""));
    setAnnounced((prev) => ({ nth: (prev?.nth ?? 0) + 1, message: t("editableList.removed") }));
  };

  const onMove = (row: T, delta: number) => {
    if (reorder === undefined) return;
    const ids = moveId(
      rows.map((stored) => stored.id),
      row.id,
      delta,
    );
    void run(async () => {
      await reorder(ids);
      queryClient.setQueryData<T[]>(key, (list) => inOrder(list ?? [], ids));
    });
  };

  const onReload = async () => {
    await reload();
    setEditing(undefined);
    setStatus({ kind: "idle" });
  };

  const form = (open: Editing<T, V>, heading: string) => (
    <EditForm
      heading={heading}
      busy={busy}
      canSave={isSendable(open.value) && !stale}
      onSave={() => void onSave()}
      onCancel={() => {
        // Closing the row closes what was said about it, too.
        setEditing(undefined);
        setStatus({ kind: "idle" });
      }}
      t={t}
    >
      {renderForm(open.value, (value) => setEditing({ ...open, value }), t)}
    </EditForm>
  );

  return (
    <>
      {/* Below md the topbar is not the chrome — the same back row to the
          chapter overview every other campaign view carries is the way back. */}
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[760px] px-5 pt-5 pb-16 md:px-7 md:pt-10">
        <div className="mb-1.5 flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[24px] leading-[1.25] font-semibold text-foreground">
            {t(copy.title)}
          </h1>
          {/* The add action sits in the heading row, where the npc and
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
              {t(copy.add)}
            </Button>
          </span>
        </div>
        <p className="mb-5 max-w-[62ch] text-[13px] leading-[1.6] text-body-secondary">
          {t(copy.lead)}
        </p>

        {/* The filter, not a search: it hides rows of the list already on
            screen, so it is instant and client-side. Only worth its line once
            there is something to filter. */}
        {rows.length > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-input bg-panel-deep px-3 py-2">
            <Search aria-hidden size={15} className="flex-none text-muted-foreground" />
            <label htmlFor={filterId} className="sr-only">
              {t(copy.filter)}
            </label>
            <input
              id={filterId}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t(copy.filter)}
              autoComplete="off"
              // 16px below md — anything smaller makes iOS zoom into the input.
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground max-md:text-[16px]"
            />
          </div>
        )}

        {query.isPending && <p className={NOTE}>{t("editableList.loading")}</p>}
        {query.isError && <p className={NOTE}>{t("editableList.loadFailed")}</p>}

        {/* A brand-new row opens ABOVE the list: it is the thing just asked
            for, and appending it to the bottom of a sorted list puts it
            somewhere the DM has to go looking for. */}
        {editing !== undefined && editing.at === "new" && form(editing, t(copy.add))}

        {query.isSuccess && rows.length === 0 && <p className={NOTE}>{t(copy.empty)}</p>}
        {query.isSuccess && rows.length > 0 && shown.length === 0 && (
          <p className={NOTE}>{t(copy.noMatch)}</p>
        )}

        <ul>
          {shown.map((row, at) => {
            const open = editing !== undefined && editing.at === "stored" && editing.row.id === row.id;
            return (
              <li key={row.id} className="border-b border-divider">
                {open ? (
                  form(editing, formHeading(row, t))
                ) : (
                  <div className="flex min-h-[52px] items-center gap-2 py-1.5 max-md:flex-wrap">
                    {/* The whole row is the edit affordance — clicking a row
                        to correct it is what the DM came for. A button and
                        not a link: nothing navigates. */}
                    <button
                      type="button"
                      disabled={busy}
                      // Named explicitly rather than by the summary inside it:
                      // the row's text alone announces as a sentence with no
                      // verb.
                      aria-label={t("editableList.edit", { name: rowTitle(row) })}
                      onClick={() =>
                        requestOpen({ at: "stored", row, original: valueOf(row), value: valueOf(row) })
                      }
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1.5 text-left hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:basis-full"
                    >
                      <Pencil
                        aria-hidden
                        size={14}
                        className="flex-none text-faint md:opacity-0 md:transition-opacity"
                      />
                      <span className="min-w-0 flex-1">{renderSummary(row, t)}</span>
                    </button>
                    <div className="flex flex-none items-center gap-0.5 max-md:ml-auto">
                      {reorder !== undefined && (
                        // Moving is off while filtering: up and down name the
                        // neighbour in the WHOLE list, which a filtered view
                        // does not show.
                        <>
                          <IconButton
                            label={t("editableList.moveUp")}
                            disabled={at === 0 || busy || filter.trim() !== ""}
                            onClick={() => onMove(row, -1)}
                          >
                            <ArrowUp aria-hidden />
                          </IconButton>
                          <IconButton
                            label={t("editableList.moveDown")}
                            disabled={at === shown.length - 1 || busy || filter.trim() !== ""}
                            onClick={() => onMove(row, 1)}
                          >
                            <ArrowDown aria-hidden />
                          </IconButton>
                        </>
                      )}
                      <IconButton
                        label={t("editableList.remove", { name: rowTitle(row) })}
                        disabled={busy}
                        onClick={() => setConfirmDelete(row)}
                        buttonRef={(node) => {
                          if (node === null) rowButtons.current.delete(row.id);
                          else rowButtons.current.set(row.id, node);
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
            status.kind === "stale" || status.kind === "failed" ? "text-destructive" : "text-faint",
          )}
        >
          {status.kind === "saved" && t("editableList.saved")}
          {status.kind === "stale" && (
            <>
              {t("editConflict.line")}
              {/* The honest next steps, as controls rather than as advice.
                  The save button stays off until one of them is taken. */}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (dirty) setConfirmDiscard({ kind: "reload" });
                  else void onReload();
                }}
                className={STALE_ACTION}
              >
                {t("editConflict.reload")}
              </button>
              {status.force && editing !== undefined && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSave(true)}
                  className={STALE_ACTION}
                >
                  {t("editConflict.force")}
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

      {/* The discard confirmation — the same question the way OUT of the page
          asks (components/UnsavedChangesGuard.tsx), for the two ways out of an
          open ROW that stay on it: opening another row, and reloading the
          list after a conflict. */}
      {confirmDiscard !== undefined && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            // Escape and the backdrop mean carrying on editing.
            if (!isOpen) setConfirmDiscard(undefined);
          }}
        >
          <DialogContent className="max-w-[420px]">
            <DialogTitle>{t("properties.discard.title")}</DialogTitle>
            <DialogDescription>{t("unsaved.description")}</DialogDescription>
            <div className="mt-4 flex items-center justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline" className={QUIET_BUTTON}>
                  {t("properties.discard.keepEditing")}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  const pending = confirmDiscard;
                  setConfirmDiscard(undefined);
                  if (pending.kind === "reload") void onReload();
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

      {/* Deleting is the one action on this page with no undo — the row is
          gone the moment it is confirmed. So it asks, and it names WHAT it
          would delete. */}
      {confirmDelete !== undefined && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setConfirmDelete(undefined);
          }}
        >
          <DialogContent aria-describedby={undefined} className="max-w-[420px]">
            <DialogTitle>{t("editableList.confirmDelete.title")}</DialogTitle>
            <DialogDescription>
              {t("editableList.confirmDelete.body", { name: rowTitle(confirmDelete) })}
            </DialogDescription>
            <div className="mt-4 flex items-center justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline" className={QUIET_BUTTON}>
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void onDelete(confirmDelete)}
                className="h-auto px-3 py-1.5 text-[12.5px] font-semibold"
              >
                {t("editableList.confirmDelete.confirm")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

const NOTE = "text-[13px] leading-[1.55] text-muted-foreground";

const QUIET_BUTTON =
  "h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground";

/** The inline links of the conflict line — a control, drawn as running text. */
const STALE_ACTION =
  "rounded px-0.5 underline decoration-dotted underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * The open row: its fields, and the two things that can happen to it.
 *
 * A panel inside the list rather than a dialog — the DM is correcting a row
 * against the ones around it, and a modal would hide exactly that context. It
 * carries its own save action: the unit of work is this row.
 */
function EditForm({
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
  // tap. A `<select>` is skipped on the way — landing the keyboard on a
  // select means the first arrow key silently changes it.
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    (
      node.querySelector<HTMLElement>("input, textarea") ?? node.querySelector<HTMLElement>("select")
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
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel} className={QUIET_BUTTON}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          disabled={!canSave || busy}
          onClick={onSave}
          className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
        >
          {t(busy ? "editableList.saving" : "common.save")}
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

/** The one-line row body: a strong first part, a quiet rest. */
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
        <span className="max-w-[45%] flex-none truncate text-[14.5px] font-semibold text-foreground max-md:max-w-full">
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

/** A single-line field of these forms: full width, its label above it. */
export function LineField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
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
        autoComplete="off"
        className={INPUT_CLASS}
      />
    </div>
  );
}

/**
 * The sentence field of these forms: a textarea that grows with what is typed
 * into it (components/ui/autogrow-textarea.tsx).
 */
export function SentenceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11.5px] text-muted-foreground">
        {label}
      </label>
      <AutoGrowTextarea id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
