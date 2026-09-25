// The one interactive surface of the aside cards.
//
// Two variants, deliberately identical in looks: a LINK into a reading view
// (scene aside) or, with `onOpen`, a BUTTON that hands the click back to the
// caller (live mode: a card click must open the detail drawer, never navigate
// away from the running session). Both are keyboard-focusable and carry the
// app's global focus outline.

import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

export function CardShell({
  href,
  className,
  onOpen,
  children,
}: {
  /** Where the card leads when it is a link. */
  href: string;
  className?: string;
  onOpen?: (() => void) | undefined;
  children: ReactNode;
}) {
  const shell = cn(
    "block w-full rounded-lg border border-border bg-card text-left transition-colors hover:border-border-hover",
    className,
  );
  if (onOpen !== undefined) {
    return (
      <button type="button" onClick={onOpen} className={shell}>
        {children}
      </button>
    );
  }
  return (
    <Link to={href} className={shell}>
      {children}
    </Link>
  );
}
