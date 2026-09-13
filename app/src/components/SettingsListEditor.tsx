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
import { useState, type ReactNode } from "react";

import { ApiError } from "@/api";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey, type Translate } from "@/i18n";
import { serverErrorMessage } from "@/i18n";
import {
  appendRow,
  fromRows,
  isDirty,
  moveRow,
  removeRow,
  toRows,
  updateRow,
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

  // The server's list is the truth; `draft` is what the DM is typing. It is
  // seeded whenever the SERVER's `rev` changes — a fresh load, a save, a
  // reload after a conflict — and never on an unchanged refetch, because
  // that would overwrite what is being typed right now.
  const [draft, setDraft] = useState<{ rev: number; rows: Array<Row<T>> }>();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  if (query.data !== undefined && draft?.rev !== query.data.rev) {
    setDraft({ rev: query.data.rev, rows: toRows(query.data.entries) });
  }

  if (query.isError) {
    return <p className={NOTE}>{t("settings.list.loadFailed")}</p>;
  }
  if (draft === undefined) {
    return <p className={NOTE}>{t("settings.list.loading")}</p>;
  }

  const stored = query.data?.entries ?? [];
  const sendable = fromRows(draft.rows).filter(isSendable);
  const dirty = isDirty(sendable, stored);
  const busy = state.kind === "saving";

  const edit = (rows: Array<Row<T>>): void => {
    setDraft({ rev: draft.rev, rows });
    // Any edit clears the previous outcome — a „Gespeichert" hanging over a
    // list that has changed since is a lie.
    if (state.kind !== "idle") setState({ kind: "idle" });
  };

  const onSave = async (): Promise<void> => {
    setState({ kind: "saving" });
    try {
      const fresh = await save(sendable, draft.rev);
      queryClient.setQueryData(queryKey, fresh);
      setDraft({ rev: fresh.rev, rows: toRows(fresh.entries) });
      setState({ kind: "saved" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Nothing was written. Re-read so the next attempt carries the fresh
        // token, and keep the DM's list on screen until they have read why.
        const fresh = await query.refetch();
        if (fresh.data !== undefined) {
          queryClient.setQueryData(queryKey, fresh.data);
          setDraft({ rev: fresh.data.rev, rows: toRows(fresh.data.entries) });
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
      {draft.rows.length === 0 ? (
        <p className={NOTE}>{t(emptyMessage)}</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {draft.rows.map((row, index) => (
            <li
              key={row.key}
              className="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5 md:flex-row md:items-start"
            >
              <div className="min-w-0 flex-1">
                {renderRow(row, {
                  t,
                  patch: (patch) => edit(updateRow(draft.rows, row.key, patch)),
                })}
              </div>
              {/* The row controls. `md:` puts them beside the fields; below
                  that they sit under them, where a thumb reaches them. */}
              <div className="flex flex-none items-center gap-0.5 self-end md:self-start">
                <IconButton
                  label={t("settings.list.moveUp")}
                  disabled={index === 0 || busy}
                  onClick={() => edit(moveRow(draft.rows, index, -1))}
                >
                  <ArrowUp aria-hidden />
                </IconButton>
                <IconButton
                  label={t("settings.list.moveDown")}
                  disabled={index === draft.rows.length - 1 || busy}
                  onClick={() => edit(moveRow(draft.rows, index, 1))}
                >
                  <ArrowDown aria-hidden />
                </IconButton>
                <IconButton
                  label={t("settings.list.remove")}
                  disabled={busy}
                  onClick={() => edit(removeRow(draft.rows, row.key))}
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
          onClick={() => edit(appendRow(draft.rows, emptyEntry()))}
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
            "text-[12px]",
            state.kind === "stale" || state.kind === "failed"
              ? "text-destructive"
              : "text-faint",
          )}
        >
          {state.kind === "saved" && t("settings.list.saved")}
          {state.kind === "stale" && t("write.stale")}
          {state.kind === "failed" && state.message}
        </span>
      </div>
    </div>
  );
}

const NOTE = "text-[12.5px] leading-[1.55] text-muted-foreground";

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
}: {
  label: string;
  disabled?: boolean;
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
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-panel-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none [&_svg]:size-[15px]"
    >
      {children}
    </button>
  );
}
