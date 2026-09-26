// The short fields of an edit mode as ONE row of chips under the title — the
// same chips the reading view shows, turned into buttons. A chip opens only
// its own field: on the desktop as a popover at the chip, on the phone as a
// sheet from the bottom with a "done" action in thumb reach.
//
//   empty    a field without a value stands dashed, as an invitation.
//   changed  a field whose value differs from what is stored carries a dot
//            and the brass border — the same count the save action names.
//   invalid  a field that blocks the save carries the destructive border;
//            its editor says why.
//
// On the phone the row wraps and shows only the first few chips; the rest sit
// behind one "all fields" chip that opens every field as a list of rows
// (label left, value right), and a row opens that field's sheet. Nothing
// scrolls sideways at any width: a chip is never wider than the row and cuts
// its value short instead.
//
// Knows nothing about which fields exist: the caller hands every chip its
// translated label, what the chip shows, a one-line summary for the list and
// the editor of the field.

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

/** One field of the row. */
export interface FieldChip {
  /** Stable per row — the open state and the test id are built from it. */
  key: string;
  /** The field's name: the chip's accessible name, the list row's label. */
  label: string;
  /** The heading of the field's editor; the label when omitted. */
  title?: string;
  /** What the chip shows — its value, with an icon or a key where it helps. */
  content: ReactNode;
  /** The value as one line of text, for the list and the accessible name. */
  summary: string;
  empty: boolean;
  changed: boolean;
  invalid?: boolean;
  /** The editor of this one field. */
  editor: ReactNode;
}

const CHIP =
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** The chip's look in each state; `open` while its editor stands. */
function chipClass(field: FieldChip, open: boolean): string {
  return cn(
    CHIP,
    field.empty
      ? "border-dashed border-input bg-transparent text-dim"
      : "border-border bg-card text-body-secondary",
    "hover:border-border-hover hover:text-foreground",
    field.changed && "border-primary",
    field.invalid === true && "border-destructive",
    open && "border-primary bg-primary/10 text-foreground",
  );
}

/** A dashed chip that is an action of its own — adding a field that is not shown yet. */
export function ChipAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        CHIP,
        "border-dashed border-input bg-transparent text-dim hover:border-border-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** The heading of a field's editor: small, uppercase, quiet. */
const EDITOR_HEADING = "text-[11px] font-semibold tracking-[.09em] text-muted-foreground uppercase";

export function FieldChipRow({
  fields,
  after,
  phoneShown = 3,
}: {
  fields: readonly FieldChip[];
  /** Trailing chips that are actions, not fields. */
  after?: ReactNode;
  /** How many chips stand on the phone before the rest go behind "all fields". */
  phoneShown?: number;
}) {
  const t = useT();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  // The one field whose editor stands, or "all" for the phone's list.
  const [open, setOpen] = useState<string>();
  const close = () => setOpen(undefined);
  // One chip behind "all fields" would be no saving — show it instead.
  const cut = fields.length > phoneShown + 1;
  const name = (field: FieldChip) =>
    t(field.changed ? "editMode.chip.changedAria" : "editMode.chip.aria", {
      field: field.label,
      value: field.empty ? t("editMode.chip.unset") : field.summary,
    });
  const dot = (field: FieldChip) =>
    field.changed ? (
      <span aria-hidden className="size-1.5 flex-none rounded-full bg-primary" />
    ) : null;
  const inner = (field: FieldChip) => (
    <>
      {dot(field)}
      <span className="flex min-w-0 items-center gap-1.5 truncate">{field.content}</span>
      <ChevronDown aria-hidden size={12} className="flex-none text-dim" />
    </>
  );

  const current = fields.find((field) => field.key === open);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {fields.map((field, index) => {
        const hiddenOnPhone = cut && index >= phoneShown ? "max-md:hidden" : undefined;
        if (desktop) {
          return (
            <Popover
              key={field.key}
              open={open === field.key}
              onOpenChange={(isOpen) => setOpen(isOpen ? field.key : undefined)}
            >
              <PopoverTrigger
                type="button"
                aria-label={name(field)}
                data-testid={`field-chip-${field.key}`}
                className={cn(chipClass(field, open === field.key), hiddenOnPhone)}
              >
                {inner(field)}
              </PopoverTrigger>
              <PopoverContent aria-label={field.title ?? field.label}>
                <div className="flex flex-col gap-2.5">
                  <h4 className={EDITOR_HEADING}>{field.title ?? field.label}</h4>
                  {field.editor}
                </div>
              </PopoverContent>
            </Popover>
          );
        }
        return (
          <button
            key={field.key}
            type="button"
            aria-label={name(field)}
            aria-haspopup="dialog"
            data-testid={`field-chip-${field.key}`}
            onClick={() => setOpen(field.key)}
            className={cn(chipClass(field, open === field.key), hiddenOnPhone)}
          >
            {inner(field)}
          </button>
        );
      })}
      {cut && (
        <button
          type="button"
          aria-haspopup="dialog"
          data-testid="field-chip-all"
          onClick={() => setOpen("all")}
          className={cn(
            CHIP,
            "border-border bg-transparent text-body-secondary hover:border-border-hover hover:text-foreground md:hidden",
            fields.some((field) => field.changed) && "border-primary",
          )}
        >
          {t("editMode.allFields.chip", { count: fields.length })}
        </button>
      )}
      {after}

      {/* The phone's sheets: one field, or the list of all of them. */}
      {!desktop && current !== undefined && (
        <Sheet
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) close();
          }}
        >
          <SheetContent side="bottom" aria-describedby={undefined}>
            <SheetTitle className={cn(EDITOR_HEADING, "font-sans")}>
              {current.title ?? current.label}
            </SheetTitle>
            <div className="mt-2.5 flex min-h-0 flex-col gap-2.5 overflow-y-auto">
              {current.editor}
            </div>
            <Button
              type="button"
              onClick={close}
              className="mt-3 h-11 text-[13px] font-semibold"
            >
              {t("editMode.done")}
            </Button>
          </SheetContent>
        </Sheet>
      )}
      {!desktop && open === "all" && (
        <Sheet
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) close();
          }}
        >
          <SheetContent side="bottom" aria-describedby={undefined}>
            <SheetTitle className={cn(EDITOR_HEADING, "font-sans")}>
              {t("editMode.allFields.title")}
            </SheetTitle>
            <ul className="mt-1.5 flex min-h-0 flex-col overflow-y-auto">
              {fields.map((field) => (
                <li key={field.key} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    aria-label={name(field)}
                    data-testid={`field-row-${field.key}`}
                    onClick={() => setOpen(field.key)}
                    className="grid min-h-12 w-full grid-cols-[92px_minmax(0,1fr)_12px] items-center gap-2.5 px-0.5 text-left"
                  >
                    <span className="text-[13px] text-muted-foreground">{field.label}</span>
                    <span
                      className={cn(
                        "flex min-w-0 items-center gap-1.5 text-[13.5px]",
                        field.empty ? "text-dim" : "text-foreground",
                      )}
                    >
                      {dot(field)}
                      <span className="truncate">
                        {field.empty ? t("editMode.chip.unset") : field.summary}
                      </span>
                    </span>
                    <ChevronRight aria-hidden size={13} className="text-dim" />
                  </button>
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
