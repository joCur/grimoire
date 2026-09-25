// The live mode's detail drawer: the full npc, location or scene WITHOUT
// leaving the running session.
//
// An aside card in the live view is not a link: one click would land on the
// reading route, losing the selected scene and whatever was half-typed in the
// quick note. The drawer keeps the live route mounted (so both survive) and
// renders the very same article its reading view renders, so what the DM
// reads here is what the row says.
//
// This module only picks WHICH drawer content a target gets; each comes from
// the slice of the one it names.
//
// No animation (ui/sheet.tsx): the quality floor asks for reduced-motion
// safety, and mid-sentence a panel that is simply there is the calm answer.

import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { OpenTarget } from "@/lib/open-target";
import { LocationDrawerBody } from "@/location/LocationDrawerBody";
import { PREVIEW_BOUNDARY_ATTR } from "@/markdown/ref-preview";
import { NpcDrawerBody } from "@/npc/NpcDrawerBody";
import { SceneDrawerBody } from "@/scene/SceneDrawerBody";

export function LiveEntityDrawer({
  campaign,
  target,
  onClose,
}: {
  campaign: string;
  /** What the drawer shows, or undefined while it is closed. */
  target: OpenTarget | undefined;
  onClose: () => void;
}) {
  const open = target !== undefined;
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open && (
        <SheetContent
          aria-describedby={undefined}
          // The article carries the visible title; the accessible name of the
          // dialog comes from the hidden SheetTitle inside.
          className="gap-0"
          // A reference's hover preview stays inside the drawer, not merely
          // inside the text column of the article in it.
          {...{ [PREVIEW_BOUNDARY_ATTR]: "" }}
        >
          {target.kind === "npc" ? (
            <NpcDrawerBody campaign={campaign} id={target.id} />
          ) : target.kind === "location" ? (
            <LocationDrawerBody campaign={campaign} id={target.id} />
          ) : (
            <SceneDrawerBody campaign={campaign} id={target.id} />
          )}
        </SheetContent>
      )}
    </Sheet>
  );
}
