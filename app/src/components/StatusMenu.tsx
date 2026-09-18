// The status menu, without a domain.
//
// The scene status pill was the first one: the display IS the control, two
// densities, one dropdown, a quiet inline message under it. The chapter then
// got the same thing — three values instead of four, a different write behind
// it — and a second copy of this markup is how the two would drift apart: a
// chevron that only appears on one of them, an aria label worded twice, a
// dark-mode token fixed in one place.
//
// So the PRESENTATION lives here and takes what differs as data: the options,
// and a `meta` resolver that turns a value into its label and its dot/text
// colors. It is generic over the domain's status union, so the caller's enum
// reaches `onSelect` without a cast; it knows nothing about scenes, chapters,
// revs or endpoints — which is what makes it render-testable on its own.

import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** "pill" = a bordered pill (reading view, chapter heading), "row" = a list row. */
export type StatusVariant = "pill" | "row";

/** Label plus the two color tokens one status value is rendered with. */
export interface StatusMeta {
  label: string;
  /** Tailwind background class of the 7px dot. */
  dot: string;
  /** Tailwind text color class of the label. */
  text: string;
}

export interface StatusMenuProps<T extends string> {
  /** The value as it stands in the data. */
  status: T;
  /** The value being written right now: shown dimmed, display only. */
  pendingStatus?: T | undefined;
  /** The selectable values, in lifecycle order. */
  options: ReadonlyArray<{ value: T; label: string }>;
  /** Label + colors for one of the domain's values. */
  meta: (status: T) => StatusMeta;
  /** The trigger's accessible name — the localized "change status, currently …". */
  ariaLabel: string;
  variant: StatusVariant;
  /** Quiet inline message under the trigger: a rev conflict, a failed write. */
  message?: string | undefined;
  disabled?: boolean;
  open?: boolean | undefined;
  onOpenChange?: (open: boolean) => void;
  onSelect: (status: T) => void;
}

/**
 * Does selecting `next` mean a WRITE — or is it the value the control already
 * shows?
 *
 * A radio group reports EVERY select, the one of the already-checked option
 * included, and Radix's menu item selects on `click` (and on a `pointerup`
 * whose `pointerdown` happened elsewhere, e.g. a press on the trigger dragged
 * onto an item). So a stray or repeated select of the current value reaches
 * the write layer as an ordinary status change.
 *
 * For a scene that is a pointless rev bump. For a CHAPTER it has teeth:
 * `active` is a SWAP of two chapters, so re-asserting it for the chapter whose
 * control still reads „Aktiv" — the previously active one, whose tree data is
 * only refreshed once the invalidation lands — pulls the flag straight back
 * off the chapter the DM just picked. The menu is a radio group: the checked
 * option IS the state, and selecting it is nothing to write.
 *
 * `pendingStatus` counts as the current value on purpose: while a write runs
 * the trigger already shows the target, so selecting it again is the same
 * no-op (and `useRevWriteMutation` would drop it anyway).
 */
export function statusSelectionWrites(
  next: string,
  status: string,
  pendingStatus?: string | undefined,
): boolean {
  return next !== (pendingStatus ?? status);
}

export function StatusMenu<T extends string>({
  status,
  pendingStatus,
  options,
  meta,
  ariaLabel,
  variant,
  message,
  disabled = false,
  open,
  onOpenChange,
  onSelect,
}: StatusMenuProps<T>): ReactNode {
  const pending = pendingStatus !== undefined;
  // Optimistic DISPLAY: the target value while the write is in flight. The
  // query cache is never written with a guessed value.
  const shown = meta(pendingStatus ?? status);
  const pill = variant === "pill";

  return (
    <span className="inline-flex flex-none flex-col items-end gap-0.5">
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        {/* The visible pill sits INSIDE the button, which reaches 8px further
            up and down (compensated by the negative margin): a finger-sized
            target on mobile without changing a single pixel of the layout. */}
        <DropdownMenuTrigger
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className="group -my-2 inline-flex items-center py-2 disabled:cursor-default"
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full transition-colors",
              pill
                ? "border border-input px-[9px] py-px text-[11.5px] group-hover:border-border-hover"
                : "px-1 text-[12px] group-hover:bg-secondary",
            )}
          >
            <span aria-hidden className={cn("size-[7px] flex-none rounded-full", shown.dot)} />
            <span className={cn(shown.text, pending && "opacity-60")}>{shown.label}</span>
            <ChevronDown
              aria-hidden
              size={12}
              className={cn(
                "flex-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100",
                disabled && "hidden",
              )}
            />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[170px]">
          <DropdownMenuRadioGroup
            value={status}
            onValueChange={(next) => {
              // Selecting what is already selected is not a change — see
              // `statusSelectionWrites`. One guard for both domains: the
              // chapter's swap must never be re-asserted by a stray select.
              // Radix hands the value back as a bare string; it can only be
              // one of `options`, which are the domain's own values.
              const value = next as T;
              if (statusSelectionWrites(value, status, pendingStatus)) onSelect(value);
            }}
          >
            {options.map((option) => {
              const optionMeta = meta(option.value);
              return (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  className="text-[13px] text-body-secondary"
                >
                  <span
                    aria-hidden
                    className={cn("size-[7px] flex-none rounded-full", optionMeta.dot)}
                  />
                  <span className="flex-1">{option.label}</span>
                  <span aria-hidden className="flex w-3.5 flex-none justify-center text-primary">
                    {option.value === status && <Check size={13} />}
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {message !== undefined && (
        <span aria-live="polite" className="text-right text-[11.5px] text-muted-foreground">
          {message}
        </span>
      )}
    </span>
  );
}
