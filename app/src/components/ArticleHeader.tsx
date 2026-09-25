// The two parts every reading view's header is built from: the title, and
// the group the header's quiet actions stand in.

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Reading-view title, identical to the scene article's h1. */
export function Title({ children, className }: { children: string; className?: string }) {
  return (
    <h1
      className={cn(
        "font-serif text-[24px] leading-[1.2] font-semibold text-foreground md:text-[30px]",
        className,
      )}
    >
      {children}
    </h1>
  );
}

/**
 * The header's action slot is a GROUP, not a single button: it carries the
 * edit action next to the properties action. Wrapping them keeps them one
 * right-aligned, evenly spaced unit in every header variant — without it the
 * `justify-between` rows would strand the first button in the middle of the
 * header. Renders nothing when there are no actions.
 *
 * It WRAPS because labels plus a long title do not fit a 390px line, and a
 * clipped action is worse than a second row.
 */
export function ActionGroup({ children }: { children?: ReactNode }) {
  if (children === undefined) return null;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">{children}</span>
  );
}
