// The one interactive surface shared by the aside cards (NPC, location).
//
// Two variants, deliberately identical in looks: a LINK into the reading view
// (scene aside — issue #26) or, with `onOpen`, a BUTTON that hands the file
// path back to the caller (live mode — issue #40: a card click must open the
// detail drawer, never navigate away from the running session). Both are
// keyboard-focusable and carry the app's global focus outline.

import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

export function EntityCardShell({
  campaign,
  path,
  className,
  onOpen,
  children,
}: {
  campaign: string;
  /** Campaign-relative file path of the entity (e.g. `npcs/jorna`). */
  path: string;
  className?: string;
  onOpen?: (path: string) => void;
  children: ReactNode;
}) {
  const shell = cn(
    "block w-full rounded-lg border border-border bg-card text-left transition-colors hover:border-border-hover",
    className,
  );
  if (onOpen !== undefined) {
    return (
      <button type="button" onClick={() => onOpen(path)} className={shell}>
        {children}
      </button>
    );
  }
  return (
    <Link to={`/${campaign}/file/${path}`} className={shell}>
      {children}
    </Link>
  );
}
