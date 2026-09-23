// shadcn/ui HoverCard on Radix, colored with the Grimoire tokens (popover
// surface, control border, the popover shadow of index.css).
//
// The content is portalled to the body and layered above the sheet (z-50), so
// a card opened from inside the live drawer is not clipped by it. Its motion
// lives in index.css (`.hover-card`): a short fade toward the anchor on the
// way in, a plain fade on the way out, none at all under reduced motion.

import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import * as React from "react";

import { cn } from "@/lib/utils";

const HoverCard = HoverCardPrimitive.Root;
const HoverCardTrigger = HoverCardPrimitive.Trigger;

function HoverCardContent({
  className,
  align = "start",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "hover-card z-[60] rounded-[10px] border border-input bg-popover text-popover-foreground shadow-popover outline-none",
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
