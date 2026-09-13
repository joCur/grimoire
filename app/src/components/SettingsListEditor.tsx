// The editor shell of the settings page's two campaign lists (issue #53):
// the glossary and the campaign knowledge.
//
// ONE component for both, because the server gives them one contract (whole
// list + `rev`, see server/src/server.ts) and the DM meets them one under the
// other on the same page — two hand-built editors would have drifted apart by
// the second review. What differs is only what a ROW looks like, which the
// caller passes in as `renderRow`.
//
// THE INTERACTION, in the smallest shape that covers „anlegen, bearbeiten,
// löschen, umsortieren" (docs/UI-BRIEF.md: the UI whispers):
//
//   * the rows are ALWAYS editable — inline inputs, no edit mode, no dialog.
//     A dialog per term would be four clicks for a two-word correction, and
//     the list is short enough that it has no scroll problem to solve.
//   * one row of quiet icon buttons per entry: up, down, delete. Buttons, not
//     drag & drop — that is the keyboard path AND the phone path in one
//     control (lib/settings-list.ts explains the choice).
//   * the save is EXPLICIT. A per-keystroke autosave against a `rev`-guarded
//     whole-list endpoint would either fight itself or need a debounce long
//     enough to lose the last edit on navigation; „Speichern" is one button
//     and says what happened.
//
// THE 409 is the shape ADR #4 prescribes and lib/write-with-rev.ts spells out
// for the file paths: nothing was written, so the list is re-read and the DM
// is told — never a silent overwrite. What is NOT reused here is that module
// itself: it is built around `FileResponse`, and these two endpoints answer
// their own list shape.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ApiError } from "@/api";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey, type Translate } from "@/i18n";
import { serverErrorMessage } from "@/i18n";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import {
  appendRow,
  focusAfterRemove,
  fromRows,
  isDirty,
  listId,
  moveRow,
  removeRow,
  seedDraft,
  syncDraft,
  updateRow,
  type DraftState,
  type Row,
} from "@/lib/settings-list";
import { cn } from "@/lib/utils";

/** What one list needs to describe itself to this shell. */
export interface ListEditorProps<T> {
  /** react-query key of the list — also what a successful save seeds. */
  queryKey: readonly unknown[];
  load: () => Promise<{ entries: T[]; rev: number }>;
  save: (entries: T[], rev: number) => Promise<{ entries: T[]; rev: number }>;
  /** Which rows are worth sending (lib/settings-list.ts). */
  isSendable: (entry: T) => boolean;
  /** The entry „Eintrag hinzufügen" appends. */
  emptyEntry: () => T;
  /** The row's own controls — inputs, selects, whatever the list needs. */
  renderRow: (row: Row<T>, api: RowApi<T>) => ReactNode;
  /** Shown in place of the list when there is nothing yet. */
  emptyMessage: MessageKey;
  /** Label of the add button — each list names its own kind of entry. */
  addLabel: MessageKey;
}

