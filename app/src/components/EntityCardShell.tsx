// The one interactive surface shared by the aside cards (NPC, location).
//
// Two variants, deliberately identical in looks: a LINK into the reading view
// (scene aside) or, with `onOpen`, a BUTTON that hands the target back to the
// caller (live mode: a card click must open the detail drawer, never navigate
// away from the running session). Both are keyboard-focusable and carry the
// app's global focus outline.

import type { ReactNode } from "react";
import { Link } from "react-router";

import { openTargetHref, type OpenTarget } from "@/lib/open-target";
import { cn } from "@/lib/utils";

export function EntityCardShell({
  campaign,
  target,
  className,
  onOpen,
  children,
}: {
  campaign: string;
  /** What the card opens — an npc by its address, a location by its id. */
  target: OpenTarget;
  className?: string;
  onOpen?: (target: OpenTarget) => void;
  children: ReactNode;
}) {
  const shell = cn(
    "block w-full rounded-lg border border-border bg-card text-left transition-colors hover:border-border-hover",
    className,
  );
  if (onOpen !== undefined) {
    return (
      <button type="button" onClick={() => onOpen(target)} className={shell}>
        {children}
      </button>
    );
  }
  return (
    <Link to={openTargetHref(campaign, target)} className={shell}>
      {children}
    </Link>
  );
}
