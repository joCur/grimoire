// shadcn/ui Popover on Radix, colored with the Grimoire tokens (popover
// surface, control border, the popover shadow of index.css). Focus handling,
// Esc and the outside click come from the primitive.
//
// No enter/leave animation: like ./dialog, a panel that is simply there is
// the calmer answer, and it needs nothing under reduced motion.

import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={16}
        className={cn(
          "z-50 w-[300px] rounded-[10px] border border-input bg-popover p-3 text-popover-foreground shadow-popover outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
