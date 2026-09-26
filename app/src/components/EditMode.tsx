// The frame of a reading view in edit mode — the pieces every entity's edit
// mode stands in, without knowing a single field:
//
//   header    the overline row: what is being edited, the status control
//             right beside it, the quiet delete action after it, and on the
//             desktop the save actions with the count of changes at the
//             right end — the delete as far from the save as the row allows.
//             On the phone the delete stays in this row as an icon, and the
//             bar at the bottom holds only cancel and save, so the thumb
//             never finds it by accident.
//   save bar  below md the same actions sit at the bottom of the screen, in
//             thumb reach, fixed over the page.
//   title     the name of the row, editable in place: the reading view's
//             serif heading, without a box around it.
//   line      a one-line field under the title (a scene's trigger): its
//             label and an italic line, as quiet as the reading line it
//             replaces.
//
// The breakpoint decides WHERE the save actions render, so there is always
// exactly one save and one cancel on the page.

import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { AutoGrowTextarea } from "@/components/ui/autogrow-textarea";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

/** What the save actions need from the edit mode behind them. */
export interface EditModeSave {
  /** How many fields the save would write. */
  changes: number;
  canSave: boolean;
  isSaving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

function SaveActions({ save, large }: { save: EditModeSave; large: boolean }) {
  const t = useT();
  return (
    <>
      <span className={cn("text-[12px] font-semibold text-primary", large && "flex-1")}>
        {save.changes > 0 ? t("editMode.changes", { count: save.changes }) : ""}
      </span>
      <Button
        type="button"
        variant="outline"
        onClick={save.onCancel}
        className={cn(
          "border-input bg-transparent font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground",
          large ? "h-10 px-4 text-[13px]" : "h-[30px] px-3 text-[12.5px]",
        )}
      >
        {t("common.cancel")}
      </Button>
      <Button
        type="button"
        onClick={save.onSave}
        disabled={!save.canSave || save.isSaving}
        className={cn("font-semibold", large ? "h-10 px-4 text-[13px]" : "h-[30px] px-3.5 text-[12.5px]")}
      >
        {save.isSaving ? t("common.saving") : t("common.save")}
      </Button>
    </>
  );
}

/**
 * The delete action: quiet until it is pointed at, labelled on the desktop,
 * an icon with the same accessible name on the phone.
 */
function DeleteAction({ onDelete, labelled }: { onDelete: () => void; labelled: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onDelete}
      aria-label={t("editMode.delete")}
      title={labelled ? undefined : t("editMode.delete")}
      className={cn(
        "inline-flex flex-none items-center gap-1.5 rounded-md text-[12.5px] text-muted-foreground hover:text-destructive focus-visible:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        labelled ? "h-[30px] px-2" : "size-9 justify-center",
      )}
    >
      <Trash2 aria-hidden size={labelled ? 13 : 16} className="flex-none" />
      {labelled && <span>{t("editMode.delete")}</span>}
    </button>
  );
}

/** The overline row of the edit mode, and on the phone the bar at the bottom. */
export function EditModeHeader({
  heading,
  status,
  save,
  onDelete,
}: {
  /** What is being edited, e.g. "Edit scene". */
  heading: string;
  /** The status control, part of the same save. */
  status?: ReactNode;
  save: EditModeSave;
  /** Put the row in the trash — the caller asks first. */
  onDelete?: (() => void) | undefined;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  return (
    <>
      <div className="mb-2 flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-2">
        <span className="text-[12px] tracking-[.06em] text-soft uppercase">{heading}</span>
        {/* Right beside the heading on the desktop, at the right end on the
            phone, where the save actions are not. */}
        {!desktop && <span className="flex-1" />}
        {status}
        {onDelete !== undefined && <DeleteAction onDelete={onDelete} labelled={desktop} />}
        {desktop && (
          <span className="flex flex-1 items-center justify-end gap-2.5">
            <SaveActions save={save} large={false} />
          </span>
        )}
      </div>
      {!desktop && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2.5 border-t border-border bg-popover px-4 pt-2.5 pb-[max(16px,env(safe-area-inset-bottom))]">
          <SaveActions save={save} large />
        </div>
      )}
    </>
  );
}

const IN_PLACE =
  "max-h-none overflow-hidden rounded border-0 bg-transparent outline-none hover:bg-primary/10 focus:bg-primary/10";

/**
 * One line of text that wraps instead of being cut off: a growing textarea
 * that never holds a line break. Enter leaves the field, and a pasted break
 * becomes a space.
 */
function SingleLine({
  value,
  onChange,
  className,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
}) {
  return (
    <AutoGrowTextarea
      {...rest}
      value={value}
      minRows={1}
      onChange={(e) => onChange(e.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.currentTarget.blur();
      }}
      autoComplete="off"
      spellCheck
      className={cn(IN_PLACE, className)}
    />
  );
}

/** The title, editable in place — the heading's look, no box, wrapping like the heading. */
export function EditTitleInput({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The field's accessible name. */
  label: string;
  placeholder?: string;
}) {
  return (
    <SingleLine
      value={value}
      onChange={onChange}
      aria-label={label}
      placeholder={placeholder}
      className="-ml-1 mb-1.5 block w-[calc(100%+8px)] px-1 py-0.5 font-serif text-[24px] leading-[1.2] font-semibold text-foreground placeholder:text-faint max-md:text-[24px] md:text-[30px]"
    />
  );
}

/** A one-line field under the title: its label, and the value editable in place. */
export function EditLineInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mt-0.5 mb-1 flex items-baseline gap-2 text-[13.5px]">
      <label htmlFor={id} className="flex-none text-muted-foreground">
        {label}
      </label>
      <SingleLine
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="-ml-1 min-w-0 flex-1 px-1 py-px text-[13.5px] leading-[1.45] text-soft italic placeholder:text-faint max-md:text-[16px]"
      />
    </div>
  );
}