/** What a rendered row may do to itself. */
export interface RowApi<T> {
  /** Patch this row's value (keeps the row's identity and the focus). */
  patch: (patch: Partial<T>) => void;
  t: Translate;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  /** A write conflict: nothing was written, the list has been re-read. */
  | { kind: "stale" }
  | { kind: "failed"; message: string };

export function SettingsListEditor<T>({
  queryKey,
  load,
  save,
  isSendable,
  emptyEntry,
  renderRow,
  emptyMessage,
  addLabel,
}: ListEditorProps<T>) {
  const t = useT();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey, queryFn: load });

  // The server's list is the truth; `draft` is what the DM is typing. WHEN a
  // server answer may replace it is `syncDraft` (lib/settings-list.ts) — the
  // rule needs the list's IDENTITY and not only its `rev`, and it needs to
  // know whether the DM has unsaved work, so neither a campaign switch nor a
  // write from somewhere else can overwrite the wrong thing.
  const [draft, setDraft] = useState<DraftState<T>>();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  // What the keyboard should be on after the next render, and what a screen
  // reader should hear — both only ever set by an action that moves the focus
  // out from under it (a deletion).
  const [pendingFocus, setPendingFocus] = useState<string>();
  const [announced, setAnnounced] = useState<{ nth: number; message: string }>();
  const removeButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const addButton = useRef<HTMLButtonElement | null>(null);

  const id = listId(queryKey);
  const sendableOf = useCallback(
    (rows: ReadonlyArray<Row<T>>) => fromRows(rows).filter(isSendable),
    [isSendable],
  );
  const sendable = draft === undefined ? [] : sendableOf(draft.rows);
  // Dirty against the draft's OWN baseline, not against the latest fetch:
  // otherwise a write from elsewhere makes an untouched list look edited.
  const dirty = draft !== undefined && isDirty(sendable, draft.base);

  // Leaving the page with unsaved rows asks first (UnsavedChangesGuard). Must
  // stand above every early return below — it is a hook.
  useUnsavedChanges(dirty);

  if (query.data !== undefined) {
    const sync = syncDraft(draft, { id, rev: query.data.rev, entries: query.data.entries }, dirty);
    if (sync.action === "seed") {
      setDraft(sync.draft);
      // „Gespeichert" over a list that has been replaced since would be a lie.
      if (state.kind !== "idle") setState({ kind: "idle" });
    } else if (sync.action === "stale" && state.kind !== "stale") {
      // Somebody else wrote while the DM was typing. Their rows STAY — the
      // conflict is reported, and reloading is their call (ADR #4).
      setState({ kind: "stale" });
    }
  }

  useEffect(() => {
    if (pendingFocus === undefined) return;
    const target =
      pendingFocus === ADD_BUTTON ? addButton.current : (removeButtons.current.get(pendingFocus) ?? null);
    target?.focus();
    setPendingFocus(undefined);
  }, [pendingFocus]);

  if (query.isError) {
    return <p className={NOTE}>{t("settings.list.loadFailed")}</p>;
  }
  if (draft === undefined) {
    return <p className={NOTE}>{t("settings.list.loading")}</p>;
  }

  const busy = state.kind === "saving";
  const rows = draft.rows;

  const edit = (next: Array<Row<T>>): void => {
    setDraft({ ...draft, rows: next });
    // Any edit clears the previous outcome — a „Gespeichert" hanging over a
    // list that has changed since is a lie. A CONFLICT is the exception: it
    // says something about the server, and it stays until it is resolved.
    if (state.kind !== "idle" && state.kind !== "stale") setState({ kind: "idle" });
  };

  /**
   * Delete one row and say so — with the focus on the neighbour's delete
   * button (or on „Eintrag hinzufügen" for the last row), because deleting
   * the row the focus sits in otherwise drops it to the document and makes
   * clearing a list a mouse-only job. `role="status"` carries the same news
   * to anyone not watching (lib/settings-list.ts focusAfterRemove).
   */
  const remove = (index: number, key: string): void => {
    const next = removeRow(rows, key);
    edit(next);
    const focus = focusAfterRemove(rows.length, index);
    setPendingFocus(
      focus.target === "add" ? ADD_BUTTON : (next[focus.index]?.key ?? ADD_BUTTON),
    );
    setAnnounced((prev) => ({
      nth: (prev?.nth ?? 0) + 1,
      message: t("settings.list.removed"),
    }));
  };

  /** Throw the draft away for the server's current list (the stale case). */
  const reload = async (): Promise<void> => {
    const fresh = await query.refetch();
    if (fresh.data === undefined) return;
    queryClient.setQueryData(queryKey, fresh.data);
    setDraft(seedDraft({ id, rev: fresh.data.rev, entries: fresh.data.entries }));
    setState({ kind: "idle" });
  };

  const onSave = async (): Promise<void> => {
    setState({ kind: "saving" });
    try {
      const fresh = await save(sendable, draft.rev);
      queryClient.setQueryData(queryKey, fresh);
      setDraft(seedDraft({ id, rev: fresh.rev, entries: fresh.entries }));
      setState({ kind: "saved" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Nothing was written. Re-read so the next attempt carries the fresh
        // token, and keep the DM's list on screen until they have read why.
        const fresh = await query.refetch();
        if (fresh.data !== undefined) {
          queryClient.setQueryData(queryKey, fresh.data);
          setDraft(seedDraft({ id, rev: fresh.data.rev, entries: fresh.data.entries }));
        }
        setState({ kind: "stale" });
        return;
      }
      setState({
        kind: "failed",
        message: serverErrorMessage(error, t, "settings.list.saveFailed"),
      });
    }
  };

  return (
    <div>
      {rows.length === 0 ? (
        <p className={NOTE}>{t(emptyMessage)}</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {rows.map((row, index) => (
            <li
              key={row.key}
              className="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5 md:flex-row md:items-start"
            >
              <div className="min-w-0 flex-1">
                {renderRow(row, {
                  t,
                  patch: (patch) => edit(updateRow(rows, row.key, patch)),
                })}
              </div>
              {/* The row controls. `md:` puts them beside the fields; below
                  that they sit under them, where a thumb reaches them. */}
              <div className="flex flex-none items-center gap-0.5 self-end md:self-start">
                <IconButton
                  label={t("settings.list.moveUp")}
                  disabled={index === 0 || busy}
                  onClick={() => edit(moveRow(rows, index, -1))}
                >
                  <ArrowUp aria-hidden />
                </IconButton>
                <IconButton
                  label={t("settings.list.moveDown")}
                  disabled={index === rows.length - 1 || busy}
                  onClick={() => edit(moveRow(rows, index, 1))}
                >
                  <ArrowDown aria-hidden />
                </IconButton>
                <IconButton
                  label={t("settings.list.remove")}
                  disabled={busy}
                  onClick={() => remove(index, row.key)}
                  buttonRef={(node) => {
                    if (node === null) removeButtons.current.delete(row.key);
                    else removeButtons.current.set(row.key, node);
                  }}
                >
                  <Trash2 aria-hidden />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          ref={addButton}
          onClick={() => edit(appendRow(rows, emptyEntry()))}
          className="h-auto gap-1.5 px-3 py-1.5 text-[12.5px] [&_svg]:size-[14px]"
        >
          <Plus aria-hidden />
          {t(addLabel)}
        </Button>
        <Button
          type="button"
          disabled={!dirty || busy}
          onClick={() => void onSave()}
          className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
        >
          {t(busy ? "settings.list.saving" : "common.save")}
        </Button>
        {/* One quiet status line, never a toast: the DM is looking right at
            the list they just saved. `role="status"` so a screen reader hears
            the outcome without the focus moving. */}
        <span
          role="status"
          className={cn(
            "flex flex-wrap items-center gap-2 text-[12px]",
            state.kind === "stale" || state.kind === "failed"
              ? "text-destructive"
              : "text-faint",
          )}
        >
          {state.kind === "saved" && t("settings.list.saved")}
          {state.kind === "stale" && (
            <>
              {t("write.stale")}
              {/* The conflict's only sensible next step, as a control rather
                  than as advice: the DM's rows are still on screen, so
                  reloading has to be something they DO, not something that
                  happened to them. */}
              <button
                type="button"
                disabled={busy}
                onClick={() => void reload()}
                className="rounded px-0.5 underline decoration-dotted underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {t("settings.list.reload")}
              </button>
            </>
          )}
          {state.kind === "failed" && state.message}
        </span>
      </div>

      {/* Row actions announce themselves separately from the save outcome:
          the two say different things and must not overwrite each other. The
          `key` makes a repeated deletion a NEW node, which is what gets a
          screen reader to read the same sentence twice. */}
      <span role="status" key={announced?.nth ?? 0} className="sr-only">
        {announced?.message ?? ""}
      </span>
    </div>
  );
}

const NOTE = "text-[12.5px] leading-[1.55] text-muted-foreground";

/** `pendingFocus` for „no row left — the add button". Not a valid row key. */
const ADD_BUTTON = "\u0000add";

/**
 * A quiet square icon button. Its own thing rather than a Button variant: it
 * is 28px, icon-only and needs an `aria-label` every time — three properties
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
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-panel-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none [&_svg]:size-[15px]"
    >
      {children}
    </button>
  );
}
